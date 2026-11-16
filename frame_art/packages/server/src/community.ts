/**
 * Community collections (github.com/dstollie/frame-art-collections): curated manifests of openly
 * licensed works, served as static JSON. Adding a collection puts its works in the catalogue as
 * `community:<item id>`, unless the catalogue already has the same work; then the collection
 * points at that one. Matching, cheapest first: the same id at the source (smk-X = smk:X), the same
 * Wikimedia Commons file, or the same title, artist and year confirmed by a look-alike thumbnail
 * (dHash). See knowledge/codebase/07-community-collections.md.
 */
import { eq, inArray, sql } from "drizzle-orm"
import sharp from "sharp"

import { normalize } from "./categorize.js"
import { artworks, communityCollections, communityItems, communityRaw, type Store } from "./db.js"
import type { ImageCache } from "./images.js"
import { AI_TAG, newArtwork, type Artwork } from "./models.js"
import { USER_AGENT, type Fetch } from "./providers/http.js"

export const COMMUNITY_BASE = "https://dstollie.github.io/frame-art-collections"
export const COMMUNITY_REPO = "https://github.com/dstollie/frame-art-collections"
export const SCHEMA_URL = `${COMMUNITY_BASE}/schema/collection.v1.schema.json`
export const SOURCE = "community"

// ------------------------------------------------------------------ schema v1, read defensively

export const LICENCES = [
  "CC0-1.0",
  "PD",
  "CC-BY-2.0",
  "CC-BY-2.5",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "CC-BY-SA-2.0",
  "CC-BY-SA-2.5",
  "CC-BY-SA-3.0",
  "CC-BY-SA-4.0",
] as const
export type Licence = (typeof LICENCES)[number]

export interface Item {
  id: string
  title: string
  artist: string
  year: number | null
  date?: string
  image: string
  image_4k?: string
  thumbnail?: string
  iiif?: string
  width: number
  height: number
  licence: Licence
  attribution?: string
  source: string
  source_url: string
  ai_generated: boolean
  tags?: string[]
}

export interface Curator {
  name: string
  github?: string
  url?: string
}

export interface Manifest {
  $schema: string
  schema_version: 1
  id: string
  title: string
  description: string
  tags: string[]
  curator: Curator
  cover: string
  generator?: string
  items: Item[]
}

export interface IndexEntry {
  id: string
  title: string
  description: string
  tags: string[]
  curator: Curator
  url: string
  count: number
  landscape_count: number
  uhd_count: number
  ai_generated_count: number
  licences: Record<string, number>
  cover: { id: string; title: string; artist: string; thumbnail: string; width: number; height: number } | null
}

class SchemaError extends Error {}
type Obj = Record<string, unknown>
const obj = (v: unknown, what: string): Obj => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new SchemaError(`${what}: not an object`)
  return v as Obj
}
const str = (o: Obj, k: string, what: string): string => {
  const v = o[k]
  if (typeof v !== "string" || !v) throw new SchemaError(`${what}.${k}: missing`)
  return v
}
const optStr = (o: Obj, k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : undefined)
const num = (o: Obj, k: string, what: string): number => {
  const v = o[k]
  if (typeof v !== "number" || !Number.isFinite(v)) throw new SchemaError(`${what}.${k}: not a number`)
  return v
}
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
/** https only; plain http just for a local copy (the dev stack). */
const https = (o: Obj, k: string, what: string) => {
  const v = str(o, k, what)
  if (!v.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(v))
    throw new SchemaError(`${what}.${k}: not https`)
  return v
}

function parseCurator(v: unknown): Curator {
  const o = obj(v, "curator")
  const c: Curator = { name: str(o, "name", "curator") }
  const github = optStr(o, "github")
  const url = optStr(o, "url")
  if (github) c.github = github
  if (url) c.url = url
  return c
}

export function parseItem(v: unknown): Item {
  const o = obj(v, "item")
  const id = str(o, "id", "item")
  const what = `item ${id}`
  const licence = str(o, "licence", what)
  if (!(LICENCES as readonly string[]).includes(licence)) throw new SchemaError(`${what}: licence ${licence}`)
  if (typeof o.ai_generated !== "boolean") throw new SchemaError(`${what}.ai_generated: missing`)
  const year = o.year === null ? null : num(o, "year", what)
  const item: Item = {
    id,
    title: str(o, "title", what),
    artist: str(o, "artist", what),
    year,
    image: https(o, "image", what),
    width: num(o, "width", what),
    height: num(o, "height", what),
    licence: licence as Licence,
    source: str(o, "source", what),
    source_url: https(o, "source_url", what),
    ai_generated: o.ai_generated,
  }
  for (const k of ["date", "image_4k", "thumbnail", "iiif", "attribution"] as const) {
    const s = optStr(o, k)
    if (s) item[k] = s
  }
  if (Array.isArray(o.tags)) item.tags = strings(o.tags)
  if (licence.startsWith("CC-BY") && !item.attribution) throw new SchemaError(`${what}: attribution missing`)
  return item
}

export function parseManifest(v: unknown): Manifest {
  const o = obj(v, "manifest")
  if (o.schema_version !== 1) throw new SchemaError(`schema_version ${String(o.schema_version)}`)
  if (!Array.isArray(o.items) || !o.items.length) throw new SchemaError("items: empty")
  const m: Manifest = {
    $schema: SCHEMA_URL,
    schema_version: 1,
    id: str(o, "id", "manifest"),
    title: str(o, "title", "manifest"),
    description: str(o, "description", "manifest"),
    tags: strings(o.tags),
    curator: parseCurator(o.curator),
    cover: str(o, "cover", "manifest"),
    items: o.items.map(parseItem),
  }
  const generator = optStr(o, "generator")
  if (generator) m.generator = generator
  return m
}

export function parseIndex(v: unknown): { generatedAt: string; collections: IndexEntry[] } {
  const o = obj(v, "index")
  if (o.schema_version !== 1) throw new SchemaError(`index schema_version ${String(o.schema_version)}`)
  if (!Array.isArray(o.collections)) throw new SchemaError("index: no collections")
  const collections = o.collections.flatMap((raw): IndexEntry[] => {
    try {
      const c = obj(raw, "collection")
      const cover = c.cover ? obj(c.cover, "cover") : null
      return [
        {
          id: str(c, "id", "collection"),
          title: str(c, "title", "collection"),
          description: optStr(c, "description") ?? "",
          tags: strings(c.tags),
          curator: parseCurator(c.curator),
          url: https(c, "url", "collection"),
          count: num(c, "count", "collection"),
          landscape_count: typeof c.landscape_count === "number" ? c.landscape_count : 0,
          uhd_count: typeof c.uhd_count === "number" ? c.uhd_count : 0,
          ai_generated_count: typeof c.ai_generated_count === "number" ? c.ai_generated_count : 0,
          licences: Object.fromEntries(
            Object.entries(typeof c.licences === "object" && c.licences ? c.licences : {}).filter(
              (e): e is [string, number] => typeof e[1] === "number",
            ),
          ),
          cover: cover
            ? {
                id: str(cover, "id", "cover"),
                title: optStr(cover, "title") ?? "",
                artist: optStr(cover, "artist") ?? "",
                thumbnail: https(cover, "thumbnail", "cover"),
                width: typeof cover.width === "number" ? cover.width : 0,
                height: typeof cover.height === "number" ? cover.height : 0,
              }
            : null,
        },
      ]
    } catch {
      return [] // one broken entry shouldn't hide the rest
    }
  })
  return { generatedAt: typeof o.generated_at === "string" ? o.generated_at : "", collections }
}

// ------------------------------------------------------------------ items → catalogue

/** For the TV: a 4K rendition, then IIIF at 3840×2160, then the (possibly huge) master. */
export function downloadUrlOf(item: Item): string {
  if (item.image_4k) return item.image_4k
  if (item.iiif) return `${item.iiif}/full/!3840,2160/0/default.jpg`
  return item.image
}

function thumbOf(item: Item): string {
  if (item.thumbnail) return item.thumbnail
  if (item.iiif) return `${item.iiif}/full/!960,960/0/default.jpg`
  return downloadUrlOf(item)
}

export function itemToArtwork(item: Item): Artwork {
  const tags = [...new Set([...(item.tags ?? []), ...(item.ai_generated ? [AI_TAG] : [])])]
  return newArtwork({
    id: `${SOURCE}:${item.id}`,
    source: SOURCE,
    sourceId: item.id,
    title: item.title,
    artist: item.artist,
    dateText: item.date ?? (item.year === null ? "" : String(item.year)),
    year: item.year,
    department: item.source,
    tags,
    imageUrl: downloadUrlOf(item),
    thumbUrl: thumbOf(item),
    pageUrl: item.source_url,
    licence: item.licence,
    attribution: item.attribution ?? "",
    aspect: Math.round((item.width / item.height) * 10_000) / 10_000,
    maxPx: Math.max(item.width, item.height),
  })
}

/** "…/File:Claude_Monet_-_Water_Lilies.jpg", "…/a/ab/Claude%20Monet…jpg?width=3840" → "claude_monet_-_water_lilies.jpg" */
export function commonsFile(url: string): string | null {
  if (!/wikimedia\.org|wikipedia\.org/.test(url)) return null
  const clean = url.split(/[?#]/)[0]!
  const file = clean.includes("File:")
    ? clean.slice(clean.lastIndexOf("File:") + 5)
    : clean.includes("Special:FilePath/")
      ? clean.slice(clean.indexOf("Special:FilePath/") + 17)
      : clean.slice(clean.lastIndexOf("/") + 1).replace(/^\d+px-/, "")
  try {
    return decodeURIComponent(file).replace(/ /g, "_").toLowerCase() || null
  } catch {
    return file.toLowerCase()
  }
}

/** 64-bit difference hash of an image: robust to scale, compression and colour shifts. */
export async function dHash(image: Buffer): Promise<bigint> {
  const px = await sharp(image).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer()
  let h = 0n
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n)
  return h
}

export const hamming = (a: bigint, b: bigint) => {
  let x = a ^ b
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

/** At most this many differing bits counts as the same picture. */
export const LOOK_ALIKE_BITS = 10

const surname = (artist: string) => normalize(artist).split(/\s+/).findLast(Boolean) ?? ""

interface Candidate {
  id: string
  surname: string
  year: number | null
}

/** The catalogue (community works) indexed for matching: by Commons file and by title. */
interface MatchIndex {
  files: Map<string, string>
  byTitle: Map<string, Candidate[]>
}

export type MatchMethod = "same-id" | "commons-file" | "look-alike"

/** Tables that point at a work; a work they use is never thrown away. */
const REFERENCES = [
  ["favourites", "artwork_id"],
  ["album_items", "artwork_id"],
  ["series_items", "artwork_id"],
  ["uploads", "artwork_id"],
  ["history", "artwork_id"],
] as const

export interface SyncReport {
  collections: number
  works: number
  removed: number
  migrated?: { mapped: number; kept: number; removed: number; methods: Partial<Record<MatchMethod, number>> }
}

/**
 * The catalogue: every work of frame-art-collections, stored once however many collections hold it.
 * Collections can be switched off (their works leave Explore unless another collection has them).
 */
export class Catalogue {
  constructor(
    private readonly store: Store,
    private readonly images: ImageCache,
    private readonly fetchFn: Fetch,
    private readonly base = COMMUNITY_BASE,
  ) {}

  private async json(url: string): Promise<unknown> {
    const r = await this.fetchFn(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) throw new Error(`Collections ${r.status} for ${url}`)
    return r.json()
  }

  collections() {
    return this.store.db.select().from(communityCollections).orderBy(communityCollections.position).all()
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return (
      this.store.db.update(communityCollections).set({ enabled }).where(eq(communityCollections.id, id)).run().changes >
      0
    )
  }

  /** Collections a work is in (enabled or not). */
  collectionsOf(artworkId: string): string[] {
    return this.store.db
      .select({ id: communityItems.collectionId })
      .from(communityItems)
      .where(eq(communityItems.artworkId, artworkId))
      .all()
      .map((r) => r.id)
  }

  raw(itemId: string): Item | null {
    const r = this.store.db.select().from(communityRaw).where(eq(communityRaw.itemId, itemId)).get()
    return r ? parseItem(JSON.parse(r.json)) : null
  }

  /** Fetches the index and every manifest, and brings the catalogue in line. One broken manifest is skipped. */
  async sync(onProgress?: (collection: string, works: number) => void): Promise<SyncReport> {
    const idx = parseIndex(await this.json(`${this.base}/index.json`))
    const known = new Map(this.collections().map((c) => [c.id, c]))
    let works = 0
    const seenCollections: string[] = []
    for (const [position, entry] of idx.collections.entries()) {
      let m: Manifest
      try {
        m = parseManifest(await this.json(entry.url))
      } catch (e) {
        console.warn(`collection ${entry.id}: ${e instanceof Error ? e.message : String(e)}`)
        if (known.has(entry.id)) seenCollections.push(entry.id) // keep what we had
        continue
      }
      seenCollections.push(entry.id)
      const values = {
        id: entry.id,
        title: entry.title,
        description: entry.description,
        tags: entry.tags,
        curator: entry.curator.name,
        count: m.items.length,
        landscapeCount: entry.landscape_count,
        uhdCount: entry.uhd_count,
        aiCount: entry.ai_generated_count,
        coverId: `${SOURCE}:${m.cover}`,
        position,
      }
      this.store.sqlite.transaction(() => {
        this.store.db
          .insert(communityCollections)
          .values({ ...values, enabled: true })
          .onConflictDoUpdate({ target: communityCollections.id, set: values })
          .run()
        this.store.upsertArtworks(m.items.map(itemToArtwork))
        this.store.db.delete(communityItems).where(eq(communityItems.collectionId, entry.id)).run()
        for (const [i, item] of m.items.entries()) {
          this.store.db
            .insert(communityItems)
            .values({ collectionId: entry.id, itemId: item.id, artworkId: `${SOURCE}:${item.id}`, position: i })
            .onConflictDoNothing()
            .run()
          this.store.db
            .insert(communityRaw)
            .values({ itemId: item.id, json: JSON.stringify(item) })
            .onConflictDoUpdate({ target: communityRaw.itemId, set: { json: JSON.stringify(item) } })
            .run()
        }
      })()
      works += m.items.length
      onProgress?.(entry.title, works)
    }
    // Collections that left the repository.
    const gone = [...known.keys()].filter((id) => !seenCollections.includes(id))
    for (const id of gone) {
      this.store.db.delete(communityItems).where(eq(communityItems.collectionId, id)).run()
      this.store.db.delete(communityCollections).where(eq(communityCollections.id, id)).run()
    }
    const removed = this.pruneOrphans()
    this.store.rebuildSearch()
    const report: SyncReport = { collections: seenCollections.length, works, removed }
    if (this.store.getMeta("catalogue_source") !== "community") {
      report.migrated = await this.migrateLegacy()
      this.store.setMeta("catalogue_source", "community")
      this.store.rebuildSearch()
    }
    return report
  }

  private referenced(ids: string[]): Set<string> {
    const used = new Set<string>()
    if (!ids.length) return used
    for (const [table, col] of REFERENCES) {
      for (const chunk of chunks(ids, 500)) {
        const rows = this.store.sqlite
          .prepare(`SELECT DISTINCT ${col} AS id FROM ${table} WHERE ${col} IN (${chunk.map(() => "?").join(",")})`)
          .all(...chunk) as { id: string }[]
        for (const r of rows) used.add(r.id)
      }
    }
    for (const m of this.store.sqlite.prepare("SELECT value FROM meta WHERE key LIKE 'playback:%'").all() as {
      value: string
    }[]) {
      for (const id of ids) if (m.value.includes(JSON.stringify(id))) used.add(id)
    }
    return used
  }

  /** Community works no collection holds any more, unless something still uses them. */
  private pruneOrphans(): number {
    const orphans = (
      this.store.sqlite
        .prepare(
          `SELECT id FROM artworks WHERE source = '${SOURCE}' AND id NOT IN (SELECT artwork_id FROM community_items)`,
        )
        .all() as { id: string }[]
    ).map((r) => r.id)
    const used = this.referenced(orphans)
    const gone = orphans.filter((id) => !used.has(id))
    for (const chunk of chunks(gone, 500)) this.store.db.delete(artworks).where(inArray(artworks.id, chunk)).run()
    return gone.length
  }

  // ---------------------------------------------------------------- matching

  matchIndex(): MatchIndex {
    const rows = this.store.db
      .select({
        id: artworks.id,
        title: artworks.title,
        artist: artworks.artist,
        year: artworks.year,
        image: artworks.imageUrl,
        page: artworks.pageUrl,
      })
      .from(artworks)
      .where(eq(artworks.source, SOURCE))
      .all()
    const files = new Map<string, string>()
    const byTitle = new Map<string, Candidate[]>()
    for (const r of rows) {
      const raw = this.raw(r.id.slice(SOURCE.length + 1))
      for (const url of [r.page, r.image, raw?.image ?? ""]) {
        const f = commonsFile(url)
        if (f && !files.has(f)) files.set(f, r.id)
      }
      const key = normalize(r.title)
      if (key.length < 3) continue
      const list = byTitle.get(key) ?? []
      list.push({ id: r.id, surname: surname(r.artist), year: r.year })
      byTitle.set(key, list)
    }
    return { files, byTitle }
  }

  /** A work from a museum (live search or the old catalogue) that the catalogue already has, cheap checks only. */
  quickMatch(art: Artwork, idx: MatchIndex): { id: string; method: MatchMethod } | null {
    const native = `${SOURCE}:${art.source}-${art.sourceId}`
    if (art.source !== SOURCE && this.store.get(native)) return { id: native, method: "same-id" }
    for (const url of [art.pageUrl, art.imageUrl]) {
      const f = commonsFile(url)
      const hit = f ? idx.files.get(f) : undefined
      if (hit) return { id: hit, method: "commons-file" }
    }
    return null
  }

  /** Same title, artist and year, and the thumbnails look alike (dHash). */
  async lookAlike(art: Artwork, idx: MatchIndex, thumb: () => Promise<Buffer>): Promise<string | null> {
    const who = surname(art.artist)
    const candidates = (idx.byTitle.get(normalize(art.title)) ?? []).filter(
      (c) => c.surname === who && (c.year === null || art.year === null || Math.abs(c.year - art.year) <= 2),
    )
    if (!candidates.length) return null
    let mine: bigint
    try {
      mine = await dHash(await thumb())
    } catch {
      return null
    }
    for (const c of candidates) {
      const other = this.store.get(c.id)
      if (!other) continue
      try {
        if (hamming(mine, await dHash(await this.images.thumb(other))) <= LOOK_ALIKE_BITS) return c.id
      } catch {
        // no thumbnail, no verdict
      }
    }
    return null
  }

  async match(art: Artwork, idx: MatchIndex, thumb: () => Promise<Buffer>) {
    const quick = this.quickMatch(art, idx)
    if (quick) return quick
    const id = await this.lookAlike(art, idx, thumb)
    return id ? { id, method: "look-alike" as const } : null
  }

  // ---------------------------------------------------------------- migration from the museum catalogue

  /**
   * Up to 0.3.x the catalogue was harvested from museum APIs. Those works map onto the same
   * community work where one exists: favourites, albums, series, history, uploads on the TV and
   * playing series follow. A work nothing uses goes; a work in use without a match stays.
   */
  async migrateLegacy() {
    const legacy = this.store.db
      .select()
      .from(artworks)
      .where(sql`${artworks.source} NOT IN ('${sql.raw(SOURCE)}', 'mine')`)
      .all()
      .map((r) => this.store.get(r.id)!)
    const used = this.referenced(legacy.map((a) => a.id))
    const idx = this.matchIndex()
    const methods: Partial<Record<MatchMethod, number>> = {}
    let mapped = 0
    let kept = 0
    let removed = 0
    for (const art of legacy) {
      if (!used.has(art.id)) {
        this.store.db.delete(artworks).where(eq(artworks.id, art.id)).run()
        removed++
        continue
      }
      const m = await this.match(art, idx, () => this.images.thumb(art))
      if (!m) {
        kept++
        continue
      }
      this.remap(art.id, m.id)
      methods[m.method] = (methods[m.method] ?? 0) + 1
      mapped++
    }
    return { mapped, kept, removed, methods }
  }

  private remap(from: string, to: string) {
    const s = this.store.sqlite
    s.transaction(() => {
      for (const [table, col] of REFERENCES) {
        if (table === "favourites" || table === "album_items" || table === "series_items") {
          s.prepare(`UPDATE OR IGNORE ${table} SET ${col} = ? WHERE ${col} = ?`).run(to, from)
          s.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(from) // the target was already there
        } else {
          s.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(to, from)
        }
      }
      for (const row of s.prepare("SELECT key, value FROM meta WHERE key LIKE 'playback:%'").all() as {
        key: string
        value: string
      }[]) {
        if (row.value.includes(JSON.stringify(from)))
          s.prepare("UPDATE meta SET value = ? WHERE key = ?").run(
            row.value.split(JSON.stringify(from)).join(JSON.stringify(to)),
            row.key,
          )
      }
      s.prepare("DELETE FROM artworks WHERE id = ?").run(from)
    })()
  }
}

const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

// ------------------------------------------------------------------ sharing

const LICENCE_FROM_CATALOGUE: [RegExp, Licence][] = [
  [/^cc0|publicdomain\/zero/i, "CC0-1.0"],
  [/^(public domain|pd)$|publicdomain\/mark|^$/i, "PD"],
  [/by-sa\/4\.0|^cc-by-sa-4\.0$/i, "CC-BY-SA-4.0"],
  [/by-sa\/3\.0|^cc-by-sa-3\.0$/i, "CC-BY-SA-3.0"],
  [/by\/4\.0|^cc-by-4\.0$/i, "CC-BY-4.0"],
  [/by\/3\.0|^cc-by-3\.0$/i, "CC-BY-3.0"],
]

export const licenceOf = (licence: string): Licence | null => {
  if ((LICENCES as readonly string[]).includes(licence)) return licence as Licence
  return LICENCE_FROM_CATALOGUE.find(([re]) => re.test(licence.trim()))?.[1] ?? null
}

/** A line the collections bot can look up, or null when it can't. */
export function workLine(art: Artwork, item: Item | null): string | null {
  const id = item?.id ?? `${art.source}-${art.sourceId}`
  const [prefix, ...rest] = id.split("-")
  const tail = rest.join("-")
  if (prefix === "wikidata" && /^Q\d+$/.test(tail)) return tail
  if (prefix === "smk") return `https://open.smk.dk/artwork/image/${tail}`
  if (prefix === "met") return `https://www.metmuseum.org/art/collection/search/${tail}`
  const page = item?.source_url ?? art.pageUrl
  return page.includes("commons.wikimedia.org/wiki/File:") ? page : null
}

/** A catalogue work as a manifest item; null when the size isn't known. */
export function catalogueItem(art: Artwork, sourceName: string): Item | null {
  const licence = licenceOf(art.licence)
  if (!licence || !art.maxPx || !art.aspect || !art.imageUrl.startsWith("https://")) return null
  const landscape = art.aspect >= 1
  const width = landscape ? art.maxPx : Math.round(art.maxPx * art.aspect)
  const height = landscape ? Math.round(art.maxPx / art.aspect) : art.maxPx
  const page = art.pageUrl.startsWith("https://") ? art.pageUrl : null
  if (!page) return null
  const item: Item = {
    id: `${art.source}-${art.sourceId}`.replace(/[^A-Za-z0-9_.-]/g, "_"),
    title: art.title.slice(0, 300) || "Untitled",
    artist: art.artist.slice(0, 200) || "Unknown",
    year: art.year,
    image: art.imageUrl,
    width: Math.max(1, width),
    height: Math.max(1, height),
    licence,
    source: sourceName,
    source_url: page,
    ai_generated: art.tags.includes(AI_TAG),
  }
  if (art.dateText) item.date = art.dateText.slice(0, 80)
  if (art.thumbUrl.startsWith("https://")) item.thumbnail = art.thumbUrl
  if (art.attribution) item.attribution = art.attribution
  if (licence.startsWith("CC-BY") && !item.attribution) return null
  return item
}

export interface ShareMeta {
  id: string
  title: string
  description: string
  tags: string[]
  curator: Curator
}

/** GitHub's URL limit is about 8 KB; works that don't fit are left for the JSON file. */
const MAX_URL = 8000

export function issueUrl(meta: ShareMeta & { works: string[] }): { url: string; left: number } {
  const build = (works: string[]) => {
    const u = new URL(`${COMMUNITY_REPO}/issues/new`)
    u.searchParams.set("template", "new-collection.yml")
    u.searchParams.set("title", `New collection: ${meta.title}`)
    u.searchParams.set("collection_id", meta.id)
    u.searchParams.set("collection_title", meta.title)
    u.searchParams.set("description", meta.description)
    u.searchParams.set("tags", meta.tags.join(", "))
    u.searchParams.set("curator", meta.curator.name)
    u.searchParams.set("works", works.join("\n"))
    return u.toString()
  }
  let n = meta.works.length
  let url = build(meta.works)
  while (url.length > MAX_URL && n > 0) {
    n = Math.floor(n * 0.9)
    url = build(meta.works.slice(0, n))
  }
  return { url, left: meta.works.length - n }
}

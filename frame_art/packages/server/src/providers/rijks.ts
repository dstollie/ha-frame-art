/** Rijksmuseum Linked Art Search (no API key) + IIIF on iiif.micr.io. */
import { newArtwork, type Artwork } from "../models.js"
import { getJson } from "./http.js"
import type { ArtProvider, SearchContext } from "./types.js"

const SEARCH = "https://data.rijksmuseum.nl/search/collection"
const AAT_DUTCH = "http://vocab.getty.edu/aat/300388256"
const AAT_ENGLISH = "http://vocab.getty.edu/aat/300388277"
const HEIGHT = "https://id.rijksmuseum.nl/22011"
const WIDTH = "https://id.rijksmuseum.nl/22012"

/** Linked Art JSON is deeply nested and loosely shaped; these readers never throw on a missing level. */
type Node = { readonly [key: string]: unknown }
const node = (v: unknown): Node => (v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : {})
const list = (v: unknown): Node[] => (Array.isArray(v) ? v.map(node) : [])
const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "")

export function parseSearch(page: unknown): { ids: string[]; next: string | null } {
  const p = node(page)
  return {
    ids: list(p.orderedItems).map((i) => text(i.id)),
    next: text(node(p.next).id) || null,
  }
}

const langs = (n: Node) => new Set(list(n.language).map((l) => text(l.id)))

function title(obj: Node): string {
  const names = list(obj.identified_by).filter((n) => n.type === "Name")
  for (const lang of [AAT_DUTCH, AAT_ENGLISH]) {
    const hit = names.find((n) => langs(n).has(lang))
    if (hit) return text(hit.content).trim()
  }
  return names[0] ? text(names[0].content).trim() : "Zonder titel"
}

function artist(obj: Node): string {
  const produced = node(obj.produced_by)
  for (const part of list(produced.part)) {
    for (const actor of list(part.carried_out_by)) {
      const notes = list(actor.notation)
      const nl = notes.find((n) => n["@language"] === "nl")
      if (nl) return text(nl["@value"])
      if (notes[0]) return text(notes[0]["@value"])
    }
  }
  const ref = list(produced.referred_to_by).find((r) => langs(r).has(AAT_DUTCH))
  return ref ? text(ref.content) : ""
}

function date(obj: Node): [string, number | null] {
  const ts = node(node(obj.produced_by).timespan)
  let label = ""
  for (const n of list(ts.identified_by)) {
    if (langs(n).has(AAT_DUTCH) || !label) label = text(n.content)
  }
  const begin = text(ts.begin_of_the_begin)
  return [label, /^\d{4}/.test(begin) ? Number(begin.slice(0, 4)) : null]
}

function aspect(obj: Node): number | null {
  let h: number | null = null
  let w: number | null = null
  for (const d of list(obj.dimension)) {
    const kinds = new Set(list(d.classified_as).map((c) => text(c.id)))
    const raw = text(d.value)
    const v = Number(raw)
    if (!raw || !Number.isFinite(v)) continue
    if (kinds.has(HEIGHT) && h == null) h = v
    else if (kinds.has(WIDTH) && w == null) w = v
  }
  return h && w ? Math.round((w / h) * 10_000) / 10_000 : null
}

function imageAndPage(obj: Node): { image: string | null; page: string; isPublic: boolean } {
  let image: string | null = null
  let page = ""
  let isPublic = false
  for (const subject of list(obj.subject_of)) {
    for (const carrier of list(subject.digitally_carried_by)) {
      for (const ap of list(carrier.access_point)) {
        const url = text(ap.id)
        if (url.includes("iiif.micr.io")) {
          image = url
          isPublic = list(carrier.referred_to_by).some((r) => text(r.content).includes("publicdomain"))
        } else if (url.includes("rijksmuseum.nl") && url.includes("/collectie/") && !page) {
          page = url
        }
      }
    }
  }
  return { image, page, isPublic }
}

export const iiifBase = (url: string) => url.split("/full/")[0]!

export function parseObject(raw: unknown): Artwork | null {
  const obj = node(raw)
  const { image, page, isPublic } = imageAndPage(obj)
  if (!image || !isPublic) return null
  const number = text(list(obj.identified_by).find((i) => i.type === "Identifier")?.content)
  const [dateText, year] = date(obj)
  const base = iiifBase(image)
  return newArtwork({
    id: `rijks:${text(obj.id).split("/").pop()}`,
    source: "rijks",
    licence: "Public domain",
    sourceId: number || text(obj.id),
    title: title(obj),
    artist: artist(obj),
    dateText,
    year,
    department: "Rijksmuseum",
    medium: "schilderij",
    imageUrl: `${base}/full/max/0/default.jpg`,
    thumbUrl: `${base}/full/!800,800/0/default.jpg`,
    pageUrl: page,
    aspect: aspect(obj),
  })
}

/** Live search: ids from the Linked Art search, then the objects, a few at a time. */
export async function search(q: string, ctx: SearchContext): Promise<Artwork[]> {
  const page: unknown = await getJson<unknown>(
    ctx.fetch,
    `${SEARCH}?${new URLSearchParams({ description: q, imageAvailable: "true" })}`,
  )
  if (!page) return []
  const ids = parseSearch(page).ids.slice(0, ctx.limit)
  const out: Artwork[] = []
  for (let i = 0; i < ids.length; i += 4) {
    const objs = await Promise.all(
      ids
        .slice(i, i + 4)
        .map((lod) => getJson<unknown>(ctx.fetch, lod, { Accept: "application/ld+json" }).catch(() => null)),
    )
    for (const o of objs) {
      const art = o ? parseObject(o) : null
      if (art) out.push(art)
    }
  }
  return out
}

export const provider: ArtProvider = {
  id: "rijks",
  name: "Rijksmuseum",
  description: "Paintings from the Rijksmuseum in Amsterdam, from the Middle Ages to the 20th century.",
  homepage: "https://www.rijksmuseum.nl/en/collection",
  licence: "Public domain",
  defaultEnabled: true,
  thumbnails: "direct",
  search,
  downloadUrl: (art) => art.imageUrl.replace("/full/max/", "/full/!4096,4096/"),
}

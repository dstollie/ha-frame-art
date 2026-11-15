import { newArtwork, type Artwork } from "../models.js"
import { getJson, sleep, type Fetch } from "./http.js"
import type { ArtProvider } from "./types.js"

const BASE = "https://collectionapi.metmuseum.org/public/collection"

/** /v1/search was retired on 1 Oct 2026; /v1.1/search pages with offset/limit (max 500). */
export const QUERIES: Record<string, string>[] = [
  { departmentId: "11", q: "*" }, // European Paintings
  { departmentId: "1", medium: "Paintings", q: "*" }, // The American Wing
  { departmentId: "21", q: "painting" }, // Modern Art (public-domain part)
  { departmentId: "6", geoLocation: "Japan", q: "woodblock" }, // Japanese prints
]

interface MetObject {
  objectID: number
  isPublicDomain?: boolean
  primaryImage?: string
  primaryImageSmall?: string
  title?: string
  artistDisplayName?: string
  artistNationality?: string
  culture?: string
  objectDate?: string
  objectBeginDate?: number
  department?: string
  medium?: string
  objectURL?: string
  tags?: { term?: string }[] | null
  measurements?: { elementName?: string; elementMeasurements?: { Height?: number; Width?: number } }[] | null
}

function aspect(obj: MetObject): number | null {
  for (const m of obj.measurements ?? []) {
    if (["Overall", "Image", "Sheet"].includes(m.elementName ?? "")) {
      const { Height: h, Width: w } = m.elementMeasurements ?? {}
      if (h && w) return Math.round((w / h) * 10_000) / 10_000
    }
  }
  return null
}

export function parseObject(obj: MetObject): Artwork | null {
  if (!obj.isPublicDomain || !obj.primaryImage) return null
  return newArtwork({
    id: `met:${obj.objectID}`,
    source: "met",
    licence: "CC0",
    sourceId: String(obj.objectID),
    title: (obj.title || "Zonder titel").trim(),
    artist: (obj.artistDisplayName || obj.culture || "").trim(),
    nationality: obj.artistNationality ?? "",
    dateText: obj.objectDate ?? "",
    year: obj.objectBeginDate ? obj.objectBeginDate : null,
    department: obj.department ?? "",
    culture: obj.culture ?? "",
    medium: obj.medium ?? "",
    tags: (obj.tags ?? []).map((t) => t.term ?? "").filter(Boolean),
    imageUrl: obj.primaryImage,
    thumbUrl: obj.primaryImageSmall || obj.primaryImage,
    pageUrl: obj.objectURL ?? "",
    aspect: aspect(obj),
  })
}

async function ids(fetchFn: Fetch, query: Record<string, string>): Promise<number[]> {
  const out: number[] = []
  for (let offset = 0; ; offset += 500) {
    const params = new URLSearchParams({
      ...query,
      hasImages: "true",
      isPublicDomain: "true",
      offset: String(offset),
      limit: "500",
    })
    const page = await getJson<{ objectIDs: number[] | null }>(fetchFn, `${BASE}/v1.1/search?${params}`)
    const got = page?.objectIDs ?? []
    out.push(...got)
    if (got.length < 500) return out
  }
}

export async function* harvest(
  fetchFn: Fetch,
  known: Set<string>,
  opts: { delayMs?: number } = {},
): AsyncGenerator<Artwork> {
  const seen = new Set<number>()
  for (const query of QUERIES) {
    let list: number[]
    try {
      list = await ids(fetchFn, query)
    } catch {
      continue
    }
    for (const oid of list) {
      if (seen.has(oid) || known.has(`met:${oid}`)) continue
      seen.add(oid)
      try {
        const obj = await getJson<MetObject>(fetchFn, `${BASE}/v1/objects/${oid}`)
        const art = obj && parseObject(obj)
        if (art) yield art
      } catch {
        /* one broken object is not worth stopping for */
      }
      await sleep(opts.delayMs ?? 120)
    }
  }
}

export const provider: ArtProvider = {
  id: "met",
  name: "The Metropolitan Museum of Art",
  description: "European and American paintings and Japanese prints from The Met in New York.",
  homepage: "https://www.metmuseum.org/art/collection",
  licence: "CC0",
  defaultEnabled: true,
  thumbnails: "direct",
  harvest: (ctx) => harvest(ctx.fetch, ctx.known, ctx.delayMs == null ? {} : { delayMs: ctx.delayMs }),
  downloadUrl: (art) => art.imageUrl,
}

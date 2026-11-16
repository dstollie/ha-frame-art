import { newArtwork, type Artwork } from "../models.js"
import { getJson } from "./http.js"
import type { ArtProvider, SearchContext } from "./types.js"

const BASE = "https://collectionapi.metmuseum.org/public/collection"

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

/** Live search: ids from /v1.1/search (/v1/search was retired in Oct 2026), then the objects, six at a time. */
export async function search(q: string, ctx: SearchContext): Promise<Artwork[]> {
  const params = new URLSearchParams({
    q,
    hasImages: "true",
    isPublicDomain: "true",
    offset: "0",
    limit: String(ctx.limit),
  })
  const page = await getJson<{ objectIDs: number[] | null }>(ctx.fetch, `${BASE}/v1.1/search?${params}`)
  const ids = (page?.objectIDs ?? []).slice(0, ctx.limit)
  const out: Artwork[] = []
  for (let i = 0; i < ids.length; i += 6) {
    const objs = await Promise.all(
      ids.slice(i, i + 6).map((oid) => getJson<MetObject>(ctx.fetch, `${BASE}/v1/objects/${oid}`).catch(() => null)),
    )
    for (const o of objs) {
      const art = o && parseObject(o)
      if (art) out.push(art)
    }
  }
  return out
}

export const provider: ArtProvider = {
  id: "met",
  name: "The Metropolitan Museum of Art",
  description: "European and American paintings and Japanese prints from The Met in New York.",
  homepage: "https://www.metmuseum.org/art/collection",
  licence: "CC0",
  defaultEnabled: true,
  thumbnails: "direct",
  search,
  downloadUrl: (art) => art.imageUrl,
}

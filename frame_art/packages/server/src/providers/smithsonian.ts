/** Smithsonian American Art Museum through the Smithsonian Open Access API. Needs a free api.data.gov key. */
import { newArtwork, type Artwork } from "../models.js"
import { firstYear, getJson, round4 } from "./http.js"
import type { ArtProvider, SearchContext } from "./types.js"

const SEARCH = "https://api.si.edu/openaccess/api/v1.0/category/art_design/search"

interface Labeled {
  label?: string
  content?: string
}
interface Row {
  id: string
  title?: string
  content?: {
    descriptiveNonRepeating?: {
      record_link?: string
      data_source?: string
      online_media?: {
        media?: {
          idsId?: string
          usage?: { access?: string }
          resources?: { label?: string; width?: number; height?: number }[]
        }[]
      }
    }
    freetext?: { name?: Labeled[]; date?: Labeled[]; physicalDescription?: Labeled[] }
    indexedStructured?: { topic?: string[] }
  }
}

export function parseRow(row: Row): Artwork | null {
  const c = row.content ?? {}
  const media = c.descriptiveNonRepeating?.online_media?.media?.[0]
  if (!media?.idsId || media.usage?.access !== "CC0") return null
  const hi = media.resources?.find((r) => r.label === "High-resolution JPEG")
  const ids = `https://ids.si.edu/ids/deliveryService?id=${encodeURIComponent(media.idsId)}`
  const date = c.freetext?.date?.[0]?.content ?? ""
  return newArtwork({
    id: `smithsonian:${media.idsId}`,
    source: "smithsonian",
    licence: "CC0",
    sourceId: row.id,
    title: (row.title ?? "Untitled").trim(),
    artist: c.freetext?.name?.find((n) => n.label === "Artist")?.content ?? "",
    nationality: "American",
    dateText: date,
    year: firstYear(date),
    department: "Smithsonian American Art Museum",
    medium: c.freetext?.physicalDescription?.find((p) => p.label === "Medium")?.content ?? "",
    tags: c.indexedStructured?.topic ?? [],
    imageUrl: `${ids}&max=3840`,
    thumbUrl: `${ids}&max=800`,
    pageUrl: c.descriptiveNonRepeating?.record_link ?? "",
    aspect: hi?.width && hi.height ? round4(hi.width / hi.height) : null,
    maxPx: hi?.width && hi.height ? Math.max(hi.width, hi.height) : null,
  })
}

export function searchUrl(key: string, q: string, rows: number): string {
  const query = `${q} AND unit_code:SAAM AND online_media_type:Images`
  return `${SEARCH}?q=${encodeURIComponent(query)}&rows=${rows}&start=0&api_key=${encodeURIComponent(key)}`
}

async function search(q: string, ctx: SearchContext): Promise<Artwork[]> {
  if (!ctx.apiKey) return []
  const page = await getJson<{ response?: { rows?: Row[] } }>(ctx.fetch, searchUrl(ctx.apiKey, q, ctx.limit))
  return (page?.response?.rows ?? []).flatMap((row) => parseRow(row) ?? [])
}

export const provider: ArtProvider = {
  id: "smithsonian",
  name: "Smithsonian American Art Museum",
  description: "American paintings from the Smithsonian's open-access collection. Needs a free api.data.gov key.",
  homepage: "https://americanart.si.edu",
  licence: "CC0",
  defaultEnabled: false,
  apiKey: { required: true, helpUrl: "https://api.data.gov/signup/" },
  thumbnails: "direct",
  search,
  downloadUrl: (art) => art.imageUrl,
}

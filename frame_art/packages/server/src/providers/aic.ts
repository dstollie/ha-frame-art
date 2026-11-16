/** Art Institute of Chicago: public API + IIIF. Images need an AIC-User-Agent header (Cloudflare). */
import { newArtwork, type Artwork } from "../models.js"
import { USER_AGENT, getJson, round4 } from "./http.js"
import type { ArtProvider, SearchContext } from "./types.js"

const SEARCH = "https://api.artic.edu/api/v1/artworks/search"
const IIIF = "https://www.artic.edu/iiif/2"
const FIELDS = [
  "id",
  "title",
  "artist_title",
  "artist_display",
  "date_display",
  "date_start",
  "place_of_origin",
  "medium_display",
  "style_title",
  "classification_titles",
  "subject_titles",
  "image_id",
  "thumbnail",
  "is_public_domain",
  "department_title",
]
const HEADERS = { "AIC-User-Agent": USER_AGENT }

interface AicItem {
  id: number
  title?: string | null
  artist_title?: string | null
  artist_display?: string | null
  date_display?: string | null
  date_start?: number | null
  place_of_origin?: string | null
  medium_display?: string | null
  style_title?: string | null
  subject_titles?: string[] | null
  classification_titles?: string[] | null
  image_id?: string | null
  thumbnail?: { width?: number; height?: number } | null
  is_public_domain?: boolean
  department_title?: string | null
}

export function parseItem(item: AicItem): Artwork | null {
  if (!item.is_public_domain || !item.image_id) return null
  const w = item.thumbnail?.width ?? 0
  const h = item.thumbnail?.height ?? 0
  const nationality = (item.artist_display ?? "").split("\n")[1]?.split(",")[0]?.trim() ?? ""
  return newArtwork({
    id: `aic:${item.id}`,
    source: "aic",
    licence: "CC0",
    sourceId: String(item.id),
    title: (item.title || "Untitled").trim(),
    artist: (item.artist_title || (item.artist_display ?? "").split("\n")[0] || "").trim(),
    nationality,
    dateText: item.date_display ?? "",
    year: item.date_start ?? null,
    department: item.department_title ?? "",
    culture: item.place_of_origin ?? "",
    medium: item.medium_display ?? "",
    tags: [item.style_title ?? "", ...(item.subject_titles ?? []), ...(item.classification_titles ?? [])].filter(
      Boolean,
    ),
    imageUrl: `${IIIF}/${item.image_id}/full/!3000,3000/0/default.jpg`,
    thumbUrl: `${IIIF}/${item.image_id}/full/843,/0/default.jpg`,
    pageUrl: `https://www.artic.edu/artworks/${item.id}`,
    aspect: w && h ? round4(w / h) : null,
    maxPx: w && h ? Math.min(3000, Math.max(w, h)) : null,
  })
}

/** Live search over public-domain works with an image. */
export function searchBody(q: string, limit: number) {
  return {
    q,
    query: { bool: { must: [{ term: { is_public_domain: true } }, { exists: { field: "image_id" } }] } },
    limit,
    fields: FIELDS,
  }
}

async function search(q: string, ctx: SearchContext): Promise<Artwork[]> {
  const page = await getJson<{ data?: AicItem[] }>(
    ctx.fetch,
    SEARCH,
    { ...HEADERS, "Content-Type": "application/json" },
    { method: "POST", body: JSON.stringify(searchBody(q, ctx.limit)) },
  )
  return (page?.data ?? []).flatMap((item) => parseItem(item) ?? [])
}

export const provider: ArtProvider = {
  id: "aic",
  name: "Art Institute of Chicago",
  description: "Impressionist, American and European paintings from the Art Institute of Chicago.",
  homepage: "https://www.artic.edu/collection",
  licence: "CC0",
  defaultEnabled: true,
  thumbnails: "proxy",
  imageHeaders: HEADERS,
  search,
  downloadUrl: (art) => art.imageUrl,
}

/** SMK, the National Gallery of Denmark: open API, public-domain paintings with IIIF. No key. */
import { newArtwork, type Artwork } from "../models.js"
import { getJson, round4, sleep } from "./http.js"
import type { ArtProvider, HarvestContext } from "./types.js"

const SEARCH = "https://api.smk.dk/api/v1/art/search/"
const ROWS = 100

interface SmkItem {
  object_number: string
  titles?: { title?: string; language?: string }[]
  artist?: string[]
  production?: { creator?: string; creator_nationality?: string }[]
  production_date?: { start?: string; period?: string }[]
  content_subject?: string[]
  image_iiif_id?: string | null
  image_thumbnail?: string | null
  image_width?: number
  image_height?: number
  rights?: string
  public_domain?: boolean
  frontend_url?: string
  responsible_department?: string
}

const NATIONALITY: Record<string, string> = {
  dansk: "Danish",
  nederlandsk: "Dutch",
  hollandsk: "Dutch",
  flamsk: "Flemish",
  fransk: "French",
  tysk: "German",
  italiensk: "Italian",
  svensk: "Swedish",
  norsk: "Norwegian",
  engelsk: "English",
  spansk: "Spanish",
}

export function parseItem(item: SmkItem): Artwork | null {
  if (!item.public_domain || !item.image_iiif_id) return null
  const title = item.titles?.find((t) => t.language === "engelsk")?.title ?? item.titles?.[0]?.title ?? "Untitled"
  const w = item.image_width ?? 0
  const h = item.image_height ?? 0
  const start = item.production_date?.[0]?.start ?? ""
  const nat = (item.production?.[0]?.creator_nationality ?? "").toLowerCase()
  return newArtwork({
    id: `smk:${item.object_number}`,
    source: "smk",
    licence: "Public domain",
    sourceId: item.object_number,
    title: title.trim(),
    artist: item.artist?.[0] ?? "",
    nationality: NATIONALITY[nat] ?? nat,
    dateText: item.production_date?.[0]?.period ?? "",
    year: /^\d{4}/.test(start) ? Number(start.slice(0, 4)) : null,
    department: "SMK – National Gallery of Denmark",
    tags: item.content_subject ?? [],
    imageUrl: `${item.image_iiif_id}/full/!4096,4096/0/default.jpg`,
    thumbUrl: item.image_thumbnail ?? `${item.image_iiif_id}/full/!800,800/0/default.jpg`,
    pageUrl: item.frontend_url ?? "",
    aspect: w && h ? round4(w / h) : null,
    maxPx: w && h ? Math.min(4096, Math.max(w, h)) : null,
  })
}

export function searchUrl(offset: number): string {
  const filters = "[public_domain:true],[has_image:true],[object_names:maleri]"
  return `${SEARCH}?keys=*&filters=${encodeURIComponent(filters)}&offset=${offset}&rows=${ROWS}`
}

async function* harvest(ctx: HarvestContext): AsyncGenerator<Artwork> {
  for (let offset = 0; ; offset += ROWS) {
    const page = await getJson<{ items?: SmkItem[] }>(ctx.fetch, searchUrl(offset))
    const items = page?.items ?? []
    for (const item of items) {
      const art = parseItem(item)
      if (art && !ctx.known.has(art.id)) yield art
    }
    if (items.length < ROWS) return
    await sleep(ctx.delayMs ?? 500)
  }
}

export const provider: ArtProvider = {
  id: "smk",
  name: "SMK – National Gallery of Denmark",
  description: "Danish Golden Age, Dutch and Flemish masters and French modernists from Copenhagen.",
  homepage: "https://open.smk.dk",
  licence: "Public domain",
  defaultEnabled: true,
  thumbnails: "direct",
  harvest,
  downloadUrl: (art) => art.imageUrl,
}

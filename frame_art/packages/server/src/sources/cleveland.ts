import { newArtwork, type Artwork } from "../models.js"
import { getJson, sleep, type Fetch } from "./index.js"

const BASE = "https://openaccess-api.clevelandart.org/api/artworks/"
const PAGE = 500

interface CmaImage {
  url: string
  width?: string | number
  height?: string | number
}
interface CmaItem {
  id: number
  share_license_status?: string
  title?: string
  creation_date?: string
  creation_date_earliest?: number | null
  department?: string
  culture?: string[] | string | null
  technique?: string
  url?: string
  images?: { web?: CmaImage; print?: CmaImage; full?: CmaImage } | null
  creators?: { description?: string }[] | null
}

function artist(creators: CmaItem["creators"]): [string, string] {
  const desc = creators?.[0]?.description ?? ""
  if (!desc) return ["", ""]
  const name = desc.split(" (")[0]!.trim()
  const m = /\(([A-Za-z\- ]+?)[,)]/.exec(desc)
  return [name, m?.[1]?.trim() ?? ""]
}

export function parseItem(item: CmaItem): Artwork | null {
  if (item.share_license_status !== "CC0") return null
  const best = item.images?.print ?? item.images?.web
  const web = item.images?.web ?? best
  if (!best || !web) return null
  const w = Number(best.width ?? 0)
  const h = Number(best.height ?? 0)
  const [name, nationality] = artist(item.creators)
  const culture = Array.isArray(item.culture) ? item.culture.join(", ") : (item.culture ?? "")
  return newArtwork({
    id: `cleveland:${item.id}`,
    source: "cleveland",
    sourceId: String(item.id),
    title: (item.title || "Zonder titel").trim(),
    artist: name,
    nationality,
    dateText: item.creation_date ?? "",
    year: item.creation_date_earliest ?? null,
    department: item.department ?? "",
    culture,
    medium: item.technique ?? "",
    imageUrl: best.url,
    thumbUrl: web.url,
    pageUrl: item.url ?? "",
    aspect: w && h ? Math.round((w / h) * 10_000) / 10_000 : null,
    maxPx: Math.max(w, h) || null,
  })
}

export async function* harvest(
  fetchFn: Fetch,
  known: Set<string>,
  opts: { delayMs?: number } = {},
): AsyncGenerator<Artwork> {
  for (let skip = 0; ; skip += PAGE) {
    const params = new URLSearchParams({
      type: "Painting",
      cc0: "1",
      has_image: "1",
      limit: String(PAGE),
      skip: String(skip),
    })
    const page = await getJson<{ data?: CmaItem[] }>(fetchFn, `${BASE}?${params}`)
    const data = page?.data ?? []
    for (const item of data) {
      const art = parseItem(item)
      if (art && !known.has(art.id)) yield art
    }
    if (data.length < PAGE) return
    await sleep(opts.delayMs ?? 500)
  }
}

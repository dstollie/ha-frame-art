/** Wikimedia Commons: the public-domain paintings Google Arts & Culture digitised in high resolution. */
import { newArtwork, type Artwork } from "../models.js"
import { firstYear, getJson, round4, sleep } from "./http.js"
import type { ArtProvider, HarvestContext } from "./types.js"

const API = "https://commons.wikimedia.org/w/api.php"
const CATEGORY = "Category:Google_Art_Project_paintings"
const OPEN = /^(public domain|pd|cc0)/i

interface Page {
  pageid: number
  title: string
  imageinfo?: {
    url: string
    width: number
    height: number
    thumburl?: string
    descriptionurl?: string
    extmetadata?: Record<string, { value?: string }>
  }[]
}

const strip = (html: string | undefined) =>
  (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

/** "File:Jan Gossaert - Portrait of a Man - Google Art Project.jpg" → ["Jan Gossaert", "Portrait of a Man"] */
export function splitFileTitle(title: string): [string, string] {
  const name = title
    .replace(/^File:/, "")
    .replace(/\.[a-z]+$/i, "")
    .replace(/\s*-\s*Google Art Project.*$/i, "")
  const parts = name.split(" - ")
  return parts.length >= 2 ? [parts[0]!.trim(), parts.slice(1).join(" - ").trim()] : ["", name.trim()]
}

export function parsePage(page: Page): Artwork | null {
  const info = page.imageinfo?.[0]
  if (!info) return null
  const meta = info.extmetadata ?? {}
  const licence = strip(meta.LicenseShortName?.value)
  if (!OPEN.test(licence)) return null
  const [artist, title] = splitFileTitle(page.title)
  const fileName = page.title.replace(/^File:/, "")
  const filePath = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}`
  return newArtwork({
    id: `wikimedia:${page.pageid}`,
    source: "wikimedia",
    licence: "Public domain",
    sourceId: String(page.pageid),
    title: title || "Untitled",
    artist: artist || strip(meta.Artist?.value).slice(0, 120),
    dateText: strip(meta.DateTimeOriginal?.value).slice(0, 60),
    year: firstYear(strip(meta.DateTimeOriginal?.value)),
    department: "Wikimedia Commons (Google Art Project)",
    imageUrl: info.width > 3840 ? `${filePath}?width=3840` : info.url,
    thumbUrl: info.thumburl ?? `${filePath}?width=800`,
    pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
    aspect: info.width && info.height ? round4(info.width / info.height) : null,
    maxPx: Math.min(3840, Math.max(info.width, info.height)),
  })
}

export function pageUrl(cont: string | null): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "categorymembers",
    gcmtitle: CATEGORY,
    gcmtype: "file",
    gcmlimit: "50",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "800",
    iiextmetadatafilter: "LicenseShortName|Artist|DateTimeOriginal",
  })
  if (cont) params.set("gcmcontinue", cont)
  return `${API}?${params}`
}

async function* harvest(ctx: HarvestContext): AsyncGenerator<Artwork> {
  let cont: string | null = null
  do {
    const page: { query?: { pages?: Page[] }; continue?: { gcmcontinue?: string } } | null = await getJson(
      ctx.fetch,
      pageUrl(cont),
    )
    for (const p of page?.query?.pages ?? []) {
      if (ctx.known.has(`wikimedia:${p.pageid}`)) continue
      const art = parsePage(p)
      if (art) yield art
    }
    cont = page?.continue?.gcmcontinue ?? null
    await sleep(ctx.delayMs ?? 1000)
  } while (cont)
}

export const provider: ArtProvider = {
  id: "wikimedia",
  name: "Wikimedia Commons",
  description: "About 9,600 public-domain paintings from museums worldwide, digitised by the Google Art Project.",
  homepage: "https://commons.wikimedia.org/wiki/Category:Google_Art_Project_paintings",
  licence: "Public domain",
  defaultEnabled: true,
  thumbnails: "direct",
  harvest,
  downloadUrl: (art) => art.imageUrl,
}

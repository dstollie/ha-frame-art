/** Europeana: European cultural heritage aggregator. Public-domain and CC0 paintings only. */
import { newArtwork, type Artwork } from "../models.js"
import { firstYear, getJson, sleep } from "./http.js"
import type { ArtProvider, HarvestContext } from "./types.js"

const SEARCH = "https://api.europeana.eu/record/v2/search.json"
/** Europeana's public demo key; fine for a nightly sync, use your own for more. */
export const DEMO_KEY = "api2demo"
const OPEN = /creativecommons\.org\/publicdomain\//

interface Item {
  id: string
  title?: string[]
  dcCreator?: string[]
  year?: string[]
  rights?: string[]
  edmIsShownBy?: string[]
  edmPreview?: string[]
  dataProvider?: string[]
  guid?: string
  country?: string[]
}

export function parseItem(item: Item): Artwork | null {
  const image = item.edmIsShownBy?.[0] ?? ""
  if (!OPEN.test(item.rights?.[0] ?? "") || !/^https?:\/\//.test(image) || /\.ico(\?|$)/.test(image)) return null
  const creator = item.dcCreator?.find((c) => !/^https?:\/\//.test(c)) ?? ""
  const sourceId = item.id.replace(/^\//, "")
  return newArtwork({
    id: `europeana:${sourceId.replace(/\//g, "_")}`,
    source: "europeana",
    licence: item.rights?.[0]?.includes("/zero/") ? "CC0" : "Public domain",
    sourceId,
    title: (item.title?.[0] ?? "Untitled").slice(0, 300),
    artist: creator.replace(/\s*\(.*\)\s*$/, ""),
    dateText: item.year?.[0] ?? "",
    year: firstYear(item.year?.[0]),
    department: item.dataProvider?.[0] ?? "Europeana",
    culture: item.country?.[0] ?? "",
    imageUrl: image,
    thumbUrl: item.edmPreview?.[0] ?? image,
    pageUrl: (item.guid ?? `https://www.europeana.eu/item/${sourceId}`).split("?")[0]!,
  })
}

export function searchUrl(key: string, cursor: string): string {
  const params = new URLSearchParams({
    wskey: key,
    query: "what:(painting OR schilderij OR peinture OR gemälde OR pittura)",
    media: "true",
    thumbnail: "true",
    rows: "100",
    profile: "rich",
    cursor,
  })
  for (const qf of ["TYPE:IMAGE", "RIGHTS:*publicdomain*", "IMAGE_SIZE:extra_large"]) params.append("qf", qf)
  return `${SEARCH}?${params}`
}

async function* harvest(ctx: HarvestContext): AsyncGenerator<Artwork> {
  let cursor: string | null = "*"
  while (cursor) {
    const page: { items?: Item[]; nextCursor?: string } | null = await getJson(
      ctx.fetch,
      searchUrl(ctx.apiKey || DEMO_KEY, cursor),
    )
    for (const item of page?.items ?? []) {
      const art = parseItem(item)
      if (art && !ctx.known.has(art.id)) yield art
    }
    cursor = page?.nextCursor ?? null
    await sleep(ctx.delayMs ?? 1000)
  }
}

export const provider: ArtProvider = {
  id: "europeana",
  name: "Europeana",
  description: "Paintings from hundreds of European museums and archives. Quality varies per museum.",
  homepage: "https://www.europeana.eu",
  licence: "Public domain / CC0",
  defaultEnabled: false,
  apiKey: { required: false, helpUrl: "https://pro.europeana.eu/page/get-api" },
  thumbnails: "direct",
  harvest,
  downloadUrl: (art) => art.imageUrl,
}

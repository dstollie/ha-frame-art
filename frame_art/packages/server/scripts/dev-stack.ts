/**
 * Local stack for UI work and Playwright: two fake Frames, a temp /data, a seeded catalogue,
 * and the app served behind a fake HA ingress prefix (/api/hassio_ingress/<token>/).
 *
 *   tsx scripts/dev-stack.ts [--seed fake|live] [--port 8123] [--paired]
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { FakeFrame } from "@frame-art/frame-tv/fake"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import sharp from "sharp"

import { createApp } from "../src/app.js"
import { ensureDirs, paths, type Settings } from "../src/config.js"
import type { HomeAssistant } from "../src/ha.js"
import { newArtwork } from "../src/models.js"
import * as mine from "../src/providers/mine.js"
import type { ArtProvider } from "../src/providers/types.js"
import { FrameTV, type TV } from "../src/tv.js"

const args = new Map(process.argv.slice(2).map((a, i, all) => [a, all[i + 1] ?? "true"]))
const port = Number(args.get("--port") ?? 8123)
const seedMode = args.get("--seed") ?? "fake"
export const PREFIX = "/api/hassio_ingress/dev-token-123"
const here = path.dirname(fileURLToPath(import.meta.url))

const frames = [await new FakeFrame({ noisy: true }).start(), await new FakeFrame({ powerState: "standby" }).start()]
const dataDir = mkdtempSync(path.join(tmpdir(), "frame-art-dev-"))
const settings: Settings = {
  dataDir,
  tvs: [
    {
      id: "woonkamer",
      name: "Woonkamer",
      host: "127.0.0.1",
      wakeEntity: "media_player.samsung_the_frame_55",
      wsPort: frames[0]!.wsPort,
      restPort: frames[0]!.restPort,
    },
    {
      id: "slaapkamer",
      name: "Slaapkamer",
      host: "127.0.0.1",
      wakeEntity: "media_player.samsung_the_frame_32",
      wsPort: frames[1]!.wsPort,
      restPort: frames[1]!.restPort,
    },
  ],
  defaultMode: "light",
  keepUploads: 5,
  keepFavouriteUploads: 10,
  cacheMb: 500,
  syncHour: 4,
  syncOnStart: false,
  mqtt: false,
  supervisorToken: null,
}
ensureDirs(settings)

const ha: HomeAssistant = {
  available: true,
  async callService(_d, _s, data) {
    const i = data.entity_id === "media_player.samsung_the_frame_32" ? 1 : 0
    setTimeout(() => frames[i]!.setPower("on"), 1200)
    return true
  },
  async mqttService() {
    return null
  },
  async discover() {
    return false
  },
}

// Fake museum: generated paintings, so tests never depend on the internet.
const PALETTE: [number, number, number][] = [
  [63, 107, 74],
  [60, 90, 134],
  [201, 162, 74],
  [165, 64, 47],
  [107, 74, 43],
  [233, 227, 214],
  [40, 38, 36],
]
async function fakePainting(i: number, w: number, h: number): Promise<Buffer> {
  const [r, g, b] = PALETTE[i % PALETTE.length]!
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${r},${g},${b})"/><stop offset="1" stop-color="rgb(${(r + 120) % 255},${(g + 60) % 255},${(b + 30) % 255})"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.12}" fill="rgba(255,240,200,0.8)"/>
    <path d="M0 ${h * 0.75} Q ${w * 0.3} ${h * 0.55} ${w * 0.55} ${h * 0.72} T ${w} ${h * 0.68} V ${h} H 0 Z" fill="rgba(20,30,20,0.55)"/></svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()
}

const museum = new Hono().get("/img/:file", async (c) => {
  const m = /^(\d+)_(\d+)x(\d+)\.jpg$/.exec(c.req.param("file"))
  if (!m) return c.notFound()
  const buf = await fakePainting(Number(m[1]), Number(m[2]), Number(m[3]))
  return c.body(new Uint8Array(buf), 200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=3600" })
})

const base = `http://localhost:${port}`

/**
 * The fake seed is a small frame-art-collections: 72 works in themed collections that overlap,
 * two AI-made works, and one live-search museum whose results partly duplicate the catalogue.
 */
const FAKE_WORKS = [
  ["Gezicht op Delft", "Johannes Vermeer", 1660, "dutch"],
  ["Water Lilies", "Claude Monet", 1906, "impressionism"],
  ["The Harvesters", "Pieter Bruegel", 1565, "dutch"],
  ["View of Haarlem", "Jacob van Ruisdael", 1670, "dutch"],
  ["Stormy Sea", "Ludolf Backhuysen", 1690, "sea"],
  ["Still Life with Flowers", "Rachel Ruysch", 1700, "flowers"],
  ["Under the Wave off Kanagawa", "Katsushika Hokusai", 1830, "sea"],
  ["Portrait of a Woman", "Frans Hals", 1640, "dutch"],
  ["Poplars on the Epte", "Claude Monet", 1891, "impressionism"],
  ["Winter Landscape", "Hendrick Avercamp", 1610, "dutch"],
  ["The Beach at Scheveningen", "Hendrik Willem Mesdag", 1880, "sea"],
  ["Composition", "Piet Mondriaan", 1921, "modern"],
] as const
const COLLECTIONS: Record<string, [string, string]> = {
  dutch: ["Dutch Golden Age", "Vermeer, Ruisdael, Hals and Avercamp: light and everyday life in the Dutch Republic."],
  impressionism: ["Impressionism", "Monet and his circle: light, weather and loose brushwork."],
  sea: ["Seascapes", "Waves, beaches and harbours, from Dutch storms to Hokusai's great wave."],
  flowers: ["Flowers and still life", "Bouquets and tabletops painted with almost scientific care."],
  modern: ["Modern", "Early abstraction and the move away from the visible world."],
  ai: ["AI dreams", "Open-licensed images made with generative AI models."],
}
const PALETTE_IDS = ["green", "blue", "gold", "red", "brown", "light", "dark"] as const
const devImg = (i: number, w: number, h: number) => `${base}${PREFIX}/__museum/img/${i}_${w}x${h}.jpg`
const devItems = Array.from({ length: 72 }, (_, i) => {
  const [title, artist, year, theme] = FAKE_WORKS[i % FAKE_WORKS.length]!
  const portrait = i % 5 === 3
  const [w, h] = portrait ? [1500, 2000] : i % 4 === 0 ? [4200, 2360] : [3000, 2100]
  return {
    theme,
    item: {
      id: i % 9 === 0 ? `met-${1000 + i}` : `commons-dev${String(i).padStart(4, "0")}`,
      title: i < FAKE_WORKS.length ? title : `${title} ${Math.floor(i / FAKE_WORKS.length) + 1}`,
      artist,
      year,
      date: String(year),
      image: devImg(i, w, h),
      thumbnail: devImg(i, Math.round(w / 4), Math.round(h / 4)),
      width: w,
      height: h,
      licence: "PD",
      source: "Wikimedia Commons",
      source_url: `https://commons.wikimedia.org/wiki/File:Dev_${i}.jpg`,
      ai_generated: false,
      tags: [PALETTE_IDS[i % PALETTE_IDS.length]!],
    },
  }
})
const aiItems = [0, 1].map((n) => ({
  id: `commons-devai${n}`,
  title: n ? "Misty Valley" : "Glass Forest",
  artist: "Someone",
  year: 2024,
  image: devImg(100 + n, 3840, 2160),
  thumbnail: devImg(100 + n, 960, 540),
  width: 3840,
  height: 2160,
  licence: "CC-BY-SA-4.0",
  attribution: "Someone, CC BY-SA 4.0, via Wikimedia Commons",
  source: "Wikimedia Commons",
  source_url: `https://commons.wikimedia.org/wiki/File:Dev_ai_${n}.jpg`,
  ai_generated: true,
}))
const manifests = Object.fromEntries(
  Object.entries(COLLECTIONS).map(([id, [title, description]]) => {
    const items =
      id === "ai"
        ? aiItems
        : devItems
            // Monet's works are also seascapes now and then: collections overlap.
            .filter((d) => d.theme === id || (id === "sea" && d.item.artist === "Claude Monet" && d.item.year === 1906))
            .map((d) => d.item)
    return [
      id,
      {
        $schema: "https://dstollie.github.io/frame-art-collections/schema/collection.v1.schema.json",
        schema_version: 1,
        id,
        title,
        description,
        tags: [id],
        curator: { name: "Frame Art seed", github: "dstollie" },
        cover: items[0]!.id,
        items,
      },
    ]
  }),
)
const communityApp = new Hono()
communityApp.get("/index.json", (c) =>
  c.json({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    totals: { collections: Object.keys(manifests).length, items: 0, unique_items: 0 },
    collections: Object.values(manifests).map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      tags: m.tags,
      curator: m.curator,
      url: `${base}/__community/collections/${m.id}.json`,
      count: m.items.length,
      landscape_count: m.items.filter((i) => i.width > i.height).length,
      uhd_count: m.items.filter((i) => Math.max(i.width, i.height) >= 3840).length,
      ai_generated_count: m.items.filter((i) => i.ai_generated).length,
      licences: {},
      cover: {
        id: m.items[0]!.id,
        title: m.items[0]!.title,
        artist: m.items[0]!.artist,
        thumbnail: m.items[0]!.thumbnail,
        width: m.items[0]!.width,
        height: m.items[0]!.height,
      },
    })),
  }),
)
communityApp.get("/collections/:file", (c) => {
  const m = manifests[c.req.param("file").replace(/\.json$/, "")]
  return m ? c.json(m) : c.notFound()
})

/** A live-search museum for the fake seed: two new works and one the catalogue already has (met-1009). */
const devMuseum: ArtProvider = {
  id: "met",
  name: "The Metropolitan Museum of Art",
  description: "Dev stack stand-in for the Met's live search.",
  homepage: "https://www.metmuseum.org",
  licence: "CC0",
  defaultEnabled: true,
  thumbnails: "direct",
  downloadUrl: (a) => a.imageUrl,
  search: async (q) =>
    [
      [1009, "Water Lilies 2", "Claude Monet", 1906],
      [5001, "Bridge over a Pond", "Claude Monet", 1899],
      [5002, "Cypresses", "Vincent van Gogh", 1889],
    ]
      .filter(([, title, artist]) => `${title} ${artist}`.toLowerCase().includes(q.toLowerCase().split(" ")[0]!))
      .map(([id, title, artist, year]) =>
        newArtwork({
          id: `met:${id}`,
          source: "met",
          sourceId: String(id),
          title: String(title),
          artist: String(artist),
          year: Number(year),
          dateText: String(year),
          licence: "CC0",
          imageUrl: devImg(Number(id), 3200, 1800),
          thumbUrl: devImg(Number(id) % 72, 800, 450),
          pageUrl: `https://www.metmuseum.org/art/collection/search/${id}`,
          aspect: 1.7778,
          maxPx: 3200,
        }),
      ),
}

const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url)
  if (u.startsWith(`${base}/__community/`)) return communityApp.request(u.replace(`${base}/__community`, ""))
  if (u.startsWith(`${base}/__museum/`)) return museum.request(u.replace(`${base}/__museum`, ""))
  if (u.startsWith(`${PREFIX}/__museum/`)) return museum.request(u.replace(`${PREFIX}/__museum`, ""))
  return fetch(url, init)
}) as typeof fetch

const staticDir = path.resolve(here, "..", "..", "web", "dist")
const { app, svc } = createApp({
  settings,
  tvs: new Map<string, TV>(settings.tvs.map((t) => [t.id, new FrameTV(t, paths(settings).tokens)])),
  ha,
  fetchFn,
  staticDir,
  auth: "open",
  ...(seedMode === "fake" ? { communityBase: `${base}/__community`, providers: [mine.provider, devMuseum] } : {}),
})

async function seed() {
  const report = await svc.syncer.syncAll()
  if (seedMode === "fake") {
    // Colours the way the nightly enrichment would set them, without decoding 72 thumbnails.
    devItems.forEach(({ item }, i) => {
      const [r, g, b] = PALETTE[i % PALETTE.length]!
      svc.store.setColor(
        `community:${item.id}`,
        `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
        PALETTE_IDS[i % PALETTE_IDS.length]!,
      )
    })
  } else {
    void (async () => {
      while ((await svc.syncer.enrichColors(40)) > 0);
    })()
  }
  console.log(`dev stack: catalogue ${JSON.stringify(report)}`)
}
await seed()

if (args.has("--paired")) {
  for (const id of ["woonkamer", "slaapkamer"])
    await svc.tvs
      .get(id)!
      .pair()
      .catch(() => undefined)
}

// Fake HA ingress: everything lives under PREFIX; "/" redirects there.
const ingress = new Hono()
ingress.route("/__museum", museum)
ingress.route(PREFIX + "/__museum", museum)
ingress.all(`${PREFIX}/*`, (c) => {
  const url = new URL(c.req.url)
  url.pathname = url.pathname.slice(PREFIX.length) || "/"
  return app.fetch(new Request(url, c.req.raw))
})
ingress.get(PREFIX, (c) => c.redirect(`${PREFIX}/`))

// Fake Home Assistant: the panel as HA loads it (custom panel at /frame-art), with the integration's
// proxy paths. ?theme=dark switches HA's dark theme variables, ?lang=nl the language.
const HA_DARK = `--primary-background-color:#111111;--secondary-background-color:#202020;--card-background-color:#1c1c1c;
  --primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--divider-color:rgba(225,225,225,.12);
  --app-header-background-color:#111111;--app-header-text-color:#e1e1e1;--primary-color:#03a9f4;`
ingress.all("/api/frame_art/api/*", (c) => {
  const url = new URL(c.req.url)
  url.pathname = url.pathname.replace("/api/frame_art/api", "/api")
  return app.fetch(new Request(url, c.req.raw))
})
ingress.all("/api/frame_art/mcp", (c) => {
  const url = new URL(c.req.url)
  url.pathname = "/mcp"
  return app.fetch(new Request(url, c.req.raw))
})
ingress.get("/api/frame_art/panel.js", (c) => {
  const url = new URL(c.req.url)
  url.pathname = "/panel/frame-art-panel.js"
  return app.fetch(new Request(url, c.req.raw))
})
// What the integration's /api/frame_art/urls returns on a Nabu Casa set-up.
ingress.get("/api/frame_art/urls", (c) =>
  c.json({
    external: "https://example.ui.nabu.casa",
    external_is_cloud: true,
    internal: base,
    mcp_path: "/api/frame_art/mcp",
  }),
)
ingress.get("/frame-art/*", (c) => {
  const dark = c.req.query("theme") === "dark"
  const lang = c.req.query("lang") === "nl" ? "nl" : "en"
  return c.html(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Home Assistant (dev)</title>
<style>:root{font-family:Roboto,"Noto Sans",sans-serif;${dark ? HA_DARK : ""}} body{margin:0;background:var(--primary-background-color,#fafafa)}</style>
<script type="module" src="/api/frame_art/panel.js"></script></head><body>
<script>
  const el = document.createElement("frame-art-panel")
  el.panel = { url_path: "frame-art" }
  el.narrow = innerWidth < 870
  el.hass = { language: "${lang}", locale: { language: "${lang}" }, themes: { darkMode: ${dark} }, user: { is_admin: true },
    fetchWithAuth: (path, init) => fetch(path, init) }
  addEventListener("resize", () => (el.narrow = innerWidth < 870))
  document.body.append(el)
</script></body></html>`)
})
ingress.get("/frame-art", (c) => c.redirect("/frame-art/"))
ingress.get("/", (c) => c.redirect("/frame-art/"))

svc.player.load()
serve({ fetch: ingress.fetch, port }, () => {
  console.log(`dev stack: ${base}${PREFIX}/  (data ${dataDir}, seed ${seedMode}, catalogue ${svc.store.count()})`)
})

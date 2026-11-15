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
import { newArtwork, type Artwork } from "../src/models.js"
import * as cleveland from "../src/sources/cleveland.js"
import * as rijks from "../src/sources/rijks.js"
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
const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url instanceof Request ? url.url : url)
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
})

async function seed() {
  if (seedMode === "live") {
    const arts: Artwork[] = []
    for await (const a of cleveland.harvest(fetch, new Set(), { delayMs: 0 })) {
      arts.push(a)
      if (arts.length >= 600) break
    }
    let n = 0
    for await (const a of rijks.harvest(fetch, new Set(), { delayMs: 50 })) {
      arts.push(a)
      if (++n >= 60) break
    }
    svc.store.upsertArtworks(arts)
    void (async () => {
      while ((await svc.syncer.enrichColors(40)) > 0);
    })()
    return
  }
  const titles = [
    ["Gezicht op Delft", "Johannes Vermeer", 1660, "rijks"],
    ["Water Lilies", "Claude Monet", 1906, "met"],
    ["The Harvesters", "Pieter Bruegel", 1565, "met"],
    ["View of Haarlem", "Jacob van Ruisdael", 1670, "met"],
    ["Stormy Sea", "Ludolf Backhuysen", 1690, "rijks"],
    ["Still Life with Flowers", "Rachel Ruysch", 1700, "cleveland"],
    ["Under the Wave off Kanagawa", "Katsushika Hokusai", 1830, "met"],
    ["Portrait of a Woman", "Frans Hals", 1640, "rijks"],
    ["Poplars on the Epte", "Claude Monet", 1891, "met"],
    ["Winter Landscape", "Hendrick Avercamp", 1610, "rijks"],
    ["The Beach at Scheveningen", "Hendrik Willem Mesdag", 1880, "rijks"],
    ["Composition", "Piet Mondriaan", 1921, "cleveland"],
  ] as const
  const arts: Artwork[] = []
  for (let i = 0; i < 72; i++) {
    const [title, artist, year, source] = titles[i % titles.length]!
    const portrait = i % 5 === 3
    const [w, h] = portrait ? [1500, 2000] : i % 4 === 0 ? [3200, 1800] : [3000, 2100]
    arts.push(
      newArtwork({
        id: `${source}:${1000 + i}`,
        source,
        sourceId: String(1000 + i),
        title: i < titles.length ? title : `${title} ${Math.floor(i / titles.length) + 1}`,
        artist,
        year,
        dateText: String(year),
        nationality: source === "rijks" ? "Dutch" : "",
        culture: title.includes("Kanagawa") ? "Japan" : "",
        imageUrl: `${base}/__museum/img/${i}_${w}x${h}.jpg`,
        thumbUrl: `${PREFIX}/__museum/img/${i}_${Math.round(w / 4)}x${Math.round(h / 4)}.jpg`,
        pageUrl: "https://example.org",
        aspect: Math.round((w / h) * 10_000) / 10_000,
      }),
    )
  }
  svc.store.upsertArtworks(arts)
  arts.forEach((a, i) => {
    const [r, g, b] = PALETTE[i % PALETTE.length]!
    svc.store.setColor(
      a.id,
      `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
      ["groen", "blauw", "goud", "rood", "bruin", "licht", "donker"][i % 7]!,
    )
  })
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
ingress.get("/", (c) => c.redirect(`${PREFIX}/`))

serve({ fetch: ingress.fetch, port }, () => {
  console.log(`dev stack: ${base}${PREFIX}/  (data ${dataDir}, seed ${seedMode}, catalogue ${svc.store.count()})`)
})

/**
 * End to end: the real Hono app through its typed RPC client (hono/testing), the real FrameTV
 * talking the real protocol to a fake Frame, the real sharp pipeline, a fake museum and a fake HA.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { FakeFrame } from "@frame-art/frame-tv/fake"
import { testClient } from "hono/testing"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createApi, createServices, type Services } from "../src/app.js"
import { paths, type Settings } from "../src/config.js"
import type { HomeAssistant } from "../src/ha.js"
import type { JobDTO } from "../src/jobs.js"
import { MqttBridge } from "../src/mqtt.js"
import { FrameTV, type TV } from "../src/tv.js"
import { art, jpeg, tempSettings } from "./helpers.js"

let frame: FakeFrame
let settings: Settings
let svc: Services
let api: ReturnType<typeof testClient<ReturnType<typeof createApi>>>
let museumHits: string[]
const haCalls: { domain: string; service: string; data: Record<string, unknown> }[] = []

class FakeHA implements HomeAssistant {
  available = true
  async callService(domain: string, service: string, data: Record<string, unknown>) {
    haCalls.push({ domain, service, data })
    if (domain === "media_player" && service === "turn_on") setTimeout(() => frame.setPower("on"), 50)
    return true
  }
  async mqttService() {
    return null
  }
}

async function boot(opts: { power?: "on" | "standby"; wake?: boolean; paired?: boolean; trusted?: boolean } = {}) {
  frame = await new FakeFrame({
    powerState: opts.power ?? "on",
    noisy: true,
    ...(opts.trusted ? { onPairing: "trusted" as const } : {}),
  }).start()
  settings = tempSettings({
    tvs: [
      {
        id: "woonkamer",
        name: "Woonkamer",
        host: "127.0.0.1",
        wakeEntity: opts.wake === false ? null : "media_player.samsung_the_frame_55",
        wsPort: frame.wsPort,
        restPort: frame.restPort,
      },
    ],
  })
  const tvs = new Map<string, TV>([["woonkamer", new FrameTV(settings.tvs[0]!, paths(settings).tokens)]])
  museumHits = []
  const landscape = await jpeg(3000, 1900, [40, 100, 60])
  const portrait = await jpeg(1500, 2000, [120, 80, 40])
  const fetchFn = (async (url: string | URL) => {
    const u = String(url)
    museumHits.push(u)
    return new Response(new Uint8Array(u.includes("portrait") ? portrait : landscape), {
      headers: { "content-type": "image/jpeg" },
    })
  }) as typeof fetch
  svc = createServices({
    settings,
    tvs,
    ha: new FakeHA(),
    fetchFn,
    jobOptions: { pollMs: 20, settleMs: 10, wakeTimeoutMs: 2000 },
  })
  svc.store.upsertArtworks([
    art("met:1", { title: "Water Lilies", aspect: 1.58 }),
    art("met:2", { title: "Field of Poppies", aspect: 1.5 }),
    art("met:3", { title: "Portrait of a Lady", aspect: 0.75, imageUrl: "https://img.test/portrait.jpg" }),
    art("rijks:4", { title: "Gezicht op Delft", artist: "Johannes Vermeer", year: 1660, aspect: 1.2 }),
    art("cleveland:5", { title: "View of the Sea", artist: "Unknown", year: 1850, aspect: 1.8 }),
  ])
  api = testClient(createApi(svc))
  if (opts.paired !== false) {
    const r = await api.tvs[":tv"].pair.$post({ param: { tv: "woonkamer" } })
    expect(r.status).toBe(200)
  }
}

async function waitJob(id: string): Promise<JobDTO> {
  await svc.runner.idle()
  const r = await api.jobs[":id"].$get({ param: { id } })
  return (await r.json()) as JobDTO
}

beforeEach(() => {
  haCalls.length = 0
})
afterEach(async () => {
  svc?.store.close()
  await frame?.stop()
})

describe("pairing", () => {
  it("refuses to show on an unpaired TV, pairs on request and stores the token in /data/tokens", async () => {
    await boot({ paired: false })
    const before = await api.tvs[":tv"].show.$post({ param: { tv: "woonkamer" }, json: { artworkId: "met:1" } })
    expect(before.status).toBe(409)
    expect(frame.clientNames).toEqual([]) // no stray connection, so no prompt on the TV

    const r = await api.tvs[":tv"].pair.$post({ param: { tv: "woonkamer" } })
    expect(await r.json()).toMatchObject({ ok: true, paired: true, apiVersion: "4.3.4.0" })
    const tokenFile = path.join(paths(settings).tokens, "woonkamer.token")
    expect(readFileSync(tokenFile, "utf8")).toBe(frame.token)
    expect(frame.clientNames).toEqual(["FrameArt"])
  })
})

describe("pairing with a TV that hands out no token", () => {
  it("counts as paired once the TV accepted the connection, and one tap then works", async () => {
    await boot({ paired: false, trusted: true })
    const r = await api.tvs[":tv"].pair.$post({ param: { tv: "woonkamer" } })
    expect(await r.json()).toMatchObject({ ok: true, paired: true, apiVersion: "4.3.4.0" })
    expect(existsSync(path.join(paths(settings).tokens, "woonkamer.token"))).toBe(false)
    expect(existsSync(path.join(paths(settings).tokens, "woonkamer.paired"))).toBe(true)
    const tvs = await (await api.tvs.$get()).json()
    expect(tvs[0]).toMatchObject({ paired: true })

    const show = await api.tvs[":tv"].show.$post({ param: { tv: "woonkamer" }, json: { artworkId: "met:1" } })
    expect((await waitJob((await show.json()).id)).status).toBe("done")
    expect(frame.images.size).toBe(1)
  })
})

describe("one tap", () => {
  it("downloads, renders 3840x2160, uploads, selects and switches Art Mode on", async () => {
    await boot()
    const r = await api.tvs[":tv"].show.$post({
      param: { tv: "woonkamer" },
      json: { artworkId: "met:1", mode: "dark" },
    })
    expect(r.status).toBe(200)
    const job = await waitJob((await r.json()).id)
    expect(job.status).toBe("done")
    expect(job.steps.map((s) => [s.id, s.state])).toEqual([
      ["download", "done"],
      ["render", "done"],
      ["wake", "skipped"],
      ["show", "done"],
      ["cleanup", "skipped"],
    ])

    expect(frame.images.size).toBe(1)
    const [img] = [...frame.images.values()]
    const meta = await sharp(img!.data).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 3840, 2160])
    expect(img!.data.length).toBeLessThanOrEqual(4_000_000)
    expect(img!.matte).toBe("none")
    expect(frame.current).toBe(img!.contentId)
    expect(frame.artMode).toBe(true)

    const tvs = await (await api.tvs.$get()).json()
    expect(tvs[0]).toMatchObject({
      id: "woonkamer",
      paired: true,
      on: true,
      current: { artwork: { id: "met:1" }, mode: "dark" },
    })
    const hist = await (await api.history.$get({ query: {} })).json()
    expect(hist[0]).toMatchObject({ tv: "woonkamer", artwork: { id: "met:1" } })
  })

  it("re-uses the cached render the second time", async () => {
    await boot()
    for (let i = 0; i < 2; i++) {
      const r = await api.tvs[":tv"].show.$post({
        param: { tv: "woonkamer" },
        json: { artworkId: "met:2", mode: "light" },
      })
      const job = await waitJob((await r.json()).id)
      expect(job.status).toBe("done")
      if (i === 1) expect(job.steps[0]!.state).toBe("skipped")
    }
    expect(museumHits.filter((u) => u.includes("met:2"))).toHaveLength(1)
  })

  it("falls back from fill to light for a portrait work", async () => {
    await boot()
    const r = await api.tvs[":tv"].show.$post({
      param: { tv: "woonkamer" },
      json: { artworkId: "met:3", mode: "fill" },
    })
    expect((await r.json()).mode).toBe("light")
  })

  it("keeps only the newest uploads on the TV", async () => {
    await boot() // keepUploads = 3
    for (const id of ["met:1", "met:2", "rijks:4", "cleveland:5", "met:3"]) {
      const r = await api.tvs[":tv"].show.$post({ param: { tv: "woonkamer" }, json: { artworkId: id } })
      expect((await waitJob((await r.json()).id)).status).toBe("done")
    }
    expect(frame.images.size).toBe(3)
    expect(frame.requests.filter((q) => q.request === "delete_image_list")).toHaveLength(2)
  })

  it("wakes a TV in standby through HA, then shows", async () => {
    await boot({ power: "standby" })
    const r = await api.tvs[":tv"].show.$post({ param: { tv: "woonkamer" }, json: { artworkId: "met:1" } })
    const job = await waitJob((await r.json()).id)
    expect(job.status).toBe("done")
    expect(job.steps.find((s) => s.id === "wake")!.state).toBe("done")
    expect(haCalls).toEqual([
      { domain: "media_player", service: "turn_on", data: { entity_id: "media_player.samsung_the_frame_55" } },
    ])
  })

  it("fails clearly when the TV is off and cannot be woken", async () => {
    await boot({ power: "standby", wake: false })
    const r = await api.tvs[":tv"].show.$post({ param: { tv: "woonkamer" }, json: { artworkId: "met:1" } })
    const job = await waitJob((await r.json()).id)
    expect(job.status).toBe("error")
    expect(job.error).toMatch(/wake_entity/)
    expect(frame.images.size).toBe(0)
  })

  it("reports a TV-side failure on the job", async () => {
    await boot()
    frame.options.failRequests = { select_image: "-11" }
    const r = await api.tvs[":tv"].show.$post({ param: { tv: "woonkamer" }, json: { artworkId: "met:1" } })
    const job = await waitJob((await r.json()).id)
    expect(job.status).toBe("error")
    expect(job.error).toMatch(/select_image/)
    expect(job.steps.find((s) => s.id === "show")!.state).toBe("error")
  })
})

describe("browse, favourites, rotation", () => {
  it("lists with filters through the typed client", async () => {
    await boot()
    const all = await (await api.artworks.$get({ query: { landscape: "1" } })).json()
    expect(all.total).toBe(4)
    expect(all.items.every((a) => (a.aspect ?? 0) >= 1.2)).toBe(true)
    const golden = await (await api.artworks.$get({ query: { category: "gouden-eeuw" } })).json()
    expect(golden.items.map((a) => a.id)).toEqual(["rijks:4"])
    const cfg = await (await api.config.$get()).json()
    expect(cfg.frame).toMatchObject({ width: 3840, height: 2160 })
    expect(cfg.categories.find((c) => c.id === "zee")!.count).toBe(1)
    expect(cfg.tvs).toEqual([{ id: "woonkamer", name: "Woonkamer" }])
  })

  it("favourites and rotation over favourites", async () => {
    await boot()
    await api.artworks[":id"].favourite.$post({ param: { id: "cleveland:5" }, json: { on: true } })
    const favs = await (await api.artworks.$get({ query: { favourites: "1" } })).json()
    expect(favs.items.map((a) => a.id)).toEqual(["cleveland:5"])
    const detail = await (await api.artworks[":id"].$get({ param: { id: "cleveland:5" } })).json()
    expect(detail.favourite).toBe(true)

    await api.tvs[":tv"].category.$put({ param: { tv: "woonkamer" }, json: { category: "favorieten" } })
    const r = await api.tvs[":tv"].next.$post({ param: { tv: "woonkamer" } })
    const job = await waitJob((await r.json()).id)
    expect(job).toMatchObject({ status: "done", artworkId: "cleveland:5" })
  })

  it("MQTT: button press shows a new work from the rotation category; select changes it", async () => {
    await boot()
    const bridge = new MqttBridge(
      settings.tvs,
      { host: "unused", port: 1883 },
      {
        onNew: async (tv) => void svc.next(tv),
        onCategory: (tv, c) => svc.setCategory(tv, c),
        categoryOf: svc.categoryOf,
      },
    )
    await bridge.onMessage("frame_art/woonkamer/category/set", "Zee & water")
    expect(svc.categoryOf("woonkamer")).toBe("zee")
    await bridge.onMessage("frame_art/woonkamer/new/set", "PRESS")
    await svc.runner.idle()
    expect(svc.runner.latest("woonkamer")).toMatchObject({ status: "done", artworkId: "cleveland:5" })
    await bridge.onMessage("frame_art/onbekend/new/set", "PRESS") // ignored
  })

  it("does not touch the cache dir outside /data", async () => {
    await boot()
    expect(existsSync(paths(settings).renders)).toBe(true)
    expect(paths(settings).renders.startsWith(settings.dataDir)).toBe(true)
  })
})

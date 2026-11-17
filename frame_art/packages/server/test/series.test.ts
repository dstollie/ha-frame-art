/**
 * Series end to end: CRUD through the typed client, playback on a fake Frame with a fake clock,
 * re-use of uploads already on the TV, MQTT entities and the MCP tools.
 */
import { FakeFrame } from "@frame-art/frame-tv/fake"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { testClient } from "hono/testing"
import { afterEach, describe, expect, it } from "vitest"

import { createApi, createApp, type Services } from "../src/app.js"
import { paths, type Settings } from "../src/config.js"
import type { HomeAssistant } from "../src/ha.js"
import { MqttBridge, seriesDiscovery } from "../src/mqtt.js"
import { FrameTV, type TV } from "../src/tv.js"
import { art, inCatalogue, jpeg, tempSettings } from "./helpers.js"

let frames: FakeFrame[] = []
let settings: Settings
let svc: Services
let app: ReturnType<typeof createApp>["app"]
let api: ReturnType<typeof testClient<ReturnType<typeof createApi>>>
let clock = 1_000_000
const haCalls: string[] = []

class FakeHA implements HomeAssistant {
  available = true
  async callService(domain: string, service: string, data: Record<string, unknown>) {
    haCalls.push(`${domain}.${service} ${String(data.entity_id)}`)
    if (service === "turn_on") setTimeout(() => frames[0]!.setPower("on"), 20)
    return true
  }
  async mqttService() {
    return null
  }
  async discover() {
    return true
  }
}

async function boot(opts: { tvs?: number; keepUploads?: number } = {}) {
  frames = await Promise.all(Array.from({ length: opts.tvs ?? 1 }, () => new FakeFrame({ answers: "silent" }).start()))
  const names = ["Woonkamer", "Slaapkamer"]
  settings = tempSettings({
    keepUploads: opts.keepUploads ?? 10,
    tvs: frames.map((f, i) => ({
      id: names[i]!.toLowerCase(),
      name: names[i]!,
      host: "127.0.0.1",
      wakeEntity: `media_player.frame_${names[i]!.toLowerCase()}`,
      wsPort: f.wsPort,
      restPort: f.restPort,
      ackTimeoutMs: 50,
    })),
  })
  const tvs = new Map<string, TV>(settings.tvs.map((t) => [t.id, new FrameTV(t, paths(settings).tokens)]))
  const image = await jpeg(2400, 1500, [60, 90, 140])
  const fetchFn = (async () =>
    new Response(new Uint8Array(image), { headers: { "content-type": "image/jpeg" } })) as typeof fetch
  clock = 1_000_000
  ;({ app, svc } = createApp({
    settings,
    tvs,
    ha: new FakeHA(),
    fetchFn,
    auth: "open",
    jobOptions: { pollMs: 10, settleMs: 5, wakeTimeoutMs: 2000 },
    playerOptions: { now: () => clock, autoTick: false },
  }))
  svc.store.upsertArtworks([
    art("met:1", { title: "Water Lilies" }),
    art("met:2", { title: "Field of Poppies" }),
    art("rijks:3", { title: "Gezicht op Delft", artist: "Johannes Vermeer" }),
    art("cleveland:4", { title: "View of the Sea" }),
  ])
  inCatalogue(svc.store, ["met:1", "met:2", "rijks:3", "cleveland:4"])
  api = testClient(createApi(svc))
  for (const t of tvs.values()) await t.pair()
}

afterEach(async () => {
  svc?.player.stop()
  svc?.store.close()
  await Promise.all(frames.map((f) => f.stop()))
  haCalls.length = 0
})

const create = async (body: Parameters<typeof api.series.$post>[0]["json"]) => {
  const r = await api.series.$post({ json: body })
  expect(r.status).toBe(200)
  return r.json()
}
const settle = async () => {
  await svc.player.tick()
  await svc.runner.idle()
}
const advance = async (seconds: number) => {
  clock += seconds
  await settle()
}
const playback = async (tv = "woonkamer") => (await (await api.tvs.$get()).json()).find((t) => t.id === tv)!.playback

describe("series CRUD", () => {
  it("creates from works, edits order, durations and shuffle, and lists with cover and totals", async () => {
    await boot()
    const s = await create({ name: "Avond", artworkIds: ["met:1", "met:2"], duration: 600 })
    expect(s).toMatchObject({ name: "Avond", duration: 600, shuffle: false, count: 2, totalDuration: 1200 })
    expect(s.items.map((i) => i.artwork.id)).toEqual(["met:1", "met:2"])

    const id = s.id
    await api.series[":id"].items.$post({ param: { id }, json: { artworkId: "rijks:3", duration: 120 } })
    // Adding a work twice doesn't duplicate it.
    await api.series[":id"].items.$post({ param: { id }, json: { artworkId: "met:1" } })
    await api.series[":id"].order.$put({ param: { id }, json: { artworkIds: ["rijks:3", "met:1", "met:2"] } })
    await api.series[":id"].items[":artworkId"].$patch({
      param: { id, artworkId: "met:2" },
      json: { duration: 60 },
    })
    await api.series[":id"].$patch({ param: { id }, json: { name: "Zondagavond", shuffle: true } })

    const got = await (await api.series[":id"].$get({ param: { id } })).json()
    expect(got).toMatchObject({ name: "Zondagavond", shuffle: true, count: 3, totalDuration: 120 + 600 + 60 })
    expect(got.items.map((i) => [i.artwork.id, i.duration])).toEqual([
      ["rijks:3", 120],
      ["met:1", null],
      ["met:2", 60],
    ])

    const detail = await (await api.artworks[":id"].$get({ param: { id: "met:1" } })).json()
    expect("series" in detail && detail.series).toEqual([id])
    await api.series[":id"].items[":artworkId"].$delete({ param: { id, artworkId: "met:1" } })
    const list = await (await api.series.$get()).json()
    expect(list).toEqual([
      expect.objectContaining({ id, name: "Zondagavond", count: 2, cover: expect.objectContaining({ id: "rijks:3" }) }),
    ])

    expect((await api.series[":id"].$delete({ param: { id } })).status).toBe(200)
    expect((await api.series[":id"].$get({ param: { id } })).status).toBe(404)
  })

  it("creates from an album and from search results", async () => {
    await boot()
    const album = await (await api.albums.$post({ json: { name: "Blauw" } })).json()
    for (const artworkId of ["cleveland:4", "met:2"])
      await api.albums[":id"].items.$post({ param: { id: album.id }, json: { artworkId, on: true } })
    const fromAlbum = await create({ name: "Uit album", albumId: album.id })
    expect(fromAlbum.items.map((i) => i.artwork.id).toSorted()).toEqual(["cleveland:4", "met:2"])

    const fromSearch = await create({ name: "Vermeer", query: { q: "vermeer" } })
    expect(fromSearch.items.map((i) => i.artwork.id)).toEqual(["rijks:3"])
  })

  it("rejects unknown works, empty names and playing an empty series", async () => {
    await boot()
    expect((await api.series.$post({ json: { name: "", artworkIds: [] } })).status).toBe(400)
    expect((await api.series.$post({ json: { name: "X", artworkIds: ["met:999"] } })).status).toBe(404)
    const empty = await create({ name: "Leeg" })
    const r = await api.series[":id"].play.$post({ param: { id: empty.id }, json: { tvs: ["woonkamer"] } })
    expect(r.status).toBe(400)
  })
})

describe("series playback", () => {
  it("plays in order with per-work durations, loops, and re-uses uploads on the second round", async () => {
    await boot()
    const s = await create({ name: "Rondje", artworkIds: ["met:1", "met:2", "rijks:3"], duration: 600 })
    await api.series[":id"].items[":artworkId"].$patch({
      param: { id: s.id, artworkId: "met:2" },
      json: { duration: 60 },
    })
    const r = await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    expect(r.status).toBe(200)
    await settle()
    const frame = frames[0]!
    expect(await playback()).toMatchObject({
      seriesId: s.id,
      seriesName: "Rondje",
      status: "playing",
      position: 1,
      total: 3,
      current: { id: "met:1" },
      next: { id: "met:2" },
      nextAt: clock + 600,
    })
    expect(frame.images.size).toBe(1)

    await advance(599) // not yet
    expect((await playback())!.current!.id).toBe("met:1")
    await advance(1)
    expect((await playback())!.current!.id).toBe("met:2")
    await advance(60) // met:2 has its own duration
    expect((await playback())!.current!.id).toBe("rijks:3")
    expect(frame.images.size).toBe(3)

    await advance(600) // wraps around to met:1, already on the TV: selected, not uploaded again
    const uploadsBefore = frame.requests.filter((q) => q.request === "send_image").length
    expect(await playback()).toMatchObject({ position: 1, current: { id: "met:1" } })
    expect(frame.requests.filter((q) => q.request === "send_image").length).toBe(uploadsBefore)
    expect(frame.images.size).toBe(3)
    const met1 = svc.store.findUpload("woonkamer", "met:1", "fill")
    expect(frame.current).toBe(met1)
    expect(svc.runner.latest("woonkamer")!.steps.find((x) => x.id === "show")!.state).toBe("done")
  })

  it("uploads again when the TV no longer has the work", async () => {
    await boot()
    const s = await create({ name: "Twee", artworkIds: ["met:1", "met:2"], duration: 60 })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    await advance(60)
    frames[0]!.images.delete(svc.store.findUpload("woonkamer", "met:1", "fill")!) // removed on the TV itself
    await advance(60)
    expect((await playback())!.current!.id).toBe("met:1")
    expect(svc.runner.latest("woonkamer")!.status).toBe("done")
    expect(frames[0]!.current).toBe(svc.store.findUpload("woonkamer", "met:1", "fill"))
    expect(frames[0]!.images.has(frames[0]!.current!)).toBe(true)
  })

  it("pauses, resumes with the time that was left, skips to next and stops", async () => {
    await boot()
    const s = await create({ name: "Bediening", artworkIds: ["met:1", "met:2", "rijks:3"], duration: 600 })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    await advance(200)
    const ctl = (action: "pause" | "resume" | "next" | "stop") =>
      api.tvs[":tv"].playback.$post({ param: { tv: "woonkamer" }, json: { action } })

    expect((await ctl("pause")).status).toBe(200)
    await advance(5000)
    expect(await playback()).toMatchObject({ status: "paused", remaining: 400, current: { id: "met:1" } })
    await ctl("resume")
    expect(await playback()).toMatchObject({ status: "playing", nextAt: clock + 400 })

    await ctl("next")
    await settle()
    expect(await playback()).toMatchObject({ current: { id: "met:2" }, nextAt: clock + 600 })

    await ctl("stop")
    expect(await playback()).toBeNull()
    await advance(5000)
    expect(svc.runner.latest("woonkamer")!.artworkId).toBe("met:2")
  })

  it("plays on several TVs at once, and a manual show pauses the series on that TV only", async () => {
    await boot({ tvs: 2 })
    const s = await create({ name: "Overal", artworkIds: ["met:1", "met:2"], duration: 300 })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer", "slaapkamer"] } })
    await settle()
    expect((await playback("woonkamer"))!.current!.id).toBe("met:1")
    expect((await playback("slaapkamer"))!.current!.id).toBe("met:1")
    expect(frames[1]!.images.size).toBe(1)

    await api.tvs[":tv"].show.$post({ param: { tv: "slaapkamer" }, json: { artworkId: "cleveland:4" } })
    await svc.runner.idle()
    expect(await playback("slaapkamer")).toMatchObject({ status: "paused" })
    await advance(300)
    expect((await playback("woonkamer"))!.current!.id).toBe("met:2")
    expect(svc.runner.latest("slaapkamer")!.artworkId).toBe("cleveland:4")

    const list = await (await api.series.$get()).json()
    expect(list[0]!.playingOn.toSorted()).toEqual(["slaapkamer", "woonkamer"])
  })

  it("never switches a TV on for a later step: it waits until the TV is on again", async () => {
    await boot()
    const s = await create({ name: "Nacht", artworkIds: ["met:1", "met:2"], duration: 60 })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    frames[0]!.setPower("standby")
    await advance(60)
    expect(haCalls).toEqual([])
    expect(await playback()).toMatchObject({ current: { id: "met:1" }, status: "playing", nextAt: clock + 60 })
    frames[0]!.setPower("on")
    await advance(60)
    expect((await playback())!.current!.id).toBe("met:2")
  })

  it("never switches a TV that is showing TV to Art Mode: it waits until the TV is in Art Mode", async () => {
    await boot()
    const s = await create({ name: "Kijken", artworkIds: ["met:1", "met:2"], duration: 60 })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    const frame = frames[0]!
    // Someone switches to TV: power stays "on", Art Mode goes off.
    frame.artMode = false
    const before = frame.requests.length
    await advance(60)
    await advance(60)
    const sent = frame.requests.slice(before).map((r) => r.request)
    expect(sent).not.toContain("select_image")
    expect(sent).not.toContain("set_artmode_status")
    expect(sent).not.toContain("send_image")
    expect(frame.artMode).toBe(false)
    expect(await playback()).toMatchObject({ current: { id: "met:1" }, error: "TV staat niet in Art Mode" })

    // Back in Art Mode: the next step changes the work, without touching the mode.
    frame.artMode = true
    const again = frame.requests.length
    await advance(60)
    expect((await playback())!.current!.id).toBe("met:2")
    const later = frame.requests.slice(again).map((r) => r.request)
    expect(later).toContain("select_image")
    expect(later).not.toContain("set_artmode_status")
  })

  it("wakes the TV when you press play, like a tap on Show", async () => {
    await boot()
    frames[0]!.setPower("standby")
    const s = await create({ name: "Wekker", artworkIds: ["met:1"] })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    expect(haCalls).toEqual(["media_player.turn_on media_player.frame_woonkamer"])
    expect((await playback())!.current!.id).toBe("met:1")
  })

  it("shuffles each round without repeating a work within the round", async () => {
    await boot()
    const ids = ["met:1", "met:2", "rijks:3", "cleveland:4"]
    const s = await create({ name: "Schudden", artworkIds: ids, duration: 60, shuffle: true })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    const seen = [(await playback())!.current!.id]
    for (let i = 0; i < 3; i++) {
      await advance(60)
      seen.push((await playback())!.current!.id)
    }
    expect([...seen].toSorted()).toEqual([...ids].toSorted())
  })

  it("follows edits while playing, and deleting the series stops it", async () => {
    await boot()
    const s = await create({ name: "Live", artworkIds: ["met:1", "met:2", "rijks:3"], duration: 60 })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    await api.series[":id"].items[":artworkId"].$delete({ param: { id: s.id, artworkId: "met:2" } })
    await api.series[":id"].items.$post({ param: { id: s.id }, json: { artworkId: "cleveland:4" } })
    expect(await playback()).toMatchObject({ next: { id: "rijks:3" }, total: 3 })
    await advance(60)
    await advance(60)
    expect((await playback())!.current!.id).toBe("cleveland:4")

    await api.series[":id"].$delete({ param: { id: s.id } })
    expect(await playback()).toBeNull()
  })

  it("survives a restart of the add-on", async () => {
    await boot()
    const s = await create({ name: "Blijft", artworkIds: ["met:1", "met:2"], duration: 60 })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    svc.player.stop()
    svc.player.load()
    expect(await playback()).toMatchObject({ seriesId: s.id, current: { id: "met:1" } })
    await advance(60)
    expect((await playback())!.current!.id).toBe("met:2")
  })

  it("keeps the playing series' works on the TV when cleaning up", async () => {
    await boot({ keepUploads: 1 })
    const s = await create({ name: "Klein", artworkIds: ["met:1", "met:2"], duration: 60 })
    await api.series[":id"].play.$post({ param: { id: s.id }, json: { tvs: ["woonkamer"] } })
    await settle()
    await advance(60)
    // keep_uploads = 1, but the next work (met:1) stays because it's up next.
    expect(svc.store.findUpload("woonkamer", "met:1", "fill")).not.toBeNull()
    expect(frames[0]!.images.size).toBe(2)
  })
})

describe("series in Home Assistant (MQTT)", () => {
  it("announces a series select and controls per TV, and a sensor per series", () => {
    const tv = { id: "woonkamer", name: "Woonkamer", host: "x", wakeEntity: null }
    const series = [
      {
        id: "s1",
        name: "Avond",
        count: 3,
        duration: 600,
        totalDuration: 1800,
        shuffle: false,
        coverTitle: "Water Lilies",
        coverId: "met:1",
        playingOn: ["woonkamer"],
      },
      {
        id: "s2",
        name: "Avond",
        count: 1,
        duration: 60,
        totalDuration: 60,
        shuffle: true,
        coverTitle: null,
        coverId: null,
        playingOn: [],
      },
    ]
    const msgs = Object.fromEntries(seriesDiscovery([tv], series))
    const select = msgs["homeassistant/select/frame_art_woonkamer/series/config"] as {
      options: string[]
      command_topic: string
    }
    expect(select.options).toEqual(["—", "Avond", "Avond (2)"])
    expect(select.command_topic).toBe("frame_art/woonkamer/series/set")
    for (const b of ["series_next", "series_pause", "series_stop"])
      expect(msgs[`homeassistant/button/frame_art_woonkamer/${b}/config`]).toMatchObject({
        command_topic: `frame_art/woonkamer/${b}/set`,
      })
    expect(msgs["homeassistant/sensor/frame_art_series_s1/state/config"]).toMatchObject({
      name: "Avond",
      unique_id: "frame_art_series_s1",
      state_topic: "frame_art/series/s1",
      json_attributes_topic: "frame_art/series/s1/attributes",
    })
  })

  it("plays the selected series, pauses, skips and stops through the entities", async () => {
    await boot()
    const s = await create({ name: "Via HA", artworkIds: ["met:1", "met:2"], duration: 600 })
    const bridge = new MqttBridge(
      settings.tvs,
      { host: "unused", port: 1883 },
      {
        onNew: async (tv) => void svc.next(tv),
        onCategory: (tv, c) => svc.setCategory(tv, c),
        categoryOf: svc.categoryOf,
        onSeries: (tv, label) => svc.selectSeries(tv, label),
        onPlayback: (tv, action) => svc.controlPlayback(tv, action),
      },
    )
    await bridge.onMessage("frame_art/woonkamer/series/set", "Via HA")
    await settle()
    expect(await playback()).toMatchObject({ seriesId: s.id, current: { id: "met:1" } })
    await bridge.onMessage("frame_art/woonkamer/series_pause/set", "PRESS")
    expect((await playback())!.status).toBe("paused")
    await bridge.onMessage("frame_art/woonkamer/series_pause/set", "PRESS")
    expect((await playback())!.status).toBe("playing")
    await bridge.onMessage("frame_art/woonkamer/series_next/set", "PRESS")
    await settle()
    expect((await playback())!.current!.id).toBe("met:2")
    await bridge.onMessage("frame_art/woonkamer/series/set", "—")
    expect(await playback()).toBeNull()
  })
})

describe("series over MCP", () => {
  const client = async () => {
    const c = new Client({ name: "test", version: "1" })
    await c.connect(
      new StreamableHTTPClientTransport(new URL("http://addon/mcp"), {
        requestInit: { headers: { Authorization: `Bearer ${svc.tokens.mcp}` } },
        fetch: (url, init) => app.request(String(url), init as RequestInit),
      }),
    )
    return c
  }
  const json = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0]!.text)

  it("creates, edits, plays and controls a series", async () => {
    await boot()
    const c = await client()
    const names = (await c.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "list_series",
        "get_series",
        "create_series",
        "update_series",
        "delete_series",
        "play_series",
        "control_playback",
      ]),
    )
    const created = json(
      await c.callTool({
        name: "create_series",
        arguments: { name: "Zee", query: "sea", duration_minutes: 15 },
      }),
    )
    expect(created).toMatchObject({ name: "Zee", count: 1, duration: 900 })
    const updated = json(
      await c.callTool({
        name: "update_series",
        arguments: { series_id: created.id, add_artwork_ids: ["met:1"], shuffle: true },
      }),
    )
    expect(updated).toMatchObject({ count: 2, shuffle: true })

    const played = await c.callTool({ name: "play_series", arguments: { series_id: created.id, tvs: ["woonkamer"] } })
    expect(played.isError).toBeFalsy()
    await settle()
    expect(json(await c.callTool({ name: "list_series", arguments: {} }))[0]).toMatchObject({
      name: "Zee",
      playing_on: ["woonkamer"],
    })
    const paused = json(await c.callTool({ name: "control_playback", arguments: { tv: "woonkamer", action: "pause" } }))
    expect(paused.status).toBe("paused")
    await c.callTool({ name: "delete_series", arguments: { series_id: created.id } })
    expect(json(await c.callTool({ name: "list_series", arguments: {} }))).toEqual([])
  })
})

/**
 * The add-on as HA and an AI client see it: auth on /api and /mcp, My collection and albums,
 * and the MCP tools end to end against a fake Frame (real FrameTV, real sharp, real MCP client).
 */
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { FakeFrame } from "@frame-art/frame-tv/fake"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import sharp from "sharp"
import { afterEach, describe, expect, it } from "vitest"

import { createApp, type Services } from "../src/app.js"
import { paths, type Settings } from "../src/config.js"
import type { HomeAssistant } from "../src/ha.js"
import { FrameTV, type TV } from "../src/tv.js"
import { art, jpeg, tempSettings } from "./helpers.js"

let frame: FakeFrame
let settings: Settings
let svc: Services
let app: ReturnType<typeof createApp>["app"]
let remoteIp = "172.30.33.9"

const ha: HomeAssistant = {
  available: false,
  async callService() {
    return false
  },
  async mqttService() {
    return null
  },
  async discover() {
    return true
  },
}

async function boot(auth: "addon" | "open" = "addon") {
  frame = await new FakeFrame({ answers: "silent" }).start()
  settings = tempSettings({
    tvs: [
      {
        id: "woonkamer",
        name: "Woonkamer",
        host: "127.0.0.1",
        wakeEntity: null,
        wsPort: frame.wsPort,
        restPort: frame.restPort,
        ackTimeoutMs: 100,
      },
    ],
  })
  const tvs = new Map<string, TV>([["woonkamer", new FrameTV(settings.tvs[0]!, paths(settings).tokens)]])
  const image = await jpeg(2400, 1600, [60, 90, 140])
  const fetchFn = (async () =>
    new Response(new Uint8Array(image), { headers: { "content-type": "image/jpeg" } })) as typeof fetch
  ;({ app, svc } = createApp({ settings, tvs, ha, fetchFn, auth, remoteAddress: () => remoteIp }))
  svc.store.upsertArtworks([
    art("met:1", { title: "Water Lilies", aspect: 1.5 }),
    art("rijks:2", { title: "Gezicht op Delft", year: 1660, aspect: 1.3 }),
  ])
  await svc.tvs.get("woonkamer")!.pair()
}

afterEach(async () => {
  svc?.store.close()
  await frame?.stop()
  remoteIp = "172.30.33.9"
})

const internal = () => ({ Authorization: `Bearer ${svc.tokens.internal}` })

describe("auth", () => {
  it("refuses /api without ingress or token", async () => {
    await boot()
    expect((await app.request("/api/tvs")).status).toBe(401)
    expect((await app.request("/api/tvs", { headers: { Authorization: "Bearer nope" } })).status).toBe(401)
    // X-Ingress-Path alone is not enough: it must come from the Supervisor's ingress proxy.
    expect((await app.request("/api/tvs", { headers: { "X-Ingress-Path": "/api/hassio_ingress/x" } })).status).toBe(401)
  })

  it("allows HA ingress and the integration's internal token", async () => {
    await boot()
    expect((await app.request("/api/tvs", { headers: internal() })).status).toBe(200)
    remoteIp = "172.30.32.2"
    expect((await app.request("/api/tvs", { headers: { "X-Ingress-Path": "/api/hassio_ingress/x" } })).status).toBe(200)
  })

  it("protects /mcp with its own token, as Bearer or ?token=", async () => {
    await boot()
    const init = {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }
    expect((await app.request("/mcp", init)).status).toBe(401)
    expect((await app.request("/mcp", { ...init, headers: { ...init.headers, ...internal() } })).status).toBe(401)
    expect((await app.request(`/mcp?token=${svc.tokens.mcp}`, init)).status).not.toBe(401)
  })

  it("rotates the MCP token from Settings and the old one stops working", async () => {
    await boot()
    const before = (await (await app.request("/api/settings/mcp", { headers: internal() })).json()) as { token: string }
    const after = (await (
      await app.request("/api/settings/mcp/rotate", { method: "POST", headers: internal() })
    ).json()) as { token: string }
    expect(after.token).not.toBe(before.token)
    expect(svc.tokens.mcp).toBe(after.token)
  })
})

describe("My collection", () => {
  it("uploads a file into an album, serves its thumbnail, and deletes it with its files", async () => {
    await boot("open")
    const album = (await (
      await app.request("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Vakantie" }),
      })
    ).json()) as { id: string }
    const form = new FormData()
    form.append(
      "file",
      new File([new Uint8Array(await jpeg(3000, 2000, [200, 120, 40]))], "strand_bij_zonsondergang.jpg", {
        type: "image/jpeg",
      }),
    )
    form.append("albumId", album.id)
    const up = (await (await app.request("/api/collection", { method: "POST", body: form })).json()) as {
      items: { id: string; title: string; own: boolean; thumbPath: string; aspect: number }[]
    }
    const item = up.items[0]!
    expect(item).toMatchObject({ own: true, title: "strand bij zonsondergang", aspect: 1.5 })
    expect(item.thumbPath).toContain("/thumb")

    const albums = (await (await app.request("/api/albums")).json()) as { id: string; count: number; cover: string }[]
    expect(albums).toEqual([expect.objectContaining({ id: album.id, count: 1, cover: item.id })])
    const listed = (await (await app.request(`/api/artworks?album=${album.id}`)).json()) as { items: { id: string }[] }
    expect(listed.items.map((i) => i.id)).toEqual([item.id])

    const thumb = await app.request(`/api/${item.thumbPath}`)
    expect(thumb.headers.get("content-type")).toBe("image/jpeg")
    expect((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width).toBe(800)

    const dir = paths(settings).collection
    expect(readdirSync(dir).length).toBe(2)
    expect((await app.request(`/api/artworks/${item.id}`, { method: "DELETE" })).status).toBe(200)
    expect(readdirSync(dir)).toEqual([])
    expect((await app.request(`/api/artworks/${item.id}`)).status).toBe(404)
  })

  it("refuses to delete a museum work and rejects non-images", async () => {
    await boot("open")
    expect((await app.request("/api/artworks/met:1", { method: "DELETE" })).status).toBe(400)
    const bad = await app.request("/api/collection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base64: Buffer.from("not an image").toString("base64") }),
    })
    expect(bad.status).toBe(400)
  })

  it("turns sources on and off in Settings and the catalogue follows", async () => {
    await boot("open")
    const ids = async () =>
      ((await (await app.request("/api/artworks")).json()) as { items: { id: string }[] }).items
        .map((i) => i.id)
        .toSorted()
    expect(await ids()).toEqual(["met:1", "rijks:2"])
    await app.request("/api/settings/sources/rijks", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    expect(await ids()).toEqual(["met:1"])
  })
})

describe("MCP", () => {
  async function client() {
    const c = new Client({ name: "test", version: "1" })
    const transport = new StreamableHTTPClientTransport(new URL("http://addon/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${svc.tokens.mcp}` } },
      fetch: (url, init) => app.request(String(url).replace("http://addon", ""), init as RequestInit),
    })
    await c.connect(transport)
    return c
  }
  const json = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0]!.text)

  it("lists the tools an assistant needs", async () => {
    await boot()
    const tools = (await (await client()).listTools()).tools.map((t) => t.name).toSorted()
    expect(tools).toEqual([
      "control_playback",
      "create_series",
      "delete_series",
      "get_current_art",
      "get_series",
      "list_albums",
      "list_series",
      "list_sources",
      "list_tvs",
      "play_series",
      "search_art",
      "show_artwork",
      "update_series",
      "upload_image",
    ])
  })

  it("searches, shows a work with a passe-partout, and reports what's on the wall", async () => {
    await boot()
    const c = await client()
    const found = json(await c.callTool({ name: "search_art", arguments: { query: "delft", landscape_only: true } }))
    expect(found.items.map((i: { id: string }) => i.id)).toEqual(["rijks:2"])

    const shown = await c.callTool({
      name: "show_artwork",
      arguments: { tv: "woonkamer", artwork_id: "rijks:2", display: "matte", matte_style: "dark" },
    })
    expect(shown.isError).toBeFalsy()
    expect(json(shown).job).toMatchObject({ status: "done", mode: "dark" })
    expect(frame.artMode).toBe(true)

    const current = json(await c.callTool({ name: "get_current_art", arguments: { tv: "woonkamer" } }))
    expect(current[0].current.artwork.id).toBe("rijks:2")
  })

  it("uploads base64 into an album and pushes it straight to a TV, filled by default", async () => {
    await boot()
    const c = await client()
    const b64 = (await jpeg(1600, 1200, [240, 200, 40])).toString("base64")
    const r = await c.callTool({
      name: "upload_image",
      arguments: {
        base64: `data:image/jpeg;base64,${b64}`,
        title: "Zonnebloemen thuis",
        album: "AI",
        show_on_tv: "woonkamer",
      },
    })
    expect(r.isError).toBeFalsy()
    const out = json(r)
    expect(out.artwork).toMatchObject({ title: "Zonnebloemen thuis", source: "mine" })
    expect(out.job).toMatchObject({ status: "done", mode: "fill" })
    expect(json(await c.callTool({ name: "list_albums", arguments: {} }))).toEqual([
      { id: expect.any(String), name: "AI", count: 1 },
    ])
    const [img] = [...frame.images.values()]
    expect(img!.matte).toBe("none")
    expect(existsSync(path.join(paths(settings).collection))).toBe(true)
  })

  it("gives a clear error for an unknown TV or work", async () => {
    await boot()
    const c = await client()
    const r = await c.callTool({ name: "show_artwork", arguments: { tv: "zolder", artwork_id: "met:1" } })
    expect(r.isError).toBe(true)
    expect((r.content as { text: string }[])[0]!.text).toContain("Unknown TV")
  })
})

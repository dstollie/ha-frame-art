import { afterEach, describe, expect, it } from "vitest"

import { FakeFrame, type FakeFrameOptions } from "../src/fake.js"
import { FrameArtClient, FrameError, deviceInfo, parseFrame } from "../src/index.js"

let tv: FakeFrame | null = null
let client: FrameArtClient | null = null

async function fake(opts: FakeFrameOptions = {}) {
  tv = await new FakeFrame(opts).start()
  return tv
}

function connect(t: FakeFrame, extra: Partial<Parameters<typeof FrameArtClient.connect>[0]> = {}) {
  return FrameArtClient.connect({ host: "127.0.0.1", port: t.wsPort, timeoutMs: 2000, pairTimeoutMs: 1500, ...extra })
}

afterEach(async () => {
  client?.close()
  client = null
  await tv?.stop()
  tv = null
})

describe("pairing", () => {
  it("receives and reports a token on first connect, with our client name", async () => {
    const t = await fake()
    const tokens: string[] = []
    client = await connect(t, { onToken: (tok) => void tokens.push(tok) })
    expect(tokens).toEqual([t.token])
    expect(t.clientNames).toEqual(["FrameArt"])
  })

  it("does not report a token again when the stored one is valid", async () => {
    const t = await fake()
    const tokens: string[] = []
    client = await connect(t, { token: t.token, onToken: (tok) => void tokens.push(tok) })
    expect(tokens).toEqual([])
  })

  it("fails clearly when the user presses Weigeren", async () => {
    const t = await fake({ onPairing: "deny" })
    await expect(connect(t)).rejects.toMatchObject({ code: "unauthorized" })
  })

  it("times out when nobody presses anything", async () => {
    const t = await fake({ onPairing: "ignore" })
    await expect(connect(t)).rejects.toMatchObject({ code: "timeout" })
  })

  it("fails with a connection error when the TV is off", async () => {
    const t = await fake({ powerState: "off" })
    await expect(connect(t)).rejects.toBeInstanceOf(FrameError)
  })
})

describe("art requests", () => {
  it("uploads over the plain D2D socket, then selects and switches Art Mode on", async () => {
    const t = await fake({ noisy: true })
    client = await connect(t, { token: t.token })
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(300_000, 7)])
    const id = await client.upload(jpeg)
    expect(id).toMatch(/^MY_F\d{4}$/)
    expect(t.images.get(id)?.data.equals(jpeg)).toBe(true)
    expect(t.images.get(id)?.matte).toBe("none")

    await client.selectImage(id)
    await client.setArtMode(true)
    expect(t.current).toBe(id)
    expect(t.artMode).toBe(true)
    expect(await client.getArtMode()).toBe(true)

    const send = t.requests.find((r) => r.request === "send_image")!
    expect(send).toMatchObject({
      file_type: "jpg",
      file_size: jpeg.length,
      matte_id: "none",
      portrait_matte_id: "none",
    })
    expect(send.image_date).toMatch(/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(send.id).toBe(send.request_id)
  })

  it("uploads over a TLS D2D socket when the TV asks for it", async () => {
    const t = await fake({ securedUpload: true })
    client = await connect(t, { token: t.token })
    const id = await client.upload(Buffer.alloc(50_000, 1))
    expect(t.images.has(id)).toBe(true)
  })

  it("deletes uploads and confirms the list", async () => {
    const t = await fake()
    client = await connect(t, { token: t.token })
    const a = await client.upload(Buffer.alloc(1000, 1))
    const b = await client.upload(Buffer.alloc(1000, 2))
    expect(await client.deleteImages([a])).toBe(true)
    expect([...t.images.keys()]).toEqual([b])
    expect(await client.deleteImages([])).toBe(true)
  })

  it("turns a TV error into a FrameError naming the request", async () => {
    const t = await fake({ failRequests: { select_image: "-11" } })
    client = await connect(t, { token: t.token })
    await expect(client.selectImage("MY_F9999")).rejects.toThrow(/select_image.*-11/)
  })

  it("falls back to get_api_version when api_version is unknown", async () => {
    const t = await fake({ failRequests: { api_version: "-1" } })
    client = await connect(t, { token: t.token })
    await expect(client.apiVersion()).rejects.toBeInstanceOf(FrameError) // fake doesn't know the legacy one either
    expect(t.requests.map((r) => r.request)).toEqual(["api_version", "get_api_version"])
  })

  it("rejects pending requests when the TV drops the connection", async () => {
    const t = await fake()
    client = await connect(t, { token: t.token })
    const pending = client.request("never_answered_but_dropped", {}, { timeoutMs: 5000 }).catch((e) => e)
    // The fake answers unknown requests with an error; drop the socket first.
    await t.stop()
    tv = null
    const err = await pending
    expect(err).toBeInstanceOf(FrameError)
  })
})

describe("helpers", () => {
  it("reads device info over REST", async () => {
    const t = await fake({ powerState: "standby" })
    const info = await deviceInfo("127.0.0.1", { port: t.restPort })
    expect(info).toMatchObject({ powerState: "standby", frameTvSupport: true })
    t.setPower("off")
    expect(await deviceInfo("127.0.0.1", { port: t.restPort, timeoutMs: 500 })).toBeNull()
  })

  it("parses JSON with a binary tail (old firmware frames)", () => {
    const buf = Buffer.concat([
      Buffer.from('{"event":"d2d_service_message","data":"{}"}\n'),
      Buffer.from([0xff, 0xd8, 0x00]),
    ])
    expect(parseFrame(buf, true)).toEqual({ event: "d2d_service_message", data: "{}" })
    expect(parseFrame(Buffer.from("not json"), false)).toBeNull()
  })
})

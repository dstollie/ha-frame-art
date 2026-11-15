/**
 * Samsung The Frame art channel, ported from samsungtvws 3.0.7 (art/art.py, connection.py).
 *
 * Only the D2D-socket upload path (Art API on 2022+ firmware) is implemented; the 0.97
 * binary-frame path of older firmware is not.
 */
import { randomInt, randomUUID } from "node:crypto"
import net from "node:net"
import tls from "node:tls"

import { WebSocket, type RawData } from "ws"

export const ART_CHANNEL = "com.samsung.art-app"
export const DEFAULT_NAME = "FrameArt"

export class FrameError extends Error {
  constructor(
    message: string,
    readonly code: "unauthorized" | "timeout" | "connection" | "response" = "response",
  ) {
    super(message)
    this.name = "FrameError"
  }
}

export interface FrameOptions {
  host: string
  /** WSS port of the art channel. Real TVs: 8002. */
  port?: number
  /** HTTP port of the REST device info. Real TVs: 8001. */
  restPort?: number
  /** Client name shown in the TV's "Toestaan" prompt; the token is bound to it. */
  name?: string
  token?: string | null
  /** Called when the TV hands out a (new) token on connect. Persist it. */
  onToken?: (token: string) => void | Promise<void>
  timeoutMs?: number
  /** How long to wait for the user to press Toestaan on first pairing. */
  pairTimeoutMs?: number
}

export type D2DPayload = Record<string, unknown> & { event?: string; request_id?: string; id?: string }

interface Waiter {
  match: (p: D2DPayload) => boolean
  /** Errors are only attributed to a waiter when the request id matches. */
  requestId: string | null
  resolve: (p: D2DPayload) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export interface DeviceInfo {
  powerState: "on" | "standby" | string
  frameTvSupport: boolean
  model: string
  name: string
}

/** REST device info on :8001. Answers while on (TV or Art Mode); standby/off usually doesn't answer. */
export async function deviceInfo(
  host: string,
  opts: { port?: number; timeoutMs?: number } = {},
): Promise<DeviceInfo | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3000)
  try {
    const r = await fetch(`http://${host}:${opts.port ?? 8001}/api/v2/`, { signal: ctrl.signal })
    if (!r.ok) return null
    const body = (await r.json()) as { device?: Record<string, unknown> }
    const d = body.device ?? {}
    return {
      powerState: String(d.PowerState ?? "on"),
      frameTvSupport: String(d.FrameTVSupport).toLowerCase() === "true",
      model: String(d.modelName ?? ""),
      name: String(d.name ?? ""),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Parse a WS message: JSON text, or (old firmware) JSON followed by a binary tail. */
export function parseFrame(raw: RawData, isBinary: boolean): Record<string, unknown> | null {
  const buf = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw)
  const text = buf.toString("utf8")
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    if (!isBinary) return null
  }
  const start = buf.indexOf(0x7b)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < buf.length; i++) {
    if (buf[i] === 0x7b) depth++
    else if (buf[i] === 0x7d && --depth === 0) {
      try {
        return JSON.parse(buf.subarray(start, i + 1).toString("utf8")) as Record<string, unknown>
      } catch {
        return null
      }
    }
  }
  return null
}

function parseMaybeJson<T>(value: unknown): T | undefined {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T
    } catch {
      return undefined
    }
  }
  return (value ?? undefined) as T | undefined
}

export class FrameArtClient {
  private waiters = new Set<Waiter>()
  private closed = false

  private constructor(
    private readonly ws: WebSocket,
    private readonly opts: Required<Pick<FrameOptions, "host" | "timeoutMs">> & FrameOptions,
  ) {
    ws.on("message", (raw, isBinary) => this.onMessage(raw, isBinary))
    ws.on("close", () => this.failAll(new FrameError("Verbinding met de TV verbroken", "connection")))
    ws.on("error", (e) => this.failAll(new FrameError(`TV-verbinding: ${e.message}`, "connection")))
  }

  /** Open the art channel. Without a valid token the TV shows a "Toestaan" prompt; we wait for it. */
  static async connect(options: FrameOptions): Promise<FrameArtClient> {
    const opts = { port: 8002, name: DEFAULT_NAME, timeoutMs: 15_000, pairTimeoutMs: 60_000, ...options }
    const query = new URLSearchParams({ name: Buffer.from(opts.name).toString("base64") })
    if (opts.token) query.set("token", opts.token)
    const url = `wss://${opts.host}:${opts.port}/api/v2/channels/${ART_CHANNEL}?${query}`
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: opts.timeoutMs })

    const handshake = new Promise<void>((resolve, reject) => {
      let connected = false
      const timer = setTimeout(
        () => reject(new FrameError("Geen antwoord van de TV (Toestaan niet ingedrukt?)", "timeout")),
        opts.token ? opts.timeoutMs : opts.pairTimeoutMs,
      )
      const done = (err?: Error) => {
        clearTimeout(timer)
        ws.off("message", onMessage)
        if (err) reject(err)
        else resolve()
      }
      const onMessage = (raw: RawData, isBinary: boolean) => {
        const frame = parseFrame(raw, isBinary)
        const event = frame?.event
        if (event === "ms.channel.unauthorized") {
          done(new FrameError("De TV weigerde de verbinding (Toestaan niet gekozen)", "unauthorized"))
        } else if (event === "ms.channel.connect") {
          connected = true
          const token = (frame?.data as { token?: unknown } | undefined)?.token
          if (typeof token === "string" && token && token !== opts.token) {
            Promise.resolve(opts.onToken?.(token)).catch(() => undefined)
          }
        } else if (event === "ms.channel.ready" && connected) {
          done()
        } else if (event === "ms.error") {
          done(new FrameError(`TV-fout bij verbinden: ${JSON.stringify(frame?.data ?? {})}`, "connection"))
        }
      }
      ws.on("message", onMessage)
      ws.once("error", (e) => done(new FrameError(`Kan de TV niet bereiken: ${e.message}`, "connection")))
      ws.once("close", () => done(new FrameError("De TV sloot de verbinding", "connection")))
    })

    try {
      await handshake
    } catch (e) {
      ws.terminate()
      throw e
    }
    return new FrameArtClient(ws, opts)
  }

  private onMessage(raw: RawData, isBinary: boolean): void {
    const frame = parseFrame(raw, isBinary)
    if (!frame || frame.event !== "d2d_service_message") return
    const payload = parseMaybeJson<D2DPayload>(frame.data)
    if (!payload || typeof payload !== "object") return
    const msgId = (payload.request_id ?? payload.id) as string | undefined

    for (const w of this.waiters) {
      if (w.requestId && msgId !== w.requestId) continue
      if (payload.event === "error") {
        if (!w.requestId) continue
        const req = parseMaybeJson<{ request?: string }>(payload.request_data)?.request ?? "request"
        this.settle(w, new FrameError(`\`${req}\` mislukte met foutcode ${String(payload.error_code ?? "?")}`))
        continue
      }
      if (w.match(payload)) this.settle(w, payload)
    }
  }

  private settle(w: Waiter, result: D2DPayload | Error): void {
    clearTimeout(w.timer)
    this.waiters.delete(w)
    if (result instanceof Error) w.reject(result)
    else w.resolve(result)
  }

  private failAll(err: Error): void {
    this.closed = true
    for (const w of this.waiters) this.settle(w, err)
  }

  private waitFor(
    requestId: string | null,
    subEvent: string | null,
    timeoutMs = this.opts.timeoutMs,
  ): Promise<D2DPayload> {
    if (this.closed) return Promise.reject(new FrameError("Verbinding is gesloten", "connection"))
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        requestId,
        match: (p) => !subEvent || p.event === subEvent,
        resolve,
        reject,
        timer: setTimeout(
          () => this.settle(w, new FrameError(`Geen antwoord op ${subEvent ?? "verzoek"}`, "timeout")),
          timeoutMs,
        ),
      }
      this.waiters.add(w)
    })
  }

  private send(data: Record<string, unknown>): void {
    this.ws.send(
      JSON.stringify({
        method: "ms.channel.emit",
        params: { event: "art_app_request", to: "host", data: JSON.stringify(data) },
      }),
    )
  }

  /** Send an art request and wait for its D2D answer (optionally a specific sub-event). */
  async request(
    request: string,
    params: Record<string, unknown> = {},
    opts: { subEvent?: string; timeoutMs?: number; requestId?: string } = {},
  ): Promise<D2DPayload> {
    const id = opts.requestId ?? randomUUID()
    const answer = this.waitFor(id, opts.subEvent ?? null, opts.timeoutMs)
    this.send({ request, ...params, id, request_id: id })
    return answer
  }

  async apiVersion(): Promise<string> {
    let data: D2DPayload
    try {
      data = await this.request("api_version")
    } catch (e) {
      if (!(e instanceof FrameError) || e.code !== "response") throw e
      data = await this.request("get_api_version")
    }
    if (typeof data.version !== "string") throw new FrameError("Geen versie in antwoord")
    return data.version
  }

  /** Upload a JPEG/PNG to "My Photos"; returns the content id (MY_F....). */
  async upload(
    data: Buffer,
    opts: { fileType?: "jpg" | "png"; matte?: string; portraitMatte?: string; date?: Date; timeoutMs?: number } = {},
  ): Promise<string> {
    const fileType = opts.fileType ?? "jpg"
    const id = randomUUID()
    const timeoutMs = opts.timeoutMs ?? 60_000
    const ready = await this.request(
      "send_image",
      {
        file_type: fileType,
        file_size: data.length,
        image_date: formatDate(opts.date ?? new Date()),
        matte_id: opts.matte ?? "none",
        portrait_matte_id: opts.portraitMatte ?? "none",
        conn_info: { d2d_mode: "socket", connection_id: randomInt(2 ** 32 - 1), id },
      },
      { subEvent: "ready_to_use", requestId: id, timeoutMs },
    )
    const conn = parseMaybeJson<{ ip: string; port: number | string; key: string; secured?: boolean }>(ready.conn_info)
    if (!conn?.ip || !conn.port) throw new FrameError("TV gaf geen uploadadres (conn_info)")

    // Start listening before we send, so a fast "image_added" can't slip past.
    const added = this.waitFor(null, "image_added", timeoutMs)
    added.catch(() => undefined)
    const header = Buffer.from(
      JSON.stringify({
        num: 0,
        total: 1,
        fileLength: data.length,
        fileName: "image",
        fileType,
        secKey: conn.key,
        version: "0.0.1",
      }),
      "ascii",
    )
    const len = Buffer.alloc(4)
    len.writeUInt32BE(header.length)
    await sendD2D(conn.ip, Number(conn.port), Boolean(conn.secured), Buffer.concat([len, header, data]), timeoutMs)
    const done = await added
    if (typeof done.content_id !== "string") throw new FrameError("Upload zonder content_id")
    return done.content_id
  }

  async selectImage(contentId: string, show = true): Promise<void> {
    await this.request("select_image", { category_id: null, content_id: contentId, show })
  }

  async setArtMode(on: boolean): Promise<void> {
    await this.request("set_artmode_status", { value: on ? "on" : "off" })
  }

  async getArtMode(): Promise<boolean> {
    const data = await this.request("get_artmode_status")
    return data.value === "on"
  }

  async deleteImages(contentIds: string[]): Promise<boolean> {
    if (!contentIds.length) return true
    const list = contentIds.map((content_id) => ({ content_id }))
    const data = await this.request("delete_image_list", { content_id_list: list })
    const returned = parseMaybeJson<unknown>(data.content_id_list)
    return JSON.stringify(returned) === JSON.stringify(list)
  }

  close(): void {
    this.closed = true
    for (const w of this.waiters) this.settle(w, new FrameError("Verbinding gesloten", "connection"))
    this.ws.close()
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0")

function formatDate(d: Date): string {
  const p = pad2
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function sendD2D(host: string, port: number, secured: boolean, payload: Buffer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock: net.Socket = secured
      ? tls.connect({ host, port, rejectUnauthorized: false })
      : net.connect({ host, port })
    const fail = (e: Error) => {
      sock.destroy()
      reject(new FrameError(`Upload-socket: ${e.message}`, "connection"))
    }
    sock.setTimeout(timeoutMs, () => fail(new Error("timeout")))
    sock.once("error", fail)
    sock.once(secured ? "secureConnect" : "connect", () => {
      sock.end(payload, () => resolve())
    })
  })
}

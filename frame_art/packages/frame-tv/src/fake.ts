/**
 * A fake Samsung The Frame for tests: WSS art channel (self-signed TLS), D2D upload socket and
 * REST device info, speaking the same protocol the real TV does (as implemented by samsungtvws).
 */
import { randomBytes, randomUUID } from "node:crypto"
import http from "node:http"
import https from "node:https"
import net, { type AddressInfo } from "node:net"
import tls from "node:tls"

import selfsigned from "selfsigned"
import { WebSocketServer, type WebSocket } from "ws"

import { ART_CHANNEL } from "./index.js"

/** A throwaway self-signed certificate, generated per process: no key material in the repo. */
let certPromise: Promise<{ key: string; cert: string }> | null = null
function fakeCert() {
  certPromise ??= selfsigned
    .generate([{ name: "commonName", value: "fake-frame.test" }], { keySize: 2048 })
    .then((p) => ({ key: p.private, cert: p.cert }))
  return certPromise
}

export interface FakeFrameOptions {
  /**
   * What happens when a client connects without a valid token. "trusted" accepts it without
   * handing out a token, as a real Frame does when it already trusts the client (seen on a 2022 LS03B).
   */
  onPairing?: "allow" | "trusted" | "deny" | "ignore"
  /** Use a TLS D2D socket ("secured": true), as some firmware does. */
  securedUpload?: boolean
  powerState?: "on" | "standby" | "off"
  /** Fail these requests with an error code. */
  failRequests?: Record<string, string>
  /** Send unrelated events between answers, like a real TV does. */
  noisy?: boolean
  /**
   * How select_image and set_artmode_status are answered: "echo" (our request id), "broadcast"
   * (a different event without our id), or "silent" (no answer; seen on a 2022 QE55LS03B).
   */
  answers?: "echo" | "broadcast" | "silent"
}

export interface FakeImage {
  contentId: string
  data: Buffer
  fileType: string
  matte: string
}

export class FakeFrame {
  readonly images = new Map<string, FakeImage>()
  readonly requests: Array<Record<string, unknown>> = []
  readonly clientNames: string[] = []
  current: string | null = null
  artMode = false
  token = `tok-${randomBytes(6).toString("hex")}`
  wsPort = 0
  restPort = 0
  private counter = 0
  private tls!: { key: string; cert: string }
  private https!: https.Server
  private rest!: http.Server
  private wss!: WebSocketServer
  private d2dServers = new Set<net.Server>()

  constructor(readonly options: FakeFrameOptions = {}) {}

  get powerState() {
    return this.options.powerState ?? "on"
  }

  setPower(state: "on" | "standby" | "off") {
    this.options.powerState = state
  }

  async start(): Promise<this> {
    this.tls = await fakeCert()
    this.https = https.createServer(this.tls)
    this.wss = new WebSocketServer({ noServer: true })
    this.https.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "https://fake")
      if (url.pathname !== `/api/v2/channels/${ART_CHANNEL}` || this.powerState === "off") {
        socket.destroy()
        return
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, url))
    })
    this.rest = http.createServer((req, res) => {
      if (this.powerState === "off" || req.url !== "/api/v2/") {
        res.destroy()
        return
      }
      res.setHeader("content-type", "application/json")
      res.end(
        JSON.stringify({
          device: { PowerState: this.powerState, FrameTVSupport: "true", modelName: "QE55LS03BAU", name: "Fake Frame" },
        }),
      )
    })
    await Promise.all([listen(this.https), listen(this.rest)])
    this.wsPort = (this.https.address() as AddressInfo).port
    this.restPort = (this.rest.address() as AddressInfo).port
    return this
  }

  async stop(): Promise<void> {
    for (const c of this.wss.clients) c.terminate()
    for (const s of this.d2dServers) s.close()
    this.wss.close()
    await Promise.all([close(this.https), close(this.rest)])
  }

  private emit(ws: WebSocket, event: string, data: unknown) {
    ws.send(JSON.stringify({ event, data }))
  }

  private d2d(ws: WebSocket, payload: Record<string, unknown>) {
    if (this.options.noisy) this.emit(ws, "ms.channel.clientConnect", { id: "other" })
    this.emit(ws, "d2d_service_message", JSON.stringify(payload))
  }

  private confirm(ws: WebSocket, echo: Record<string, unknown>, broadcast: Record<string, unknown>) {
    const style = this.options.answers ?? "echo"
    if (style === "echo") this.d2d(ws, echo)
    else if (style === "broadcast") this.d2d(ws, broadcast)
  }

  private onConnection(ws: WebSocket, url: URL) {
    this.clientNames.push(Buffer.from(url.searchParams.get("name") ?? "", "base64").toString())
    const token = url.searchParams.get("token")
    if (token !== this.token) {
      const decision = this.options.onPairing ?? "allow"
      if (decision === "deny") {
        this.emit(ws, "ms.channel.unauthorized", {})
        return
      }
      if (decision === "ignore") return // user never presses anything
      const issued = decision === "trusted" ? {} : { token: this.token }
      this.emit(ws, "ms.channel.connect", { id: randomUUID(), ...issued, clients: [] })
    } else {
      this.emit(ws, "ms.channel.connect", { id: randomUUID(), clients: [] })
    }
    if (this.options.noisy) this.emit(ws, "ms.remote.touchEnable", {})
    this.emit(ws, "ms.channel.ready", {})
    ws.on("message", (raw) => this.onRequest(ws, raw.toString()))
  }

  private onRequest(ws: WebSocket, raw: string) {
    const msg = JSON.parse(raw) as { method: string; params: { event: string; to: string; data: string } }
    if (msg.method !== "ms.channel.emit" || msg.params.event !== "art_app_request") return
    const req = JSON.parse(msg.params.data) as Record<string, unknown> & { request: string; id: string }
    this.requests.push(req)
    const id = req.id
    const fail = this.options.failRequests?.[req.request]
    if (fail) {
      this.d2d(ws, { event: "error", request_id: id, id, error_code: fail, request_data: JSON.stringify(req) })
      return
    }
    switch (req.request) {
      case "api_version":
        return this.d2d(ws, { event: "api_version", request_id: id, id, version: "4.3.4.0" })
      case "send_image":
        return void this.receiveUpload(ws, req)
      case "select_image": {
        const cid = String(req.content_id)
        if (!this.images.has(cid)) {
          return this.d2d(ws, {
            event: "error",
            request_id: id,
            id,
            error_code: "-11",
            request_data: JSON.stringify(req),
          })
        }
        if (req.show) this.current = cid
        return this.confirm(
          ws,
          { event: "select_image", request_id: id, id, content_id: cid },
          {
            event: "image_selected",
            content_id: cid,
          },
        )
      }
      case "set_artmode_status":
        this.artMode = req.value === "on"
        return this.confirm(
          ws,
          { event: "set_artmode_status", request_id: id, id, value: req.value },
          {
            event: "artmode_status",
            value: req.value,
          },
        )
      case "get_artmode_status":
        return this.d2d(ws, { event: "get_artmode_status", request_id: id, id, value: this.artMode ? "on" : "off" })
      case "delete_image_list": {
        const list = req.content_id_list as Array<{ content_id: string }>
        for (const { content_id } of list) this.images.delete(content_id)
        return this.d2d(ws, { event: "delete_image_list", request_id: id, id, content_id_list: JSON.stringify(list) })
      }
      default:
        return this.d2d(ws, { event: "error", request_id: id, id, error_code: "-1", request_data: JSON.stringify(req) })
    }
  }

  private async receiveUpload(ws: WebSocket, req: Record<string, unknown> & { id: string }) {
    const key = randomBytes(8).toString("hex")
    const secured = Boolean(this.options.securedUpload)
    const expected = Number(req.file_size)
    const server = secured ? tls.createServer(this.tls) : net.createServer()
    this.d2dServers.add(server)
    server.on(secured ? "secureConnection" : "connection", (sock: net.Socket) => {
      const chunks: Buffer[] = []
      sock.on("data", (c: Buffer) => chunks.push(c))
      sock.on("end", () => {
        server.close()
        this.d2dServers.delete(server)
        const buf = Buffer.concat(chunks)
        const headerLen = buf.readUInt32BE(0)
        const header = JSON.parse(buf.subarray(4, 4 + headerLen).toString("ascii")) as Record<string, unknown>
        const data = buf.subarray(4 + headerLen)
        if (header.secKey !== key || data.length !== Number(header.fileLength) || data.length !== expected) {
          this.d2d(ws, {
            event: "error",
            request_id: req.id,
            id: req.id,
            error_code: "-7",
            request_data: JSON.stringify(req),
          })
          return
        }
        const contentId = `MY_F${String(++this.counter).padStart(4, "0")}`
        this.images.set(contentId, { contentId, data, fileType: String(header.fileType), matte: String(req.matte_id) })
        // The real TV answers with a fresh id here; the client must not rely on the request id.
        this.d2d(ws, { event: "image_added", request_id: randomUUID(), content_id: contentId })
      })
    })
    await listen(server)
    const port = (server.address() as AddressInfo).port
    const connInfo = JSON.stringify({ ip: "127.0.0.1", port, key, secured })
    this.d2d(ws, { event: "ready_to_use", request_id: req.id, id: req.id, conn_info: connInfo })
  }
}

function listen(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

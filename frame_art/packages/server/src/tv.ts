/**
 * One Frame: connection per action, token in /data/tokens/<tv>.token.
 *
 * The art channel has its own pairing ("Toestaan" for client "FrameArt"), separate from
 * SamsungTV Smart. We never connect without a token unless `pair()` is called explicitly,
 * so no stray request can pop up a prompt on the TV.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { FrameArtClient, FrameError, deviceInfo } from "@frame-art/frame-tv"

import type { TVConfig } from "./config.js"

/** Broadcasts a Frame sends on its own (or for other clients); seen on every upload, not worth a log line. */
const ROUTINE_EVENTS = new Set([
  "send_image",
  "image_added",
  "select_image",
  "image_selected",
  "recently_set_updated",
  "art_mode_changed",
  "artmode_status",
  "set_artmode_status",
  "go_to_standby",
  "wakeup",
])

export const isRoutineEvent = (p: Record<string, unknown>) => typeof p.event === "string" && ROUTINE_EVENTS.has(p.event)

export interface TV {
  readonly id: string
  readonly paired: boolean
  isOn(): Promise<boolean>
  pair(): Promise<{ apiVersion: string }>
  show(jpeg: Buffer): Promise<string>
  /** Select a work that is already on the TV; false when the TV no longer has it. */
  showExisting(contentId: string): Promise<boolean>
  remove(contentIds: string[]): Promise<void>
}

export class FrameTV implements TV {
  readonly id: string
  private readonly tokenFile: string
  private readonly pairedFile: string
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly cfg: TVConfig,
    tokenDir: string,
  ) {
    this.id = cfg.id
    this.tokenFile = path.join(tokenDir, `${cfg.id}.token`)
    this.pairedFile = path.join(tokenDir, `${cfg.id}.paired`)
  }

  /**
   * Paired once the TV accepted us. Some Frames hand out a token on that first connection,
   * others (already trusting the client) accept it without one; both count.
   */
  get paired(): boolean {
    return existsSync(this.pairedFile) || this.token() !== null
  }

  private token(): string | null {
    if (!existsSync(this.tokenFile)) return null
    return readFileSync(this.tokenFile, "utf8").trim() || null
  }

  async isOn(): Promise<boolean> {
    const info = await deviceInfo(this.cfg.host, { port: this.cfg.restPort ?? 8001 })
    return info?.powerState === "on"
  }

  /** One action at a time per TV; the TV dislikes parallel art connections. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => undefined)
    return next
  }

  private async withClient<T>(fn: (c: FrameArtClient) => Promise<T>, pairing = false): Promise<T> {
    const token = this.token()
    if (!this.paired && !pairing) throw new FrameError(`${this.cfg.name} is nog niet gekoppeld`, "unauthorized")
    const client = await FrameArtClient.connect({
      host: this.cfg.host,
      port: this.cfg.wsPort ?? 8002,
      token,
      onToken: (t) => writeFileSync(this.tokenFile, t, { mode: 0o600 }),
      timeoutMs: 20_000,
      pairTimeoutMs: 60_000,
      ...(this.cfg.ackTimeoutMs ? { ackTimeoutMs: this.cfg.ackTimeoutMs } : {}),
      onUnmatched: (p) => {
        if (isRoutineEvent(p) && !process.env.FRAME_ART_DEBUG) return
        console.log(`art ${this.id}: unanswered event ${JSON.stringify(p).slice(0, 300)}`)
      },
    })
    try {
      return await fn(client)
    } finally {
      client.close()
    }
  }

  pair() {
    return this.serial(() =>
      this.withClient(async (c) => {
        const apiVersion = await c.apiVersion()
        writeFileSync(
          this.pairedFile,
          JSON.stringify({ pairedAt: new Date().toISOString(), apiVersion, token: this.token() !== null }),
          { mode: 0o600 },
        )
        return { apiVersion }
      }, true),
    )
  }

  /** Upload, select and switch Art Mode on in one connection. Returns the content id. */
  show(jpeg: Buffer) {
    return this.serial(() =>
      this.withClient(async (c) => {
        const id = await c.upload(jpeg, { fileType: "jpg", matte: "none", portraitMatte: "none" })
        await c.selectImage(id, true)
        await c.setArtMode(true)
        return id
      }),
    )
  }

  showExisting(contentId: string) {
    return this.serial(() =>
      this.withClient(async (c) => {
        if (!(await c.contentIds()).includes(contentId)) return false
        await c.selectImage(contentId, true)
        await c.setArtMode(true)
        return true
      }),
    )
  }

  remove(contentIds: string[]) {
    return this.serial(() => this.withClient(async (c) => void (await c.deleteImages(contentIds))))
  }
}

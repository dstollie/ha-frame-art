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

export interface TV {
  readonly id: string
  readonly paired: boolean
  isOn(): Promise<boolean>
  pair(): Promise<{ apiVersion: string }>
  show(jpeg: Buffer): Promise<string>
  remove(contentIds: string[]): Promise<void>
}

export class FrameTV implements TV {
  readonly id: string
  private readonly tokenFile: string
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly cfg: TVConfig,
    tokenDir: string,
  ) {
    this.id = cfg.id
    this.tokenFile = path.join(tokenDir, `${cfg.id}.token`)
  }

  get paired(): boolean {
    return existsSync(this.tokenFile) && readFileSync(this.tokenFile, "utf8").trim().length > 0
  }

  private token(): string | null {
    return this.paired ? readFileSync(this.tokenFile, "utf8").trim() : null
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
    if (!token && !pairing) throw new FrameError(`${this.cfg.name} is nog niet gekoppeld`, "unauthorized")
    const client = await FrameArtClient.connect({
      host: this.cfg.host,
      port: this.cfg.wsPort ?? 8002,
      token,
      onToken: (t) => writeFileSync(this.tokenFile, t, { mode: 0o600 }),
      timeoutMs: 20_000,
      pairTimeoutMs: 60_000,
    })
    try {
      return await fn(client)
    } finally {
      client.close()
    }
  }

  pair() {
    return this.serial(() => this.withClient(async (c) => ({ apiVersion: await c.apiVersion() }), true))
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

  remove(contentIds: string[]) {
    return this.serial(() => this.withClient(async (c) => void (await c.deleteImages(contentIds))))
  }
}

/** Catalogue sync (nightly + on demand) and slow colour enrichment from thumbnails. */
import type { Store } from "./db.js"
import type { Artwork } from "./models.js"
import { dominantColor } from "./render.js"
import * as cleveland from "./sources/cleveland.js"
import { USER_AGENT, sleep, type Fetch, type Harvester } from "./sources/index.js"
import * as met from "./sources/met.js"
import * as rijks from "./sources/rijks.js"

export const HARVESTERS: Record<string, Harvester> = {
  cleveland: cleveland.harvest,
  met: met.harvest,
  rijks: rijks.harvest,
}

export interface SyncStatus {
  state: "idle" | "running"
  source: string | null
  added: number
  error: string | null
}

export class Syncer {
  status: SyncStatus = { state: "idle", source: null, added: 0, error: null }
  private stopped = false

  constructor(
    private readonly store: Store,
    private readonly fetchFn: Fetch = fetch,
    private readonly harvesters: Record<string, Harvester> = HARVESTERS,
    private readonly opts: { colorDelayMs?: number; harvestDelayMs?: number } = {},
  ) {}

  get running() {
    return this.status.state === "running"
  }

  toDTO() {
    return {
      ...this.status,
      lastRun: this.store.getMeta("last_sync"),
      total: this.store.count(),
      withColor: this.store.countWithColor(),
    }
  }

  trigger(): boolean {
    if (this.running) return false
    void this.syncAll()
    return true
  }

  async syncAll(): Promise<void> {
    if (this.running) return
    this.status = { state: "running", source: null, added: 0, error: null }
    try {
      for (const [name, harvest] of Object.entries(this.harvesters)) {
        if (this.stopped) return
        this.status.source = name
        let batch: Artwork[] = []
        try {
          const delay = this.opts.harvestDelayMs
          for await (const art of harvest(
            this.fetchFn,
            this.store.knownIds(name),
            delay != null ? { delayMs: delay } : {},
          )) {
            batch.push(art)
            if (batch.length >= 50) {
              this.status.added += this.store.upsertArtworks(batch)
              batch = []
            }
            if (this.stopped) break
          }
        } catch (e) {
          // One museum down must not stop the others.
          this.status.error = `${name}: ${e instanceof Error ? e.message : String(e)}`
        }
        if (batch.length) this.status.added += this.store.upsertArtworks(batch)
      }
      this.store.setMeta("last_sync", new Date().toISOString())
    } finally {
      this.status.state = "idle"
      this.status.source = null
    }
  }

  /** Dominant colour + (if missing) aspect from the thumbnail. Returns how many were done. */
  async enrichColors(batch = 20): Promise<number> {
    let done = 0
    for (const art of this.store.needingColor(batch)) {
      try {
        const r = await this.fetchFn(art.thumbUrl, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(30_000),
        })
        if (!r.ok) throw new Error(String(r.status))
        const c = await dominantColor(Buffer.from(await r.arrayBuffer()))
        this.store.setColor(art.id, c.hex, c.family, c.aspect)
        done++
      } catch {
        this.store.setColor(art.id, "#808080", "onbekend")
      }
      await sleep(this.opts.colorDelayMs ?? 1000)
    }
    return done
  }

  /** Background loop: sync on start (or when empty), nightly at syncHour, colours in between. */
  async loop(syncHour: number, syncOnStart: boolean): Promise<void> {
    if (syncOnStart || this.store.count() === 0) await this.syncAll()
    let lastDay = new Date().toDateString()
    while (!this.stopped) {
      const now = new Date()
      if (now.getHours() === syncHour && now.toDateString() !== lastDay) {
        lastDay = now.toDateString()
        await this.syncAll()
      }
      if (!this.running && (await this.enrichColors()) === 0) await sleep(60_000)
      else await sleep(1000)
    }
  }

  stop() {
    this.stopped = true
  }
}

/** Catalogue sync from the community collections (nightly + on demand) and slow colour enrichment. */
import type { Catalogue, SyncReport } from "./community.js"
import type { Store } from "./db.js"
import type { Artwork } from "./models.js"
import { USER_AGENT, sleep, type Fetch } from "./providers/http.js"
import { dominantColor } from "./render.js"
import type { Sources } from "./sources.js"

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
    private readonly sources: Sources,
    private readonly catalogue: Catalogue,
    private readonly fetchFn: Fetch = fetch,
    private readonly opts: {
      colorDelayMs?: number
      /** Thumbnail bytes for colour analysis; defaults to fetching `thumbUrl`. */
      thumb?: (art: Artwork) => Promise<Buffer>
    } = {},
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
      collections: this.catalogue.collections().length,
    }
  }

  trigger(): boolean {
    if (this.running) return false
    void this.syncAll()
    return true
  }

  /** Brings the catalogue in line with frame-art-collections. */
  async syncAll(): Promise<SyncReport | null> {
    if (this.running) return null
    this.status = { state: "running", source: null, added: 0, error: null }
    try {
      const report = await this.catalogue.sync((collection, works) => {
        this.status.source = collection
        this.status.added = works
      })
      if (report.migrated) console.log(`catalogue: moved to the community collections`, JSON.stringify(report.migrated))
      this.store.setMeta("last_sync", new Date().toISOString())
      return report
    } catch (e) {
      this.status.error = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      this.status.state = "idle"
      this.status.source = null
    }
  }

  private async thumb(art: Artwork): Promise<Buffer> {
    if (this.opts.thumb) return this.opts.thumb(art)
    const r = await this.fetchFn(art.thumbUrl, {
      headers: { "User-Agent": USER_AGENT, ...this.sources.get(art.source)?.imageHeaders },
      signal: AbortSignal.timeout(30_000),
    })
    if (!r.ok) throw new Error(String(r.status))
    return Buffer.from(await r.arrayBuffer())
  }

  /** Dominant colour + (if missing) aspect from the thumbnail. Returns how many were done. */
  async enrichColors(batch = 20): Promise<number> {
    let done = 0
    for (const art of this.store.needingColor(batch)) {
      try {
        const c = await dominantColor(await this.thumb(art))
        this.store.setColor(art.id, c.hex, c.family, c.aspect)
        done++
      } catch {
        this.store.setColor(art.id, "#808080", "unknown")
      }
      await sleep(this.opts.colorDelayMs ?? 1000)
    }
    return done
  }

  /** Background loop: sync on start (or when empty), nightly at syncHour, colours in between. */
  async loop(syncHour: number, syncOnStart: boolean): Promise<void> {
    // The first start after 0.4.0 moves the catalogue to the community collections.
    const moved = this.store.getMeta("catalogue_source") === "community"
    if (syncOnStart || !moved || this.store.count() === 0) await this.syncAll()
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

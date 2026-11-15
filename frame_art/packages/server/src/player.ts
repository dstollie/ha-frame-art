/**
 * Plays series on TVs. One playback per TV, kept in SQLite meta so it survives a restart.
 * The add-on drives the schedule; each step is a normal job, which selects the work when it's
 * still on the TV and uploads it otherwise. See knowledge/codebase/06-adr-series-playback.md.
 */
import type { Store } from "./db.js"
import type { JobRunner } from "./jobs.js"
import type { Mode } from "./models.js"
import type { SeriesRow, SeriesStore } from "./series.js"
import type { TV } from "./tv.js"

export type PlaybackAction = "pause" | "resume" | "toggle" | "next" | "stop"

interface Playback {
  seriesId: string
  order: string[]
  current: string
  index: number
  status: "playing" | "paused"
  /** Epoch seconds of the next step while playing. */
  nextAt: number
  /** Seconds that were left when paused. */
  remaining: number | null
  error: string | null
}

export interface PlayerOptions {
  now?: () => number
  /** Run the timer; tests call tick() themselves. */
  autoTick?: boolean
  /** Seconds to wait before trying again when a TV is off. */
  retryS?: number
}

export interface PlayerDeps {
  store: Store
  series: SeriesStore
  runner: JobRunner
  tvs: Map<string, TV>
  modeFor: (tv: string) => Mode
  onChange?: (tv: string) => void
}

const shuffled = <T>(xs: T[]): T[] => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

export class Player {
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private readonly now: () => number

  constructor(
    private readonly deps: PlayerDeps,
    private readonly opts: PlayerOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now() / 1000)
  }

  load() {
    if (this.opts.autoTick === false || this.timer) return
    this.timer = setInterval(() => void this.tick(), 15_000)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private key = (tv: string) => `playback:${tv}`

  get(tv: string): Playback | null {
    const raw = this.deps.store.getMeta(this.key(tv))
    if (!raw) return null
    try {
      return JSON.parse(raw) as Playback
    } catch {
      return null
    }
  }

  private save(tv: string, pb: Playback | null) {
    if (pb) this.deps.store.setMeta(this.key(tv), JSON.stringify(pb))
    else this.deps.store.sqlite.prepare("DELETE FROM meta WHERE key = ?").run(this.key(tv))
    this.deps.onChange?.(tv)
  }

  /** TVs that play (or paused) this series. */
  playingOn(seriesId: string): string[] {
    return [...this.deps.tvs.keys()].filter((tv) => this.get(tv)?.seriesId === seriesId)
  }

  /** Brings the order in line with the series: removed works drop out, new ones join at the end. */
  private sync(pb: Playback, row: SeriesRow): Playback {
    const ids = this.deps.series.itemIds(row.id)
    const kept = pb.order.filter((id) => ids.includes(id))
    const added = ids.filter((id) => !kept.includes(id))
    const order = [...kept, ...(row.shuffle ? shuffled(added) : added)]
    const at = order.indexOf(pb.current)
    return { ...pb, order, index: at >= 0 ? at : Math.min(pb.index, order.length) }
  }

  private nextIndex(pb: Playback): number {
    const at = pb.order.indexOf(pb.current)
    const i = at >= 0 ? at + 1 : pb.index // the current work was removed: its successor moved into its slot
    return i >= pb.order.length ? 0 : i
  }

  play(seriesId: string, tvIds: string[]) {
    const row = this.deps.series.get(seriesId)
    if (!row) throw new Error("Onbekende serie")
    const ids = this.deps.series.itemIds(seriesId)
    if (!ids.length) throw new Error("Deze serie is leeg")
    for (const tv of tvIds) {
      const order = row.shuffle ? shuffled(ids) : ids
      this.step(
        tv,
        row,
        { seriesId, order, current: order[0]!, index: 0, status: "playing", nextAt: 0, remaining: null, error: null },
        true,
      )
    }
  }

  private step(tv: string, row: SeriesRow, pb: Playback, wake: boolean) {
    this.deps.runner.submit(tv, pb.current, this.deps.modeFor(tv), { wake })
    this.save(tv, {
      ...pb,
      status: "playing",
      remaining: null,
      error: null,
      nextAt: this.now() + this.duration(row, pb.current),
    })
  }

  private duration(row: SeriesRow, artworkId: string) {
    return Math.max(60, this.deps.series.durationOf(row, artworkId))
  }

  /** Moves on to the next work; `wake` only when someone asked for it. */
  private async advance(tv: string, wake: boolean) {
    const pb = this.get(tv)
    if (!pb) return
    const row = this.deps.series.get(pb.seriesId)
    if (!row) return this.save(tv, null)
    let next = this.sync(pb, row)
    if (!next.order.length) return this.save(tv, null)
    if (
      !wake &&
      !(await this.deps.tvs
        .get(tv)
        ?.isOn()
        .catch(() => false))
    ) {
      return this.save(tv, { ...next, nextAt: this.now() + (this.opts.retryS ?? 60), error: "TV staat uit" })
    }
    let i = this.nextIndex(next)
    if (i === 0 && row.shuffle && next.order.length > 1) {
      const order = shuffled(next.order)
      if (order[0] === next.current) order.push(order.shift()!)
      next = { ...next, order }
    }
    i = Math.min(i, next.order.length - 1)
    this.step(tv, row, { ...next, current: next.order[i]!, index: i }, wake)
  }

  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const tv of this.deps.tvs.keys()) {
        const pb = this.get(tv)
        if (pb?.status === "playing" && pb.nextAt <= this.now()) await this.advance(tv, false)
      }
    } finally {
      this.ticking = false
    }
  }

  async control(tv: string, action: PlaybackAction): Promise<boolean> {
    const pb = this.get(tv)
    if (!pb) return false
    if (action === "toggle") action = pb.status === "playing" ? "pause" : "resume"
    if (action === "stop") this.save(tv, null)
    else if (action === "pause" && pb.status === "playing")
      this.save(tv, { ...pb, status: "paused", remaining: Math.max(0, pb.nextAt - this.now()) })
    else if (action === "resume" && pb.status === "paused")
      this.save(tv, { ...pb, status: "playing", nextAt: this.now() + (pb.remaining ?? 0), remaining: null })
    else if (action === "next") await this.advance(tv, true)
    return true
  }

  /** Someone put something else on this TV: hold the series there. */
  hold(tv: string) {
    const pb = this.get(tv)
    if (pb?.status === "playing") void this.control(tv, "pause")
  }

  /** Stops every TV that plays this series (it's being deleted). */
  stopSeries(seriesId: string) {
    for (const tv of this.playingOn(seriesId)) this.save(tv, null)
  }

  /** What cleanup must keep on this TV: the work on screen and the one after it. */
  protect(tv: string): Set<string> {
    const pb = this.get(tv)
    if (!pb) return new Set()
    const row = this.deps.series.get(pb.seriesId)
    if (!row) return new Set()
    const synced = this.sync(pb, row)
    return new Set([pb.current, synced.order[this.nextIndex(synced)]].filter((x): x is string => Boolean(x)))
  }

  /** The playback as the UI shows it; the order is synced with edits first. */
  state(tv: string) {
    const pb = this.get(tv)
    if (!pb) return null
    const row = this.deps.series.get(pb.seriesId)
    if (!row) return null
    const synced = this.sync(pb, row)
    const at = synced.order.indexOf(pb.current)
    const nextId = synced.order.length ? synced.order[this.nextIndex(synced)] : undefined
    return {
      seriesId: row.id,
      seriesName: row.name,
      status: pb.status,
      currentId: pb.current,
      nextId: nextId && nextId !== pb.current ? nextId : null,
      nextAt: pb.status === "playing" ? pb.nextAt : null,
      remaining: pb.status === "paused" ? pb.remaining : null,
      position: at >= 0 ? at + 1 : null,
      total: synced.order.length,
      error: pb.error,
    }
  }
}

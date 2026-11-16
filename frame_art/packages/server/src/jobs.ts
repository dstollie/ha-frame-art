/** One tap = one job: download, render, wake, upload + show in Art Mode, clean up. One queue per TV. */
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

import type { Settings } from "./config.js"
import type { Store } from "./db.js"
import type { HomeAssistant } from "./ha.js"
import { touch, type ImageCache } from "./images.js"
import type { Artwork, Mode } from "./models.js"
import { renderJpeg } from "./render.js"
import type { TV } from "./tv.js"

export const STEPS = [
  ["download", "Ophalen bij het museum"],
  ["render", "Klaarmaken voor de Frame"],
  ["wake", "TV aanzetten"],
  ["show", "Uploaden en tonen"],
  ["cleanup", "Oude uploads opruimen"],
] as const
export type StepId = (typeof STEPS)[number][0]
export type StepState = "todo" | "busy" | "done" | "skipped" | "error"

export interface JobDTO {
  id: string
  tv: string
  artworkId: string
  mode: Mode
  /** Woken for this job when off; series steps after the first never wake a TV. */
  wake: boolean
  status: "queued" | "running" | "done" | "error"
  error: string | null
  steps: { id: StepId; label: string; state: StepState }[]
  created: number
  finished: number | null
}

export type ShownCallback = (tv: string, art: Artwork, jpeg: Buffer) => Promise<void>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class JobRunner {
  readonly jobs = new Map<string, JobDTO>()
  private queues = new Map<string, Promise<void>>()
  /** Works cleanup must keep on a TV (a playing series' current and next). */
  protect: (tv: string) => Set<string> = () => new Set()

  constructor(
    private readonly settings: Settings,
    private readonly store: Store,
    private readonly images: ImageCache,
    private readonly tvs: Map<string, TV>,
    private readonly ha: HomeAssistant,
    private readonly onShown?: ShownCallback,
    private readonly opts: { wakeTimeoutMs?: number; pollMs?: number; settleMs?: number } = {},
  ) {}

  submit(tv: string, artworkId: string, mode: Mode, opts: { wake?: boolean } = {}): JobDTO {
    if (!this.tvs.has(tv)) throw new Error(`Onbekende TV ${tv}`)
    const job: JobDTO = {
      id: randomUUID().slice(0, 12),
      tv,
      artworkId,
      mode,
      wake: opts.wake ?? true,
      status: "queued",
      error: null,
      steps: STEPS.map(([id, label]) => ({ id, label, state: "todo" as StepState })),
      created: Date.now() / 1000,
      finished: null,
    }
    this.jobs.set(job.id, job)
    for (const old of [...this.jobs.keys()].slice(0, -50)) this.jobs.delete(old)
    const prev = this.queues.get(tv) ?? Promise.resolve()
    const run = prev.then(() => this.execute(job))
    this.queues.set(tv, run)
    return job
  }

  /** Resolves once every queued job has finished (tests). */
  async idle(): Promise<void> {
    await Promise.all(this.queues.values())
  }

  latest(tv: string): JobDTO | null {
    return [...this.jobs.values()].toReversed().find((j) => j.tv === tv) ?? null
  }

  private async execute(job: JobDTO): Promise<void> {
    try {
      await this.run(job)
      job.status = "done"
    } catch (e) {
      job.status = "error"
      job.error = e instanceof Error ? e.message : String(e)
      for (const s of job.steps) if (s.state === "busy") s.state = "error"
    } finally {
      job.finished = Date.now() / 1000
    }
  }

  private step(job: JobDTO, id: StepId, state: StepState) {
    const s = job.steps.find((x) => x.id === id)
    if (s) s.state = state
  }

  private async wake(job: JobDTO, tv: TV) {
    if (await tv.isOn()) return this.step(job, "wake", "skipped")
    const cfg = this.settings.tvs.find((t) => t.id === job.tv)
    if (!job.wake) throw new Error("De TV staat uit")
    if (!cfg?.wakeEntity || !this.ha.available) throw new Error("De TV staat uit en er is geen wake_entity ingesteld")
    this.step(job, "wake", "busy")
    await this.ha.callService("media_player", "turn_on", { entity_id: cfg.wakeEntity })
    const deadline = Date.now() + (this.opts.wakeTimeoutMs ?? 30_000)
    while (Date.now() < deadline) {
      await sleep(this.opts.pollMs ?? 1500)
      if (await tv.isOn()) {
        await sleep(this.opts.settleMs ?? 3000) // the art channel comes up a moment after REST
        return this.step(job, "wake", "done")
      }
    }
    throw new Error("De TV kwam niet aan")
  }

  private async run(job: JobDTO) {
    job.status = "running"
    const art = this.store.get(job.artworkId)
    if (!art) throw new Error(`Onbekend werk ${job.artworkId}`)
    const tv = this.tvs.get(job.tv)!

    const file = this.images.renderPath(art.id, job.mode)
    const existing = this.store.findUpload(job.tv, art.id, job.mode)
    if (existing && (await this.reuse(job, tv, existing))) {
      const shown = existsSync(file) ? readFileSync(file) : await this.images.thumb(art).catch(() => null)
      if (shown) await this.onShown?.(job.tv, art, shown).catch(() => undefined)
      return
    }

    let jpeg: Buffer
    if (existsSync(file)) {
      this.step(job, "download", "skipped")
      this.step(job, "render", "skipped")
      jpeg = readFileSync(file)
      touch(file)
    } else {
      this.step(job, "download", "busy")
      const source = await this.images.source(art)
      this.step(job, "download", "done")
      this.step(job, "render", "busy")
      jpeg = await renderJpeg(source, job.mode)
      writeFileSync(file, jpeg)
      this.step(job, "render", "done")
    }

    await this.wake(job, tv)

    this.step(job, "show", "busy")
    const contentId = await tv.show(jpeg)
    this.store.recordUpload(job.tv, contentId, art.id, job.mode)
    this.store.addHistory(job.tv, art.id, job.mode)
    this.step(job, "show", "done")

    this.step(job, "cleanup", "busy")
    const prune = this.store
      .prunableUploads(job.tv, this.settings.keepUploads, this.settings.keepFavouriteUploads, this.protect(job.tv))
      .filter((c) => c !== contentId)
    if (prune.length) {
      try {
        await tv.remove(prune)
        this.store.removeUploads(job.tv, prune)
        this.step(job, "cleanup", "done")
      } catch {
        this.step(job, "cleanup", "error") // not worth failing the job; retried next time
      }
    } else {
      this.step(job, "cleanup", "skipped")
    }

    await this.onShown?.(job.tv, art, jpeg).catch(() => undefined)
  }

  /** Select a work that's still on the TV: no download, render or upload. False when the TV lost it. */
  private async reuse(job: JobDTO, tv: TV, contentId: string): Promise<boolean> {
    await this.wake(job, tv)
    this.step(job, "show", "busy")
    let shown = false
    try {
      shown = await tv.showExisting(contentId)
    } catch {
      shown = false // can't tell; upload again
    }
    if (!shown) {
      this.store.removeUploads(job.tv, [contentId])
      this.step(job, "show", "todo")
      return false
    }
    for (const id of ["download", "render", "cleanup"] as const) this.step(job, id, "skipped")
    this.store.recordUpload(job.tv, contentId, job.artworkId, job.mode)
    this.store.addHistory(job.tv, job.artworkId, job.mode)
    this.step(job, "show", "done")
    return true
  }

  /** Rotation: a landscape-friendly work from the category, not shown on this TV recently. */
  pickNext(tv: string, category: string): Artwork | null {
    const favourites = category === "favourites"
    const own = category === "collection"
    const q = {
      category: favourites || own || category === "all" ? null : category,
      favourites,
      mine: own,
      catalogue: !favourites && !own,
      // Own uploads and favourites were chosen on purpose; don't filter them on shape.
      landscape: !favourites && !own,
    }
    return this.store.random(q, this.store.recentIds(tv, 60)) ?? this.store.random(q)
  }
}

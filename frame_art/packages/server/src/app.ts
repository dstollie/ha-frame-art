import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { zValidator } from "@hono/zod-validator"
import { Hono, type ValidationTargets } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"

import { CATEGORIES } from "./categorize.js"
import { paths, type Settings } from "./config.js"
import { Store, type Query } from "./db.js"
import type { HomeAssistant } from "./ha.js"
import { ImageCache } from "./images.js"
import { JobRunner } from "./jobs.js"
import { MODES, toDTO, type Artwork, type ArtworkDTO, type Mode } from "./models.js"
import { ID_TO_LABEL, PREFIX, ROTATION_OPTIONS, type MqttBridge } from "./mqtt.js"
import { COLOR_FAMILIES, H, LAYOUT, MAX_UPSCALE, W, bevelWidth, thumbnailJpeg } from "./render.js"
import type { Fetch } from "./sources/index.js"
import { Syncer } from "./sync.js"
import type { TV } from "./tv.js"

export interface Deps {
  settings: Settings
  tvs: Map<string, TV>
  ha: HomeAssistant
  fetchFn?: Fetch
  syncer?: Syncer
  staticDir?: string | null
  jobOptions?: ConstructorParameters<typeof JobRunner>[6]
}

/** Validation errors become an HTTPException, so they don't widen every RPC response type. */
const validate = <T extends keyof ValidationTargets, S extends z.ZodType>(target: T, schema: S) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new HTTPException(400, {
        message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      })
    }
  })

const rotationIds = ROTATION_OPTIONS.map(([id]) => id) as [string, ...string[]]

const listQuery = z.object({
  category: z.string().optional(),
  color: z.string().optional(),
  q: z.string().optional(),
  source: z.string().optional(),
  landscape: z.enum(["0", "1", "true", "false"]).optional(),
  favourites: z.enum(["0", "1", "true", "false"]).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(120).optional(),
  seed: z.coerce.number().int().optional(),
})

function toQuery(p: z.infer<typeof listQuery>): Query {
  const day = Math.floor(Date.now() / 86_400_000)
  return {
    category: p.category || null,
    color: p.color || null,
    q: p.q || null,
    source: p.source || null,
    landscape: p.landscape === "1" || p.landscape === "true",
    favourites: p.favourites === "1" || p.favourites === "true",
    offset: p.offset ?? 0,
    limit: p.limit ?? 48,
    seed: p.seed ?? day,
  }
}

export function createServices(deps: Deps) {
  const { settings, tvs, ha } = deps
  const p = paths(settings)
  const store = new Store(p.db)
  const images = new ImageCache(p.sources, p.renders, settings.cacheMb * 1024 * 1024, deps.fetchFn)
  const syncer = deps.syncer ?? new Syncer(store, deps.fetchFn)
  const svc = {
    settings,
    store,
    images,
    syncer,
    tvs,
    ha,
    mqtt: null as MqttBridge | null,
    categoryOf: (tv: string) => store.getMeta(`category:${tv}`) ?? "alles",
    runner: null as unknown as JobRunner,
    async onShown(tv: string, art: Artwork, jpeg: Buffer) {
      if (svc.mqtt) svc.mqtt.publishCurrent(tv, art, await thumbnailJpeg(jpeg))
    },
    next(tv: string) {
      const art = svc.runner.pickNext(tv, svc.categoryOf(tv))
      if (!art) throw new HTTPException(404, { message: "Geen werk gevonden in deze categorie" })
      return svc.runner.submit(tv, art.id, svc.runner.modeFor(art, settings.defaultMode))
    },
    async setCategory(tv: string, category: string) {
      if (!rotationIds.includes(category)) return
      store.setMeta(`category:${tv}`, category)
      svc.mqtt?.publish(`${PREFIX}/${tv}/category`, ID_TO_LABEL[category] ?? category)
    },
  }
  svc.runner = new JobRunner(
    settings,
    store,
    images,
    tvs,
    ha,
    (tv, art, jpeg) => svc.onShown(tv, art, jpeg),
    deps.jobOptions,
  )
  return svc
}
export type Services = ReturnType<typeof createServices>

export function createApi(svc: Services) {
  const { store, settings, tvs, runner, syncer, images } = svc

  const artDTO = (a: Artwork, favs = store.favouriteIds()): ArtworkDTO => toDTO(a, favs.has(a.id))
  const artOr404 = (id: string) => {
    const a = store.get(id)
    if (!a) throw new HTTPException(404, { message: "Onbekend werk" })
    return a
  }
  const tvOr404 = (id: string) => {
    const t = tvs.get(id)
    if (!t) throw new HTTPException(404, { message: `Onbekende TV ${id}` })
    return t
  }

  return new Hono()
    .get("/config", (c) => {
      const counts = store.categoryCounts()
      return c.json({
        categories: CATEGORIES.map(([id, label]) => ({ id, label, count: counts[id] ?? 0 })),
        rotation: ROTATION_OPTIONS.map(([id, label]) => ({ id, label })),
        colors: [...COLOR_FAMILIES],
        modes: [...MODES],
        defaultMode: settings.defaultMode,
        layout: LAYOUT,
        frame: { width: W, height: H, maxUpscale: MAX_UPSCALE, bevel: bevelWidth(W) },
        tvs: settings.tvs.filter((t) => tvs.has(t.id)).map((t) => ({ id: t.id, name: t.name })),
      })
    })
    .get("/artworks", validate("query", listQuery), (c) => {
      const q = toQuery(c.req.valid("query"))
      const { items, total } = store.query(q)
      const favs = store.favouriteIds()
      const next = (q.offset ?? 0) + items.length
      return c.json({ items: items.map((a) => artDTO(a, favs)), total, nextOffset: next < total ? next : null })
    })
    .get("/random", validate("query", listQuery), (c) => {
      const a = store.random(toQuery(c.req.valid("query")))
      if (!a) throw new HTTPException(404, { message: "Niets gevonden" })
      return c.json(artDTO(a))
    })
    .get("/artworks/:id", (c) => {
      const a = artOr404(c.req.param("id"))
      const shown = store.history(500).filter((h) => h.artworkId === a.id)
      return c.json({ ...artDTO(a), shown: shown.map((h) => ({ tv: h.tv, shownAt: h.shownAt, mode: h.mode })) })
    })
    .post("/artworks/:id/favourite", validate("json", z.object({ on: z.boolean() })), (c) => {
      const a = artOr404(c.req.param("id"))
      const { on } = c.req.valid("json")
      store.setFavourite(a.id, on)
      return c.json({ favourite: on })
    })
    .post("/artworks/:id/hide", (c) => {
      const a = artOr404(c.req.param("id"))
      store.setHidden(a.id, true)
      return c.json({ hidden: true })
    })
    .get("/tvs", async (c) => {
      const out = await Promise.all(
        settings.tvs
          .filter((t) => tvs.has(t.id))
          .map(async (cfg) => {
            const tv = tvs.get(cfg.id)!
            const last = store.history(1, cfg.id)[0]
            const art = last ? store.get(last.artworkId) : null
            const job = runner.latest(cfg.id)
            return {
              id: cfg.id,
              name: cfg.name,
              paired: tv.paired,
              on: await tv.isOn(),
              canWake: Boolean(cfg.wakeEntity),
              category: svc.categoryOf(cfg.id),
              current: art && last ? { artwork: artDTO(art), shownAt: last.shownAt, mode: last.mode as Mode } : null,
              job: job && (job.status === "queued" || job.status === "running") ? job : null,
            }
          }),
      )
      return c.json(out)
    })
    .post(
      "/tvs/:tv/show",
      validate("json", z.object({ artworkId: z.string(), mode: z.enum(MODES).optional() })),
      (c) => {
        const tv = tvOr404(c.req.param("tv"))
        const { artworkId, mode } = c.req.valid("json")
        const art = artOr404(artworkId)
        if (!tv.paired) throw new HTTPException(409, { message: "Deze TV is nog niet gekoppeld" })
        return c.json(runner.submit(tv.id, art.id, runner.modeFor(art, mode ?? settings.defaultMode)))
      },
    )
    .post("/tvs/:tv/next", (c) => {
      const tv = tvOr404(c.req.param("tv"))
      if (!tv.paired) throw new HTTPException(409, { message: "Deze TV is nog niet gekoppeld" })
      return c.json(svc.next(tv.id))
    })
    .put("/tvs/:tv/category", validate("json", z.object({ category: z.enum(rotationIds) })), async (c) => {
      const tv = tvOr404(c.req.param("tv"))
      const { category } = c.req.valid("json")
      await svc.setCategory(tv.id, category)
      return c.json({ category })
    })
    .post("/tvs/:tv/pair", async (c) => {
      const tv = tvOr404(c.req.param("tv"))
      try {
        const r = await tv.pair()
        return c.json({ ok: true as const, paired: tv.paired, apiVersion: r.apiVersion })
      } catch (e) {
        throw new HTTPException(502, { message: e instanceof Error ? e.message : String(e) })
      }
    })
    .get("/jobs/:id", (c) => {
      const job = runner.jobs.get(c.req.param("id"))
      if (!job) throw new HTTPException(404, { message: "Onbekende opdracht" })
      return c.json(job)
    })
    .get(
      "/history",
      validate("query", z.object({ limit: z.coerce.number().int().min(1).max(500).optional() })),
      (c) => {
        const favs = store.favouriteIds()
        const items = store.history(c.req.valid("query").limit ?? 60).flatMap((h) => {
          const a = store.get(h.artworkId)
          return a ? [{ id: h.id, tv: h.tv, mode: h.mode as Mode, shownAt: h.shownAt, artwork: artDTO(a, favs) }] : []
        })
        return c.json(items)
      },
    )
    .get("/sync", (c) => c.json({ ...syncer.toDTO(), cacheBytes: images.usage() }))
    .post("/sync", (c) => c.json({ started: syncer.trigger() }))
}

export type ApiType = ReturnType<typeof createApi>

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
}

export function createApp(deps: Deps) {
  const svc = createServices(deps)
  const app = new Hono()
  app.route("/api", createApi(svc))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: err.message }, 500)
  })

  const dir = deps.staticDir
  if (dir && existsSync(path.join(dir, "index.html"))) {
    const root = path.resolve(dir)
    app.get("*", (c) => {
      const rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, "")
      const file = path.resolve(root, rel)
      if (rel && file.startsWith(root + path.sep) && existsSync(file) && statSync(file).isFile()) {
        const immutable = rel.startsWith("assets/")
        return c.body(readFileSync(file), 200, {
          "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
          "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        })
      }
      return c.html(readFileSync(path.join(root, "index.html"), "utf8"), 200, { "Cache-Control": "no-cache" })
    })
  }
  return { app, svc }
}

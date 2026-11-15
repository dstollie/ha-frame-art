import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { StreamableHTTPTransport } from "@hono/mcp"
import { getConnInfo } from "@hono/node-server/conninfo"
import { zValidator } from "@hono/zod-validator"
import { Hono, type Context, type ValidationTargets } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"

import { INGRESS_PROXY, Tokens, bearer, sameToken } from "./auth.js"
import { CATEGORIES } from "./categorize.js"
import { Collection, CollectionError } from "./collection.js"
import { COLOR_FAMILIES } from "./color.js"
import { paths, type Settings } from "./config.js"
import { Store, type Query } from "./db.js"
import type { HomeAssistant } from "./ha.js"
import { ImageCache } from "./images.js"
import { JobRunner } from "./jobs.js"
import { createMcpServer } from "./mcp.js"
import { MODES, toDTO, type Artwork, type ArtworkDTO, type Mode } from "./models.js"
import { ID_TO_LABEL, PREFIX, ROTATION_OPTIONS, type MqttBridge } from "./mqtt.js"
import { USER_AGENT, type Fetch } from "./providers/http.js"
import { MINE } from "./providers/mine.js"
import type { ArtProvider } from "./providers/types.js"
import { H, LAYOUT, MAX_UPSCALE, W, bevelWidth, centredCrop, smartCrop, thumbnailJpeg, type Crop } from "./render.js"
import { Sources } from "./sources.js"
import { Syncer } from "./sync.js"
import type { TV } from "./tv.js"

export interface Deps {
  settings: Settings
  tvs: Map<string, TV>
  ha: HomeAssistant
  fetchFn?: Fetch
  syncer?: Syncer
  /** Built web app: index.html (ingress page) and panel/frame-art-panel.js. */
  staticDir?: string | null
  providers?: ArtProvider[]
  jobOptions?: ConstructorParameters<typeof JobRunner>[6]
  /** "open" skips auth (dev stack, tests); "addon" requires ingress or a token. */
  auth?: "addon" | "open"
  /** Remote address of a request; tests override it. */
  remoteAddress?: (c: Context) => string | undefined
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

const DisplaySchema = z.object({
  display: z.enum(["fill", "matte"]),
  matteStyle: z.enum(["light", "dark", "blur"]),
})
export type DisplaySetting = z.infer<typeof DisplaySchema>

const rotationIds = ROTATION_OPTIONS.map(([id]) => id) as [string, ...string[]]

const flag = z.enum(["0", "1", "true", "false"]).optional()
const listQuery = z.object({
  category: z.string().optional(),
  color: z.string().optional(),
  q: z.string().optional(),
  source: z.string().optional(),
  album: z.string().optional(),
  landscape: flag,
  favourites: flag,
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(120).optional(),
  seed: z.coerce.number().int().optional(),
})
const on = (v: string | undefined) => v === "1" || v === "true"

export function createServices(deps: Deps) {
  const { settings, tvs, ha } = deps
  const p = paths(settings)
  const store = new Store(p.db)
  const sources = new Sources(store, deps.providers)
  const fetchFn = deps.fetchFn ?? fetch
  const images = new ImageCache(
    { sources: p.sources, renders: p.renders, thumbs: p.thumbs, collection: p.collection },
    settings.cacheMb * 1024 * 1024,
    fetchFn,
    sources,
  )
  const syncer = deps.syncer ?? new Syncer(store, sources, fetchFn, { thumb: (a) => images.thumb(a) })
  const collection = new Collection(store, images, fetchFn)
  const tokens = new Tokens(store)

  const toQuery = (p: z.infer<typeof listQuery>): Query => ({
    category: p.category || null,
    color: p.color || null,
    q: p.q || null,
    source: p.source || null,
    album: p.album || null,
    sources: p.source || p.album || on(p.favourites) ? undefined : sources.enabledIds(),
    landscape: on(p.landscape),
    favourites: on(p.favourites),
    offset: p.offset ?? 0,
    limit: p.limit ?? 48,
    seed: p.seed ?? Math.floor(Date.now() / 86_400_000),
  })

  const svc = {
    settings,
    store,
    sources,
    images,
    syncer,
    collection,
    tokens,
    tvs,
    ha,
    toQuery,
    mqtt: null as MqttBridge | null,
    runner: null as unknown as JobRunner,
    crops: new Map<string, Crop>(),

    categoryOf: (tv: string) => store.getMeta(`category:${tv}`) ?? "all",

    /** Per TV: fill the screen (smart crop, the default) or a passe-partout in the given style. */
    displayOf(tv: string): DisplaySetting {
      const fallback: DisplaySetting = {
        display: "fill",
        matteStyle: settings.defaultMode === "fill" ? "light" : settings.defaultMode,
      }
      const raw = store.getMeta(`display:${tv}`)
      if (!raw) return fallback
      const parsed = DisplaySchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : fallback
    },
    setDisplay(tv: string, value: DisplaySetting) {
      store.setMeta(`display:${tv}`, JSON.stringify(value))
    },
    /** An explicit mode ("this time with a passe-partout") wins; otherwise the TV's setting decides. */
    modeFor(tv: string, wanted?: Mode): Mode {
      if (wanted) return wanted
      const d = svc.displayOf(tv)
      return d.display === "fill" ? "fill" : d.matteStyle
    },

    artDTO(a: Artwork, favs = store.favouriteIds()): ArtworkDTO {
      const proxied = sources.get(a.source)?.thumbnails === "proxy"
      return toDTO(a, favs.has(a.id), proxied ? `artworks/${encodeURIComponent(a.id)}/thumb` : null)
    },

    /** Where "fill" will cut this work, from its thumbnail; the preview shows exactly that window. */
    async cropOf(art: Artwork): Promise<Crop> {
      const hit = svc.crops.get(art.id)
      if (hit) return hit
      let crop: Crop
      try {
        crop = await smartCrop(await images.thumb(art))
      } catch {
        return centredCrop(art.aspect)
      }
      if (svc.crops.size > 500) svc.crops.delete(svc.crops.keys().next().value!)
      svc.crops.set(art.id, crop)
      return crop
    },

    async tvStates() {
      const favs = store.favouriteIds()
      return Promise.all(
        settings.tvs
          .filter((t) => tvs.has(t.id))
          .map(async (cfg) => {
            const tv = tvs.get(cfg.id)!
            const last = store.history(1, cfg.id)[0]
            const art = last ? store.get(last.artworkId) : null
            const job = svc.runner.latest(cfg.id)
            const display = svc.displayOf(cfg.id)
            return {
              id: cfg.id,
              name: cfg.name,
              paired: tv.paired,
              on: await tv.isOn(),
              canWake: Boolean(cfg.wakeEntity),
              category: svc.categoryOf(cfg.id),
              display: display.display,
              matteStyle: display.matteStyle,
              current:
                art && last ? { artwork: svc.artDTO(art, favs), shownAt: last.shownAt, mode: last.mode as Mode } : null,
              job: job && (job.status === "queued" || job.status === "running") ? job : null,
            }
          }),
      )
    },

    async onShown(tv: string, art: Artwork, jpeg: Buffer) {
      if (svc.mqtt) svc.mqtt.publishCurrent(tv, art, await thumbnailJpeg(jpeg))
    },
    next(tv: string) {
      const category = svc.categoryOf(tv)
      const art = svc.runner.pickNext(tv, category, category === "collection" ? [MINE] : sources.enabledIds())
      if (!art) throw new HTTPException(404, { message: "Geen werk gevonden in deze categorie" })
      return svc.runner.submit(tv, art.id, svc.modeFor(tv))
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

const uploadJson = z.object({
  url: z.string().url().optional(),
  base64: z.string().optional(),
  title: z.string().max(300).optional(),
  albumId: z.string().optional(),
})

/** Collection errors are the user's to fix: answer 400 with the message. */
const collectionCall = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof CollectionError) throw new HTTPException(400, { message: e.message })
    throw e
  }
}
export function createApi(svc: Services) {
  const { store, settings, tvs, runner, syncer, images, sources, collection, tokens } = svc

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
  const albumOr404 = (id: string) => {
    const a = store.album(id)
    if (!a) throw new HTTPException(404, { message: "Onbekend album" })
    return a
  }

  return (
    new Hono()
      .get("/config", (c) => {
        const counts = store.categoryCounts()
        return c.json({
          categories: CATEGORIES.map((cat) => ({
            id: cat.id,
            label: { en: cat.en, nl: cat.nl },
            count: counts[cat.id] ?? 0,
          })),
          rotation: ROTATION_OPTIONS.map(([id, label]) => ({ id, label })),
          colors: [...COLOR_FAMILIES],
          modes: [...MODES],
          defaultMode: settings.defaultMode,
          layout: LAYOUT,
          frame: { width: W, height: H, maxUpscale: MAX_UPSCALE, bevel: bevelWidth(W) },
          tvs: settings.tvs.filter((t) => tvs.has(t.id)).map((t) => ({ id: t.id, name: t.name })),
          sources: sources
            .toDTO()
            .filter((s) => s.enabled)
            .map(({ id, name, count, local }) => ({ id, name, count, local })),
        })
      })
      .get("/artworks", validate("query", listQuery), (c) => {
        const q = svc.toQuery(c.req.valid("query"))
        const { items, total } = store.query(q)
        const favs = store.favouriteIds()
        const next = (q.offset ?? 0) + items.length
        return c.json({ items: items.map((a) => svc.artDTO(a, favs)), total, nextOffset: next < total ? next : null })
      })
      .get("/random", validate("query", listQuery), (c) => {
        const a = store.random(svc.toQuery(c.req.valid("query")))
        if (!a) throw new HTTPException(404, { message: "Niets gevonden" })
        return c.json(svc.artDTO(a))
      })
      .get("/artworks/:id", (c) => {
        const a = artOr404(c.req.param("id"))
        const shown = store.history(500).filter((h) => h.artworkId === a.id)
        return c.json({
          ...svc.artDTO(a),
          albums: store.albumsOf(a.id),
          shown: shown.map((h) => ({ tv: h.tv, shownAt: h.shownAt, mode: h.mode })),
        })
      })
      .get("/artworks/:id/thumb", async (c) => {
        const a = artOr404(c.req.param("id"))
        const bytes = await images.thumb(a).catch(() => null)
        if (!bytes) throw new HTTPException(502, { message: "Thumbnail niet beschikbaar" })
        return c.body(new Uint8Array(bytes), 200, {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=86400",
        })
      })
      .get("/artworks/:id/crop", async (c) => c.json(await svc.cropOf(artOr404(c.req.param("id")))))
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
      .patch("/artworks/:id", validate("json", z.object({ title: z.string().min(1).max(300) })), async (c) => {
        const a = artOr404(c.req.param("id"))
        if (a.source !== MINE) throw new HTTPException(400, { message: "Alleen eigen uploads kun je hernoemen" })
        store.upsertArtworks([{ ...a, title: c.req.valid("json").title }])
        return c.json(svc.artDTO(store.get(a.id)!))
      })
      .delete("/artworks/:id", async (c) => {
        const a = artOr404(c.req.param("id"))
        await collectionCall(() => collection.remove(a))
        return c.json({ deleted: true as const })
      })
      // ---------------------------------------------------------------- My collection
      .post("/collection", async (c) => {
        const type = c.req.header("content-type") ?? ""
        if (type.startsWith("multipart/form-data")) {
          const form = await c.req.parseBody({ all: true })
          const files = ([] as unknown[]).concat(form.file ?? []).filter((f): f is File => f instanceof File)
          if (!files.length) throw new HTTPException(400, { message: "Geen bestand" })
          const albumId = typeof form.albumId === "string" && form.albumId ? form.albumId : null
          const added = []
          for (const f of files) {
            const title = f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")
            const data = Buffer.from(await f.arrayBuffer())
            added.push(await collectionCall(() => collection.add({ data, title, albumId })))
          }
          return c.json({ items: added.map((a) => svc.artDTO(a)) })
        }
        const body = uploadJson.safeParse(await c.req.json().catch(() => null))
        if (!body.success || (!body.data.url && !body.data.base64)) {
          throw new HTTPException(400, { message: "Stuur een bestand, url of base64" })
        }
        const { url, base64, title, albumId } = body.data
        const extra = { title: title ?? null, albumId: albumId ?? null }
        const art = await collectionCall(() =>
          url ? collection.addFromUrl(url, extra) : collection.addFromBase64(base64!, extra),
        )
        return c.json({ items: [svc.artDTO(art)] })
      })
      .get("/albums", (c) => c.json(store.albums()))
      .post("/albums", validate("json", z.object({ name: z.string().min(1).max(80) })), (c) =>
        c.json(collection.createAlbum(c.req.valid("json").name)),
      )
      .patch("/albums/:id", validate("json", z.object({ name: z.string().min(1).max(80) })), (c) => {
        const a = albumOr404(c.req.param("id"))
        store.renameAlbum(a.id, c.req.valid("json").name)
        return c.json(store.album(a.id)!)
      })
      .delete("/albums/:id", (c) => {
        const a = albumOr404(c.req.param("id"))
        store.deleteAlbum(a.id)
        return c.json({ deleted: true as const })
      })
      .post("/albums/:id/items", validate("json", z.object({ artworkId: z.string(), on: z.boolean() })), (c) => {
        const album = albumOr404(c.req.param("id"))
        const { artworkId, on } = c.req.valid("json")
        artOr404(artworkId)
        store.setAlbumItem(album.id, artworkId, on)
        return c.json({ albums: store.albumsOf(artworkId) })
      })
      // ---------------------------------------------------------------- TVs
      .get("/tvs", async (c) => c.json(await svc.tvStates()))
      .post(
        "/tvs/:tv/show",
        validate("json", z.object({ artworkId: z.string(), mode: z.enum(MODES).optional() })),
        (c) => {
          const tv = tvOr404(c.req.param("tv"))
          const { artworkId, mode } = c.req.valid("json")
          const art = artOr404(artworkId)
          if (!tv.paired) throw new HTTPException(409, { message: "Deze TV is nog niet gekoppeld" })
          return c.json(runner.submit(tv.id, art.id, svc.modeFor(tv.id, mode)))
        },
      )
      .post("/tvs/:tv/next", (c) => {
        const tv = tvOr404(c.req.param("tv"))
        if (!tv.paired) throw new HTTPException(409, { message: "Deze TV is nog niet gekoppeld" })
        return c.json(svc.next(tv.id))
      })
      .put("/tvs/:tv/display", validate("json", DisplaySchema), (c) => {
        const tv = tvOr404(c.req.param("tv"))
        const value = c.req.valid("json")
        svc.setDisplay(tv.id, value)
        return c.json(value)
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
          console.log(`pair ${tv.id}: accepted, art API ${r.apiVersion}, paired=${tv.paired}`)
          return c.json({ ok: true as const, paired: tv.paired, apiVersion: r.apiVersion })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          console.warn(`pair ${tv.id}: ${message}`)
          throw new HTTPException(502, { message })
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
            return a
              ? [{ id: h.id, tv: h.tv, mode: h.mode as Mode, shownAt: h.shownAt, artwork: svc.artDTO(a, favs) }]
              : []
          })
          return c.json(items)
        },
      )
      // ---------------------------------------------------------------- settings
      .get("/settings/sources", (c) => c.json(sources.toDTO()))
      .put(
        "/settings/sources/:id",
        validate("json", z.object({ enabled: z.boolean(), apiKey: z.string().max(200).nullable().optional() })),
        (c) => {
          const id = c.req.param("id")
          if (!sources.get(id)) throw new HTTPException(404, { message: "Onbekende bron" })
          const { enabled, apiKey } = c.req.valid("json")
          sources.set(id, { enabled, ...(apiKey === undefined ? {} : { apiKey }) })
          if (enabled) syncer.trigger()
          return c.json(sources.toDTO().find((s) => s.id === id)!)
        },
      )
      .get("/settings/mcp", (c) => c.json({ token: tokens.mcp, path: "/api/frame_art/mcp", addonPath: "/mcp" }))
      .post("/settings/mcp/rotate", (c) => c.json({ token: tokens.rotateMcp() }))
      .get("/sync", (c) => c.json({ ...syncer.toDTO(), cacheBytes: images.usage() }))
      .post("/sync", (c) => c.json({ started: syncer.trigger() }))
  )
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
  ".map": "application/json",
}

export function createApp(deps: Deps) {
  const svc = createServices(deps)
  const app = new Hono()
  const remote = (c: Context) => {
    if (deps.remoteAddress) return deps.remoteAddress(c)
    try {
      return getConnInfo(c).remote.address
    } catch {
      return undefined
    }
  }

  app.use("/api/*", async (c, next) => {
    if (deps.auth === "open") return next()
    if (c.req.header("x-ingress-path") && remote(c) === INGRESS_PROXY) return next()
    if (sameToken(bearer(c.req.header("authorization")), svc.tokens.internal)) return next()
    throw new HTTPException(401, { message: "Niet toegestaan" })
  })
  app.route("/api", createApi(svc))

  app.all("/mcp", async (c) => {
    const given = bearer(c.req.header("authorization")) ?? c.req.query("token")
    if (!sameToken(given, svc.tokens.mcp)) {
      return c.json({ jsonrpc: "2.0", error: { code: -32001, message: "Invalid or missing MCP token" }, id: null }, 401)
    }
    const server = createMcpServer(svc)
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    const res = await transport.handleRequest(c)
    return res ?? c.body(null, 202)
  })

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: err.message }, 500)
  })

  const dir = deps.staticDir
  if (dir && existsSync(dir)) {
    const root = path.resolve(dir)
    app.get("*", (c) => {
      const rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, "")
      const file = path.resolve(root, rel)
      if (rel && file.startsWith(root + path.sep) && existsSync(file) && statSync(file).isFile()) {
        return c.body(readFileSync(file), 200, {
          "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
          "Cache-Control": "no-cache",
        })
      }
      const index = path.join(root, "index.html")
      if (!existsSync(index)) return c.notFound()
      return c.html(readFileSync(index, "utf8"), 200, { "Cache-Control": "no-cache" })
    })
  }
  return { app, svc }
}

/** User agent for outgoing requests; exported for scripts. */
export { USER_AGENT }

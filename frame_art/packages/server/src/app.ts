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
import { COMMUNITY_BASE, Catalogue, catalogueItem, issueUrl, workLine, type Item } from "./community.js"
import { paths, type Settings } from "./config.js"
import { Store, type Query } from "./db.js"
import type { HomeAssistant } from "./ha.js"
import { ImageCache } from "./images.js"
import { JobRunner } from "./jobs.js"
import { LiveSearch } from "./live.js"
import { createMcpServer } from "./mcp.js"
import { MODES, toDTO, type Artwork, type ArtworkDTO, type Mode } from "./models.js"
import { ID_TO_LABEL, NO_SERIES, PREFIX, ROTATION_OPTIONS, seriesLabels, type MqttBridge } from "./mqtt.js"
import { Player, type PlaybackAction, type PlayerOptions } from "./player.js"
import { USER_AGENT, type Fetch } from "./providers/http.js"
import { MINE } from "./providers/mine.js"
import type { ArtProvider } from "./providers/types.js"
import { H, LAYOUT, MAX_UPSCALE, W, bevelWidth, centredCrop, smartCrop, thumbnailJpeg, type Crop } from "./render.js"
import { MAX_DURATION, MAX_FROM_QUERY, MIN_DURATION, SeriesStore, type SeriesRow } from "./series.js"
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
  playerOptions?: PlayerOptions
  /** Where the community index lives; the dev stack serves a local copy. */
  communityBase?: string
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
const csv = z.string().optional()
const listQuery = z.object({
  category: z.string().optional(),
  color: z.string().optional(),
  q: z.string().max(200).optional(),
  source: z.string().optional(),
  album: z.string().optional(),
  landscape: flag,
  favourites: flag,
  /** Comma-separated collection ids. */
  collection: csv,
  /** Comma-separated century start years (1800 = 19th century; -1 = unknown). */
  century: csv,
  artist: z.string().optional(),
  orient: z.enum(["landscape", "portrait", "square", "all"]).optional(),
  uhd: flag,
  ai: z.enum(["yes", "no"]).optional(),
  licence: csv,
  sort: z.enum(["shuffle", "new"]).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(120).optional(),
  seed: z.coerce.number().int().optional(),
})
const on = (v: string | undefined) => v === "1" || v === "true"
const list = (v: string | undefined) =>
  v
    ? v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : []

const durationSchema = z.number().int().min(MIN_DURATION).max(MAX_DURATION)
const seriesCreate = z.object({
  name: z.string().trim().min(1).max(80),
  artworkIds: z.array(z.string()).max(500).optional(),
  albumId: z.string().optional(),
  query: listQuery.omit({ offset: true, limit: true }).optional(),
  duration: durationSchema.optional(),
  shuffle: z.boolean().optional(),
})
const seriesPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  duration: durationSchema.optional(),
  shuffle: z.boolean().optional(),
})
const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .min(3)
  .max(64)
const shareSchema = z.object({
  id: slug,
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(20).max(600),
  tags: z
    .array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/))
    .min(1)
    .max(12),
  curator: z.object({
    name: z.string().trim().min(2),
    github: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,39}$/)
      .optional(),
  }),
  artworkIds: z.array(z.string()).min(1).max(1000),
  coverId: z.string().optional(),
})
export type ShareInput = z.infer<typeof shareSchema>

const PLAYBACK_ACTIONS = ["pause", "resume", "toggle", "next", "stop"] as const satisfies readonly PlaybackAction[]

/** Explore browses the catalogue; My collection is own uploads and saved works; an album or favourites span both. */
export const toQuery = (p: z.infer<typeof listQuery>): Query => {
  const mine = p.source === MINE
  const anywhere = Boolean(p.album) || on(p.favourites)
  const ai = p.ai === "yes" ? true : p.ai === "no" ? false : null
  return {
    category: p.category || null,
    color: p.color || null,
    q: p.q?.trim() || null,
    album: p.album || null,
    favourites: on(p.favourites),
    catalogue: !mine && !anywhere,
    mine,
    collections: list(p.collection),
    centuries: list(p.century).map(Number).filter(Number.isFinite),
    artist: p.artist || null,
    orient: p.orient === "all" ? null : (p.orient ?? (on(p.landscape) ? "landscape" : null)),
    uhd: p.uhd === undefined ? null : on(p.uhd),
    ai,
    licences: list(p.licence),
    ...(p.sort ? { sort: p.sort } : {}),
    offset: p.offset ?? 0,
    limit: p.limit ?? 48,
    seed: p.seed ?? Math.floor(Date.now() / 86_400_000),
  }
}

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
  const catalogue = new Catalogue(store, images, fetchFn, deps.communityBase ?? COMMUNITY_BASE)
  const syncer = deps.syncer ?? new Syncer(store, sources, catalogue, fetchFn, { thumb: (a) => images.thumb(a) })
  const live = new LiveSearch(store, sources, catalogue, fetchFn)
  const collection = new Collection(store, images, fetchFn)
  const tokens = new Tokens(store)
  const seriesStore = new SeriesStore(store)

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
    series: seriesStore,
    catalogue,
    live,
    player: null as unknown as Player,
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
              playback: svc.playbackOf(cfg.id, favs),
            }
          }),
      )
    },

    async onShown(tv: string, art: Artwork, jpeg: Buffer) {
      if (svc.mqtt) svc.mqtt.publishCurrent(tv, art, await thumbnailJpeg(jpeg))
    },
    /** A manual show or "new work" holds a playing series on that TV. */
    show(tv: string, artworkId: string, mode?: Mode) {
      svc.player.hold(tv)
      return svc.runner.submit(tv, artworkId, svc.modeFor(tv, mode))
    },
    next(tv: string) {
      svc.player.hold(tv)
      const category = svc.categoryOf(tv)
      const art = svc.runner.pickNext(tv, category)
      if (!art) throw new HTTPException(404, { message: "Geen werk gevonden in deze categorie" })
      return svc.runner.submit(tv, art.id, svc.modeFor(tv))
    },
    playbackOf(tv: string, favs = store.favouriteIds()) {
      const st = svc.player.state(tv)
      if (!st) return null
      const dto = (id: string | null) => {
        const a = id ? store.get(id) : null
        return a ? svc.artDTO(a, favs) : null
      }
      const { currentId, nextId, ...rest } = st
      return { ...rest, current: dto(currentId), next: dto(nextId) }
    },

    seriesSummary(row: SeriesRow, favs = store.favouriteIds()) {
      const items = seriesStore.items(row.id)
      const cover = items[0]?.artwork
      return {
        id: row.id,
        name: row.name,
        duration: row.duration,
        shuffle: row.shuffle,
        count: items.length,
        totalDuration: items.reduce((sum, i) => sum + (i.duration ?? row.duration), 0),
        cover: cover ? svc.artDTO(cover, favs) : null,
        playingOn: svc.player.playingOn(row.id),
      }
    },
    seriesDetail(row: SeriesRow) {
      const favs = store.favouriteIds()
      return {
        ...svc.seriesSummary(row, favs),
        items: seriesStore.items(row.id).map((i) => ({ artwork: svc.artDTO(i.artwork, favs), duration: i.duration })),
      }
    },
    /** A selection as a collection.v1 manifest, the lines for the GitHub issue form, and what was left out. */
    shareCollection(input: z.infer<typeof shareSchema>) {
      const items: Item[] = []
      const itemOf = new Map<string, Item>()
      const works: string[] = []
      const excluded: { id: string; reason: "own" | "unknown" | "licence-or-size" }[] = []
      const notForIssue: string[] = []
      for (const id of input.artworkIds) {
        const art = store.get(id)
        if (!art) {
          excluded.push({ id, reason: "unknown" })
          continue
        }
        if (art.source === MINE) {
          excluded.push({ id, reason: "own" })
          continue
        }
        const raw = art.source === "community" ? catalogue.raw(art.sourceId) : null
        const item = raw ?? catalogueItem(art, sources.get(art.source)?.name ?? art.department ?? art.source)
        if (!item) {
          excluded.push({ id, reason: "licence-or-size" })
          continue
        }
        items.push(item)
        itemOf.set(id, item)
        const line = workLine(art, raw)
        if (line) works.push(line)
        else notForIssue.push(id)
      }
      if (!items.length) throw new HTTPException(400, { message: "Niets om te delen: kies werken uit de catalogus" })
      const coverItem = (input.coverId && itemOf.get(input.coverId)) || items[0]!
      const meta = {
        id: input.id,
        title: input.title,
        description: input.description,
        tags: input.tags,
        curator: input.curator,
      }
      const manifest = {
        $schema: "https://dstollie.github.io/frame-art-collections/schema/collection.v1.schema.json",
        schema_version: 1 as const,
        ...meta,
        cover: coverItem.id,
        items,
      }
      const issue = issueUrl({ ...meta, works })
      return { manifest, works, excluded, notForIssue, issueUrl: issue.url, issueLeftOut: issue.left }
    },

    /** Series list and per-TV state to HA (MQTT); options change when series do. */
    publishSeries() {
      if (!svc.mqtt) return
      const list = seriesStore.list().map((r) => svc.seriesSummary(r))
      svc.mqtt.publishSeries(
        list,
        settings.tvs.map((t) => ({ tv: t.id, playback: svc.playbackOf(t.id) })),
      )
    },
    async selectSeries(tv: string, label: string) {
      if (label === NO_SERIES) return void svc.player.control(tv, "stop")
      const labels = seriesLabels(seriesStore.list())
      const id = [...labels].find(([, l]) => l === label)?.[0] ?? seriesStore.get(label)?.id
      if (id) svc.player.play(id, [tv])
    },
    async controlPlayback(tv: string, action: PlaybackAction) {
      return svc.player.control(tv, action)
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
  svc.player = new Player(
    {
      store,
      series: seriesStore,
      runner: svc.runner,
      tvs,
      modeFor: (tv) => svc.modeFor(tv),
      onChange: () => svc.publishSeries(),
    },
    deps.playerOptions,
  )
  svc.runner.protect = (tv) => svc.player.protect(tv)
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
  const { store, settings, tvs, runner, syncer, images, sources, collection, tokens, series, catalogue, live } = svc

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
  const seriesOr404 = (id: string) => {
    const s = series.get(id)
    if (!s) throw new HTTPException(404, { message: "Onbekende serie" })
    return s
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
          collections: catalogue
            .collections()
            .filter((col) => col.enabled)
            .map(({ id, title, count }) => ({ id, title, count })),
          live: sources
            .toDTO()
            .filter((s) => s.enabled && !s.local)
            .map(({ id, name }) => ({ id, name })),
        })
      })
      .get("/artworks", validate("query", listQuery), (c) => {
        const q = svc.toQuery(c.req.valid("query"))
        const { items, total, fuzzy } = store.query(q)
        const favs = store.favouriteIds()
        const next = (q.offset ?? 0) + items.length
        return c.json({
          items: items.map((a) => svc.artDTO(a, favs)),
          total,
          fuzzy,
          nextOffset: next < total ? next : null,
        })
      })
      .get("/facets", validate("query", listQuery), (c) => {
        const f = store.facets(svc.toQuery(c.req.valid("query")))
        const titles = new Map(catalogue.collections().map((col) => [col.id, col.title]))
        return c.json({
          ...f,
          collections: f.collections.map(({ id, n }) => ({ id, n, title: titles.get(id) ?? id })),
        })
      })
      .get("/landing", (c) => {
        const favs = store.favouriteIds()
        const dto = (id: string) => {
          const a = store.get(id)
          return a ? [svc.artDTO(a, favs)] : []
        }
        const rows = store.landing(12)
        return c.json({
          collections: catalogue
            .collections()
            .filter((col) => col.enabled && rows.has(col.id))
            .map((col) => ({
              id: col.id,
              title: col.title,
              description: col.description,
              count: col.count,
              items: rows.get(col.id)!.flatMap(dto),
            })),
          newest: store.query({ catalogue: true, sort: "new", limit: 18 }).items.map((a) => svc.artDTO(a, favs)),
          popular: [] as ReturnType<typeof svc.artDTO>[],
        })
      })
      .get(
        "/live",
        validate("query", z.object({ q: z.string().trim().min(2).max(200), source: z.string().optional() })),
        async (c) => {
          const { q, source } = c.req.valid("query")
          const favs = store.favouriteIds()
          const groups = await live.search(q, source ? { only: source } : {})
          return c.json(
            groups.map((g) => ({
              id: g.id,
              name: g.name,
              error: g.error,
              results: g.results.map((r) => ({
                artwork: { ...svc.artDTO(r.art, favs), thumb: r.art.thumbUrl, thumbPath: null },
                inCatalogue: r.inCatalogue,
                saved: r.saved,
                proposeUrl: r.proposeUrl,
              })),
            })),
          )
        },
      )
      .post("/live/save", validate("json", z.object({ id: z.string() })), (c) => {
        const art = live.save(c.req.valid("json").id)
        if (!art) throw new HTTPException(404, { message: "Zoek opnieuw; dit resultaat is verlopen" })
        return c.json(svc.artDTO(art))
      })
      .delete("/saved/:id", (c) => {
        store.setSaved(c.req.param("id"), false)
        return c.json({ saved: false as const })
      })
      .get("/collections", (c) =>
        c.json(
          catalogue
            .collections()
            .map(({ id, title, description, curator, count, landscapeCount, uhdCount, aiCount, enabled, coverId }) => {
              const cover = coverId ? store.get(coverId) : null
              return {
                id,
                title,
                description,
                curator,
                count,
                landscapeCount,
                uhdCount,
                aiCount,
                enabled,
                cover: cover ? svc.artDTO(cover) : null,
              }
            }),
        ),
      )
      .put("/settings/collections/:id", validate("json", z.object({ enabled: z.boolean() })), (c) => {
        if (!catalogue.setEnabled(c.req.param("id"), c.req.valid("json").enabled))
          throw new HTTPException(404, { message: "Onbekende collectie" })
        return c.json({ enabled: c.req.valid("json").enabled })
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
          series: series.containing(a.id),
          collections: svc.catalogue.collectionsOf(a.id),
          saved: store.isSaved(a.id),
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
          return c.json(svc.show(tv.id, art.id, mode))
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
      .post("/tvs/:tv/playback", validate("json", z.object({ action: z.enum(PLAYBACK_ACTIONS) })), async (c) => {
        const tv = tvOr404(c.req.param("tv"))
        if (!(await svc.player.control(tv.id, c.req.valid("json").action))) {
          throw new HTTPException(404, { message: "Er speelt geen serie op deze TV" })
        }
        return c.json({ playback: svc.playbackOf(tv.id) })
      })
      // ---------------------------------------------------------------- series
      .get("/series", (c) => {
        const favs = store.favouriteIds()
        return c.json(series.list().map((r) => svc.seriesSummary(r, favs)))
      })
      .post("/series", validate("json", seriesCreate), (c) => {
        const body = c.req.valid("json")
        let ids = body.artworkIds ?? []
        for (const id of ids) artOr404(id)
        if (body.albumId)
          ids = [
            ...ids,
            ...store.query({ album: albumOr404(body.albumId).id, limit: MAX_FROM_QUERY }).items.map((a) => a.id),
          ]
        if (body.query)
          ids = [
            ...ids,
            ...store.query({ ...svc.toQuery(body.query), offset: 0, limit: MAX_FROM_QUERY }).items.map((a) => a.id),
          ]
        const row = series.create(body.name, {
          ...(body.duration ? { duration: body.duration } : {}),
          ...(body.shuffle !== undefined ? { shuffle: body.shuffle } : {}),
          artworkIds: [...new Set(ids)],
        })
        svc.publishSeries()
        return c.json(svc.seriesDetail(row))
      })
      .get("/series/:id", (c) => c.json(svc.seriesDetail(seriesOr404(c.req.param("id")))))
      .patch("/series/:id", validate("json", seriesPatch), (c) => {
        const row = seriesOr404(c.req.param("id"))
        const { name, duration, shuffle } = c.req.valid("json")
        series.update(row.id, {
          ...(name !== undefined ? { name } : {}),
          ...(duration !== undefined ? { duration } : {}),
          ...(shuffle !== undefined ? { shuffle } : {}),
        })
        svc.publishSeries()
        return c.json(svc.seriesDetail(series.get(row.id)!))
      })
      .delete("/series/:id", (c) => {
        const row = seriesOr404(c.req.param("id"))
        svc.player.stopSeries(row.id)
        series.delete(row.id)
        svc.mqtt?.removeSeries(row.id)
        svc.publishSeries()
        return c.json({ deleted: true as const })
      })
      .post(
        "/series/:id/items",
        validate("json", z.object({ artworkId: z.string(), duration: durationSchema.nullable().optional() })),
        (c) => {
          const row = seriesOr404(c.req.param("id"))
          const { artworkId, duration } = c.req.valid("json")
          artOr404(artworkId)
          series.add(row.id, artworkId, duration ?? null)
          svc.publishSeries()
          return c.json(svc.seriesDetail(row))
        },
      )
      .patch(
        "/series/:id/items/:artworkId",
        validate("json", z.object({ duration: durationSchema.nullable() })),
        (c) => {
          const row = seriesOr404(c.req.param("id"))
          if (!series.setItemDuration(row.id, c.req.param("artworkId"), c.req.valid("json").duration)) {
            throw new HTTPException(404, { message: "Dit werk zit niet in de serie" })
          }
          svc.publishSeries()
          return c.json(svc.seriesDetail(row))
        },
      )
      .delete("/series/:id/items/:artworkId", (c) => {
        const row = seriesOr404(c.req.param("id"))
        series.remove(row.id, c.req.param("artworkId"))
        svc.publishSeries()
        return c.json(svc.seriesDetail(row))
      })
      .put("/series/:id/order", validate("json", z.object({ artworkIds: z.array(z.string()) })), (c) => {
        const row = seriesOr404(c.req.param("id"))
        series.reorder(row.id, c.req.valid("json").artworkIds)
        svc.publishSeries()
        return c.json(svc.seriesDetail(row))
      })
      .post("/series/:id/play", validate("json", z.object({ tvs: z.array(z.string()).min(1) })), (c) => {
        const row = seriesOr404(c.req.param("id"))
        const ids = c.req.valid("json").tvs
        for (const id of ids) {
          if (!tvOr404(id).paired) throw new HTTPException(409, { message: "Deze TV is nog niet gekoppeld" })
        }
        if (!series.itemIds(row.id).length) throw new HTTPException(400, { message: "Deze serie is leeg" })
        svc.player.play(row.id, ids)
        return c.json(ids.map((tv) => ({ tv, playback: svc.playbackOf(tv) })))
      })
      .post("/share", validate("json", shareSchema), (c) => c.json(svc.shareCollection(c.req.valid("json"))))
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

  // The Supervisor watchdog polls this without credentials; it must not reveal anything.
  app.get("/healthz", (c) => c.json({ ok: true }))

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

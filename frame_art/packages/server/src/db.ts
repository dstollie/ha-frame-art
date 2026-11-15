import Database from "better-sqlite3"
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, notInArray, sql, type SQL } from "drizzle-orm"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { CATEGORIZER_VERSION, LEGACY_CATEGORY_IDS, categorize, normalize } from "./categorize.js"
import { colorFamily, hexToRgb } from "./color.js"
import type { Artwork, Source } from "./models.js"

export const artworks = sqliteTable("artworks", {
  id: text("id").primaryKey(),
  source: text("source").$type<Source>().notNull(),
  sourceId: text("source_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  nationality: text("nationality").notNull().default(""),
  dateText: text("date_text").notNull().default(""),
  year: integer("year"),
  department: text("department").notNull().default(""),
  culture: text("culture").notNull().default(""),
  medium: text("medium").notNull().default(""),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  imageUrl: text("image_url").notNull(),
  thumbUrl: text("thumb_url").notNull(),
  pageUrl: text("page_url").notNull().default(""),
  licence: text("licence").notNull().default(""),
  aspect: real("aspect"),
  maxPx: integer("max_px"),
  categories: text("categories").notNull().default(","), // ",a,b," for LIKE '%,a,%'
  colorHex: text("color_hex"),
  colorFamily: text("color_family"),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  search: text("search").notNull().default(""),
  addedAt: real("added_at").notNull(),
})

export const favourites = sqliteTable("favourites", {
  artworkId: text("artwork_id").primaryKey(),
  addedAt: real("added_at").notNull(),
})

export const uploads = sqliteTable(
  "uploads",
  {
    tv: text("tv").notNull(),
    contentId: text("content_id").notNull(),
    artworkId: text("artwork_id").notNull(),
    uploadedAt: real("uploaded_at").notNull(),
    seq: integer("seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tv, t.contentId] })],
)

export const history = sqliteTable("history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tv: text("tv").notNull(),
  artworkId: text("artwork_id").notNull(),
  mode: text("mode").notNull(),
  shownAt: real("shown_at").notNull(),
})

export const sourceSettings = sqliteTable("source_settings", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  apiKey: text("api_key"),
})

export const albums = sqliteTable("albums", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: real("created_at").notNull(),
})

export const albumItems = sqliteTable(
  "album_items",
  {
    albumId: text("album_id").notNull(),
    artworkId: text("artwork_id").notNull(),
    addedAt: real("added_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.albumId, t.artworkId] })],
)

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

const DDL = `
CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '', nationality TEXT NOT NULL DEFAULT '', date_text TEXT NOT NULL DEFAULT '',
  year INTEGER, department TEXT NOT NULL DEFAULT '', culture TEXT NOT NULL DEFAULT '', medium TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]', image_url TEXT NOT NULL, thumb_url TEXT NOT NULL, page_url TEXT NOT NULL DEFAULT '',
  aspect REAL, max_px INTEGER, categories TEXT NOT NULL DEFAULT ',', color_hex TEXT, color_family TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, search TEXT NOT NULL DEFAULT '', added_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artworks_aspect ON artworks(aspect);
CREATE INDEX IF NOT EXISTS idx_artworks_color ON artworks(color_family);
CREATE INDEX IF NOT EXISTS idx_artworks_source ON artworks(source);
CREATE TABLE IF NOT EXISTS favourites (artwork_id TEXT PRIMARY KEY, added_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS uploads (
  tv TEXT NOT NULL, content_id TEXT NOT NULL, artwork_id TEXT NOT NULL, uploaded_at REAL NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tv, content_id)
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tv TEXT NOT NULL, artwork_id TEXT NOT NULL, mode TEXT NOT NULL, shown_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_settings (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, api_key TEXT);
CREATE TABLE IF NOT EXISTS albums (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS album_items (
  album_id TEXT NOT NULL, artwork_id TEXT NOT NULL, added_at REAL NOT NULL, PRIMARY KEY (album_id, artwork_id)
);
`

/** "Liggend": wide enough for a landscape Frame, but no 4:1 handscrolls that end up as a sliver. */
export const LANDSCAPE_MIN = 1.2
export const LANDSCAPE_MAX = 2.8

export interface Query {
  category?: string | null
  color?: string | null
  q?: string | null
  landscape?: boolean
  favourites?: boolean
  source?: string | null
  offset?: number
  limit?: number
  seed?: number
  /** Only these providers (the enabled ones); empty means none. */
  sources?: string[] | undefined
  album?: string | null
}

type Row = typeof artworks.$inferSelect

function toArtwork(r: Row): Artwork {
  return {
    id: r.id,
    source: r.source,
    sourceId: r.sourceId,
    title: r.title,
    artist: r.artist,
    nationality: r.nationality,
    dateText: r.dateText,
    year: r.year,
    department: r.department,
    culture: r.culture,
    medium: r.medium,
    tags: r.tags,
    imageUrl: r.imageUrl,
    thumbUrl: r.thumbUrl,
    pageUrl: r.pageUrl,
    licence: r.licence,
    aspect: r.aspect,
    maxPx: r.maxPx,
    categories: r.categories.split(",").filter(Boolean),
    colorHex: r.colorHex,
    colorFamily: r.colorFamily,
    hidden: r.hidden,
  }
}

const now = () => Date.now() / 1000

export class Store {
  readonly sqlite: Database.Database
  readonly db: BetterSQLite3Database
  private seq = 0

  constructor(path: string) {
    this.sqlite = new Database(path)
    this.sqlite.pragma("journal_mode = WAL")
    this.sqlite.exec(DDL)
    this.db = drizzle(this.sqlite)
    this.migrate()
    this.seq = (this.sqlite.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM uploads").get() as { s: number }).s
  }

  close() {
    this.sqlite.close()
  }

  /** Idempotent schema and data upgrades; runs at every boot. */
  private migrate() {
    const columns = new Set(
      (this.sqlite.prepare("PRAGMA table_info(artworks)").all() as { name: string }[]).map((c) => c.name),
    )
    if (!columns.has("licence")) this.sqlite.exec("ALTER TABLE artworks ADD COLUMN licence TEXT NOT NULL DEFAULT ''")
    if (this.getMeta("categorizer_version") === CATEGORIZER_VERSION) return
    const update = this.sqlite.prepare("UPDATE artworks SET categories = ?, color_family = ? WHERE id = ?")
    this.sqlite.transaction(() => {
      for (const row of this.db.select().from(artworks).all()) {
        const art = toArtwork(row)
        const rgb = art.colorHex ? hexToRgb(art.colorHex) : null
        const family = rgb ? colorFamily(rgb) : art.colorFamily
        update.run(`,${categorize(art).join(",")},`, family, art.id)
      }
      for (const m of this.db.select().from(meta).all()) {
        if (m.key.startsWith("category:") && LEGACY_CATEGORY_IDS[m.value]) {
          this.setMeta(m.key, LEGACY_CATEGORY_IDS[m.value]!)
        }
      }
    })()
    this.setMeta("categorizer_version", CATEGORIZER_VERSION)
  }

  // ------------------------------------------------------------ artworks
  upsertArtworks(arts: Artwork[]): number {
    const t = now()
    this.sqlite.transaction(() => {
      for (const a of arts) {
        const cats = a.categories.length ? a.categories : categorize(a)
        const values = {
          id: a.id,
          source: a.source,
          sourceId: a.sourceId,
          title: a.title,
          artist: a.artist,
          nationality: a.nationality,
          dateText: a.dateText,
          year: a.year,
          department: a.department,
          culture: a.culture,
          medium: a.medium,
          tags: a.tags,
          imageUrl: a.imageUrl,
          thumbUrl: a.thumbUrl,
          pageUrl: a.pageUrl,
          licence: a.licence,
          aspect: a.aspect,
          maxPx: a.maxPx,
          categories: `,${cats.join(",")},`,
          colorHex: a.colorHex,
          colorFamily: a.colorFamily,
          hidden: a.hidden,
          search: normalize(`${a.title} ${a.artist} ${a.dateText}`),
          addedAt: t,
        }
        this.db
          .insert(artworks)
          .values(values)
          .onConflictDoUpdate({
            target: artworks.id,
            set: {
              title: values.title,
              artist: values.artist,
              nationality: values.nationality,
              dateText: values.dateText,
              year: values.year,
              department: values.department,
              culture: values.culture,
              medium: values.medium,
              tags: values.tags,
              imageUrl: values.imageUrl,
              thumbUrl: values.thumbUrl,
              pageUrl: values.pageUrl,
              licence: values.licence,
              categories: values.categories,
              search: values.search,
              aspect: sql`COALESCE(excluded.aspect, ${artworks.aspect})`,
              maxPx: sql`COALESCE(excluded.max_px, ${artworks.maxPx})`,
            },
          })
          .run()
      }
    })()
    return arts.length
  }

  knownIds(source: string): Set<string> {
    return new Set(
      this.db
        .select({ id: artworks.id })
        .from(artworks)
        .where(eq(artworks.source, source as Source))
        .all()
        .map((r) => r.id),
    )
  }

  get(id: string): Artwork | null {
    const r = this.db.select().from(artworks).where(eq(artworks.id, id)).get()
    return r ? toArtwork(r) : null
  }

  private where(q: Query, exclude?: Set<string>): SQL | undefined {
    const c: (SQL | undefined)[] = [eq(artworks.hidden, false)]
    if (q.category) c.push(like(artworks.categories, `%,${q.category},%`))
    if (q.color) c.push(eq(artworks.colorFamily, q.color))
    if (q.landscape) c.push(and(gte(artworks.aspect, LANDSCAPE_MIN), lte(artworks.aspect, LANDSCAPE_MAX)))
    if (q.source) c.push(eq(artworks.source, q.source as Source))
    if (q.sources) c.push(q.sources.length ? inArray(artworks.source, q.sources) : sql`0`)
    if (q.album) {
      c.push(
        inArray(
          artworks.id,
          this.db.select({ id: albumItems.artworkId }).from(albumItems).where(eq(albumItems.albumId, q.album)),
        ),
      )
    }
    if (q.favourites) c.push(isNotNull(favourites.artworkId))
    for (const word of normalize(q.q ?? "")
      .split(/\s+/)
      .filter(Boolean))
      c.push(like(artworks.search, `%${word}%`))
    if (exclude?.size) c.push(notInArray(artworks.id, [...exclude]))
    return and(...c)
  }

  query(q: Query): { items: Artwork[]; total: number } {
    const where = this.where(q)
    const total = this.db
      .select({ n: sql<number>`count(*)` })
      .from(artworks)
      .leftJoin(favourites, eq(favourites.artworkId, artworks.id))
      .where(where)
      .get()!.n
    const seed = (q.seed ?? 1) * 7919 + 1
    const rows = this.db
      .select({ a: artworks })
      .from(artworks)
      .leftJoin(favourites, eq(favourites.artworkId, artworks.id))
      .where(where)
      .orderBy(q.favourites ? desc(favourites.addedAt) : sql`((${artworks}.rowid * ${seed}) % 1000003)`)
      .limit(q.limit ?? 48)
      .offset(q.offset ?? 0)
      .all()
    return { items: rows.map((r) => toArtwork(r.a)), total }
  }

  random(q: Query, exclude?: Set<string>): Artwork | null {
    const r = this.db
      .select({ a: artworks })
      .from(artworks)
      .leftJoin(favourites, eq(favourites.artworkId, artworks.id))
      .where(this.where(q, exclude))
      .orderBy(sql`RANDOM()`)
      .limit(1)
      .get()
    return r ? toArtwork(r.a) : null
  }

  categoryCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const { categories } of this.db
      .select({ categories: artworks.categories })
      .from(artworks)
      .where(eq(artworks.hidden, false))
      .all()) {
      for (const c of categories.split(",")) if (c) counts[c] = (counts[c] ?? 0) + 1
    }
    return counts
  }

  count(): number {
    return this.db
      .select({ n: sql<number>`count(*)` })
      .from(artworks)
      .where(eq(artworks.hidden, false))
      .get()!.n
  }

  countWithColor(): number {
    return this.db
      .select({ n: sql<number>`count(*)` })
      .from(artworks)
      .where(isNotNull(artworks.colorHex))
      .get()!.n
  }

  setHidden(id: string, hidden: boolean) {
    this.db.update(artworks).set({ hidden }).where(eq(artworks.id, id)).run()
  }

  needingColor(limit: number): Artwork[] {
    return this.db
      .select()
      .from(artworks)
      .where(and(isNull(artworks.colorHex), eq(artworks.hidden, false)))
      .limit(limit)
      .all()
      .map(toArtwork)
  }

  setColor(id: string, hex: string, family: string, aspect: number | null = null) {
    this.db
      .update(artworks)
      .set({ colorHex: hex, colorFamily: family, aspect: sql`COALESCE(${artworks.aspect}, ${aspect})` })
      .where(eq(artworks.id, id))
      .run()
  }

  // ------------------------------------------------------------ favourites
  setFavourite(id: string, on: boolean) {
    if (on) this.db.insert(favourites).values({ artworkId: id, addedAt: now() }).onConflictDoNothing().run()
    else this.db.delete(favourites).where(eq(favourites.artworkId, id)).run()
  }

  favouriteIds(): Set<string> {
    return new Set(
      this.db
        .select({ id: favourites.artworkId })
        .from(favourites)
        .all()
        .map((r) => r.id),
    )
  }

  // ------------------------------------------------------------ uploads + history
  recordUpload(tv: string, contentId: string, artworkId: string) {
    this.db
      .insert(uploads)
      .values({ tv, contentId, artworkId, uploadedAt: now(), seq: ++this.seq })
      .onConflictDoUpdate({
        target: [uploads.tv, uploads.contentId],
        set: { artworkId, uploadedAt: now(), seq: this.seq },
      })
      .run()
  }

  /** Our own uploads beyond the newest `keep` (favourites: beyond `keepFavourites`). */
  prunableUploads(tv: string, keep: number, keepFavourites: number): string[] {
    const favs = this.favouriteIds()
    const rows = this.db.select().from(uploads).where(eq(uploads.tv, tv)).orderBy(desc(uploads.seq)).all()
    return rows.filter((r, i) => i >= (favs.has(r.artworkId) ? keepFavourites : keep)).map((r) => r.contentId)
  }

  removeUploads(tv: string, contentIds: string[]) {
    for (const contentId of contentIds)
      this.db
        .delete(uploads)
        .where(and(eq(uploads.tv, tv), eq(uploads.contentId, contentId)))
        .run()
  }

  addHistory(tv: string, artworkId: string, mode: string) {
    this.db.insert(history).values({ tv, artworkId, mode, shownAt: now() }).run()
  }

  history(limit = 60, tv?: string) {
    return this.db
      .select()
      .from(history)
      .where(tv ? eq(history.tv, tv) : undefined)
      .orderBy(desc(history.id))
      .limit(limit)
      .all()
  }

  recentIds(tv: string, limit: number): Set<string> {
    return new Set(this.history(limit, tv).map((h) => h.artworkId))
  }

  // ------------------------------------------------------------ meta
  getMeta(key: string): string | null {
    return this.db.select().from(meta).where(eq(meta.key, key)).get()?.value ?? null
  }

  setMeta(key: string, value: string) {
    this.db.insert(meta).values({ key, value }).onConflictDoUpdate({ target: meta.key, set: { value } }).run()
  }

  // ------------------------------------------------------------ sources
  sourceSettings(): Map<string, { enabled: boolean; apiKey: string | null }> {
    return new Map(
      this.db
        .select()
        .from(sourceSettings)
        .all()
        .map((r) => [r.id, { enabled: r.enabled, apiKey: r.apiKey }]),
    )
  }

  setSourceSetting(id: string, value: { enabled: boolean; apiKey?: string | null }) {
    const apiKey = value.apiKey === undefined ? (this.sourceSettings().get(id)?.apiKey ?? null) : value.apiKey
    this.db
      .insert(sourceSettings)
      .values({ id, enabled: value.enabled, apiKey })
      .onConflictDoUpdate({ target: sourceSettings.id, set: { enabled: value.enabled, apiKey } })
      .run()
  }

  sourceCounts(): Record<string, number> {
    const rows = this.sqlite
      .prepare("SELECT source, COUNT(*) AS n FROM artworks WHERE hidden = 0 GROUP BY source")
      .all() as { source: string; n: number }[]
    return Object.fromEntries(rows.map((r) => [r.source, r.n]))
  }

  // ------------------------------------------------------------ albums ("My collection")
  createAlbum(id: string, name: string) {
    this.db.insert(albums).values({ id, name, createdAt: now() }).run()
  }

  renameAlbum(id: string, name: string): boolean {
    return this.db.update(albums).set({ name }).where(eq(albums.id, id)).run().changes > 0
  }

  deleteAlbum(id: string): boolean {
    this.db.delete(albumItems).where(eq(albumItems.albumId, id)).run()
    return this.db.delete(albums).where(eq(albums.id, id)).run().changes > 0
  }

  albums(): { id: string; name: string; count: number; cover: string | null }[] {
    return this.db
      .select({
        id: albums.id,
        name: albums.name,
        count: sql<number>`(SELECT COUNT(*) FROM album_items i WHERE i.album_id = ${albums.id})`,
        cover: sql<
          string | null
        >`(SELECT i.artwork_id FROM album_items i WHERE i.album_id = ${albums.id} ORDER BY i.added_at DESC LIMIT 1)`,
      })
      .from(albums)
      .orderBy(asc(albums.name))
      .all()
  }

  album(id: string) {
    return this.db.select().from(albums).where(eq(albums.id, id)).get() ?? null
  }

  setAlbumItem(albumId: string, artworkId: string, on: boolean) {
    if (on) this.db.insert(albumItems).values({ albumId, artworkId, addedAt: now() }).onConflictDoNothing().run()
    else
      this.db
        .delete(albumItems)
        .where(and(eq(albumItems.albumId, albumId), eq(albumItems.artworkId, artworkId)))
        .run()
  }

  albumsOf(artworkId: string): string[] {
    return this.db
      .select({ id: albumItems.albumId })
      .from(albumItems)
      .where(eq(albumItems.artworkId, artworkId))
      .all()
      .map((r) => r.id)
  }

  /** Remove a work completely (own uploads only); history rows stay but no longer resolve. */
  deleteArtwork(id: string) {
    this.sqlite.transaction(() => {
      this.db.delete(albumItems).where(eq(albumItems.artworkId, id)).run()
      this.db.delete(favourites).where(eq(favourites.artworkId, id)).run()
      this.db.delete(artworks).where(eq(artworks.id, id)).run()
    })()
  }
}

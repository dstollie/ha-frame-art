/** Series: an ordered list of works with a duration per series and optionally per work. */
import { randomUUID } from "node:crypto"

import { and, asc, eq, sql } from "drizzle-orm"
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

import type { Store } from "./db.js"
import type { Artwork } from "./models.js"

export const series = sqliteTable("series", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Seconds per work unless the work has its own. */
  duration: integer("duration").notNull(),
  shuffle: integer("shuffle", { mode: "boolean" }).notNull().default(false),
  createdAt: real("created_at").notNull(),
})

export const seriesItems = sqliteTable(
  "series_items",
  {
    seriesId: text("series_id").notNull(),
    artworkId: text("artwork_id").notNull(),
    position: integer("position").notNull(),
    duration: integer("duration"),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.artworkId] })],
)

const DDL = `
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, duration INTEGER NOT NULL, shuffle INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS series_items (
  series_id TEXT NOT NULL, artwork_id TEXT NOT NULL, position INTEGER NOT NULL, duration INTEGER,
  PRIMARY KEY (series_id, artwork_id)
);
`

export const DEFAULT_DURATION = 30 * 60
export const MIN_DURATION = 60
export const MAX_DURATION = 7 * 24 * 3600
/** Creating a series from search results takes at most this many works. */
export const MAX_FROM_QUERY = 200

export type SeriesRow = typeof series.$inferSelect
export interface SeriesItem {
  artwork: Artwork
  duration: number | null
}

export class SeriesStore {
  constructor(private readonly store: Store) {
    store.sqlite.exec(DDL)
  }

  private get db() {
    return this.store.db
  }

  list(): SeriesRow[] {
    return this.db.select().from(series).orderBy(asc(series.name), asc(series.createdAt)).all()
  }

  get(id: string): SeriesRow | null {
    return this.db.select().from(series).where(eq(series.id, id)).get() ?? null
  }

  create(name: string, opts: { duration?: number; shuffle?: boolean; artworkIds?: string[] } = {}): SeriesRow {
    const id = randomUUID().slice(0, 8)
    this.store.sqlite.transaction(() => {
      this.db
        .insert(series)
        .values({
          id,
          name,
          duration: opts.duration ?? DEFAULT_DURATION,
          shuffle: opts.shuffle ?? false,
          createdAt: Date.now() / 1000,
        })
        .run()
      for (const a of opts.artworkIds ?? []) this.add(id, a)
    })()
    return this.get(id)!
  }

  update(id: string, patch: { name?: string; duration?: number; shuffle?: boolean }) {
    if (Object.keys(patch).length) this.db.update(series).set(patch).where(eq(series.id, id)).run()
  }

  delete(id: string): boolean {
    this.db.delete(seriesItems).where(eq(seriesItems.seriesId, id)).run()
    return this.db.delete(series).where(eq(series.id, id)).run().changes > 0
  }

  /** Appends a work; a work that's already in the series stays where it is. */
  add(id: string, artworkId: string, duration: number | null = null) {
    const max = this.db
      .select({ p: sql<number>`COALESCE(MAX(${seriesItems.position}), -1)` })
      .from(seriesItems)
      .where(eq(seriesItems.seriesId, id))
      .get()!.p
    this.db
      .insert(seriesItems)
      .values({ seriesId: id, artworkId, position: max + 1, duration })
      .onConflictDoNothing()
      .run()
  }

  remove(id: string, artworkId: string): boolean {
    return (
      this.db
        .delete(seriesItems)
        .where(and(eq(seriesItems.seriesId, id), eq(seriesItems.artworkId, artworkId)))
        .run().changes > 0
    )
  }

  setItemDuration(id: string, artworkId: string, duration: number | null): boolean {
    return (
      this.db
        .update(seriesItems)
        .set({ duration })
        .where(and(eq(seriesItems.seriesId, id), eq(seriesItems.artworkId, artworkId)))
        .run().changes > 0
    )
  }

  /** New order; works not named keep their relative order after the named ones. */
  reorder(id: string, artworkIds: string[]) {
    const current = this.itemIds(id)
    const named = artworkIds.filter((a) => current.includes(a))
    const order = [...new Set(named), ...current.filter((a) => !named.includes(a))]
    this.store.sqlite.transaction(() => {
      order.forEach((artworkId, position) =>
        this.db
          .update(seriesItems)
          .set({ position })
          .where(and(eq(seriesItems.seriesId, id), eq(seriesItems.artworkId, artworkId)))
          .run(),
      )
    })()
  }

  /** Ids of the series this work is in. */
  containing(artworkId: string): string[] {
    return this.db
      .select({ id: seriesItems.seriesId })
      .from(seriesItems)
      .where(eq(seriesItems.artworkId, artworkId))
      .all()
      .map((r) => r.id)
  }

  itemIds(id: string): string[] {
    return this.db
      .select({ a: seriesItems.artworkId })
      .from(seriesItems)
      .where(eq(seriesItems.seriesId, id))
      .orderBy(asc(seriesItems.position))
      .all()
      .map((r) => r.a)
  }

  /** Items whose work still exists (deleted uploads drop out). */
  items(id: string): SeriesItem[] {
    return this.db
      .select({ a: seriesItems.artworkId, d: seriesItems.duration })
      .from(seriesItems)
      .where(eq(seriesItems.seriesId, id))
      .orderBy(asc(seriesItems.position))
      .all()
      .flatMap((r) => {
        const artwork = this.store.get(r.a)
        return artwork ? [{ artwork, duration: r.d }] : []
      })
  }

  /** Seconds a work stays up in this series: its own duration, else the series'. */
  durationOf(row: SeriesRow, artworkId: string): number {
    const own = this.db
      .select({ d: seriesItems.duration })
      .from(seriesItems)
      .where(and(eq(seriesItems.seriesId, row.id), eq(seriesItems.artworkId, artworkId)))
      .get()?.d
    return own ?? row.duration
  }
}

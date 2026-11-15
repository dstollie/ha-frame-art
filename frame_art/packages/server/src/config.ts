import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { z } from "zod"

import { MODES } from "./models.js"

const OptionsSchema = z.object({
  tvs: z
    .array(
      z.object({
        name: z.string().min(1),
        host: z.string().min(1),
        wake_entity: z.string().optional().nullable(),
      }),
    )
    .default([]),
  default_mode: z.enum(MODES).default("light"),
  keep_uploads: z.number().int().min(1).default(20),
  keep_favourite_uploads: z.number().int().min(1).default(50),
  cache_mb: z.number().int().min(100).default(1500),
  sync_hour: z.number().int().min(0).max(23).default(4),
  sync_on_start: z.boolean().default(true),
  mqtt: z.boolean().default(true),
})

export interface TVConfig {
  id: string
  name: string
  host: string
  wakeEntity: string | null
  /** Ports are only overridden in tests (fake Frame). */
  wsPort?: number
  restPort?: number
  ackTimeoutMs?: number
}

export interface Settings {
  dataDir: string
  tvs: TVConfig[]
  defaultMode: (typeof MODES)[number]
  keepUploads: number
  keepFavouriteUploads: number
  cacheMb: number
  syncHour: number
  syncOnStart: boolean
  mqtt: boolean
  supervisorToken: string | null
}

export const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "tv"

export const paths = (s: Pick<Settings, "dataDir">) => ({
  db: path.join(s.dataDir, "frame_art.sqlite"),
  tokens: path.join(s.dataDir, "tokens"),
  sources: path.join(s.dataDir, "cache", "sources"),
  renders: path.join(s.dataDir, "cache", "renders"),
})

export function ensureDirs(s: Pick<Settings, "dataDir">) {
  const p = paths(s)
  for (const d of [p.tokens, p.sources, p.renders]) mkdirSync(d, { recursive: true })
}

export function loadSettings(dataDir = process.env.FRAME_ART_DATA ?? "/data"): Settings {
  const file = path.join(dataDir, "options.json")
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  const o = OptionsSchema.parse(raw)
  const s: Settings = {
    dataDir,
    tvs: o.tvs.map((t) => ({ id: slug(t.name), name: t.name, host: t.host, wakeEntity: t.wake_entity || null })),
    defaultMode: o.default_mode,
    keepUploads: o.keep_uploads,
    keepFavouriteUploads: o.keep_favourite_uploads,
    cacheMb: o.cache_mb,
    syncHour: o.sync_hour,
    syncOnStart: o.sync_on_start,
    mqtt: o.mqtt,
    supervisorToken: process.env.SUPERVISOR_TOKEN ?? null,
  }
  ensureDirs(s)
  return s
}

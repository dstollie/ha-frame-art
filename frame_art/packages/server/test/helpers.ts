import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

import { ensureDirs, type Settings } from "../src/config.js"
import { newArtwork, type Artwork } from "../src/models.js"

const here = path.dirname(fileURLToPath(import.meta.url))
export const fixture = <T = any>(name: string): T => JSON.parse(readFileSync(path.join(here, "fixtures", name), "utf8"))

export async function jpeg(w: number, h: number, rgb: [number, number, number] = [40, 90, 50]): Promise<Buffer> {
  const stripes = []
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 8))) {
    stripes.push({
      input: {
        create: {
          width: Math.max(1, Math.floor(w / 20)),
          height: Math.max(1, Math.floor(h / 6)),
          channels: 3 as const,
          background: { r: 200, g: 60, b: 40 },
        },
      },
      left: x,
      top: Math.floor(h / 3),
    })
  }
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .composite(stripes.filter((s) => s.left + Math.floor(w / 20) <= w))
    .jpeg({ quality: 90 })
    .toBuffer()
}

export function art(id = "met:1", extra: Partial<Artwork> = {}): Artwork {
  const [source, sourceId] = id.split(":") as [Artwork["source"], string]
  return newArtwork({
    id,
    source,
    sourceId,
    title: `Werk ${id}`,
    artist: "Claude Monet",
    nationality: "French",
    dateText: "1874",
    year: 1874,
    imageUrl: `https://img.test/${id}/full.jpg`,
    thumbUrl: `https://img.test/${id}/thumb.jpg`,
    aspect: 1.6,
    ...extra,
  })
}

export function tempSettings(extra: Partial<Settings> = {}): Settings {
  const dataDir = mkdtempSync(path.join(tmpdir(), "frame-art-"))
  const s: Settings = {
    dataDir,
    tvs: [],
    defaultMode: "light",
    keepUploads: 3,
    keepFavouriteUploads: 5,
    cacheMb: 200,
    syncHour: 4,
    syncOnStart: false,
    mqtt: false,
    supervisorToken: null,
    ...extra,
  }
  ensureDirs(s)
  return s
}

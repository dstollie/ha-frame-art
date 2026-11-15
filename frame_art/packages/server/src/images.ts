/**
 * Image bytes for the add-on: museum sources (downloaded once), thumbnails for providers the
 * browser can't load directly, renders, and the user's own collection. Caches are LRU-capped;
 * the collection is never pruned.
 */
import { createHash, randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

import sharp from "sharp"

import type { Artwork, Mode } from "./models.js"
import { USER_AGENT, type Fetch } from "./providers/http.js"
import type { Sources } from "./sources.js"

const key = (id: string) => createHash("sha1").update(id).digest("hex").slice(0, 20)

export interface ImageDirs {
  sources: string
  renders: string
  thumbs: string
  collection: string
}

/** Where a "My collection" work keeps its bytes: `collection:<file>` in imageUrl/thumbUrl. */
export const COLLECTION_PREFIX = "collection:"

export interface StoredUpload {
  id: string
  width: number
  height: number
  imageUrl: string
  thumbUrl: string
}

/** Uploads are normalised: rotated upright, sRGB JPEG, at most 6000 px on the long side. */
const MAX_UPLOAD_PX = 6000

export class ImageCache {
  constructor(
    private readonly dirs: ImageDirs,
    private readonly capBytes: number,
    private readonly fetchFn: Fetch = fetch,
    private readonly sources?: Sources,
  ) {}

  private headers(art: Artwork) {
    return { "User-Agent": USER_AGENT, ...this.sources?.get(art.source)?.imageHeaders }
  }

  private local(url: string): Buffer | null {
    if (!url.startsWith(COLLECTION_PREFIX)) return null
    const file = path.join(this.dirs.collection, path.basename(url.slice(COLLECTION_PREFIX.length)))
    if (!existsSync(file)) throw new Error("Bestand uit Mijn collectie ontbreekt")
    return readFileSync(file)
  }

  async source(art: Artwork): Promise<Buffer> {
    const own = this.local(art.imageUrl)
    if (own) return own
    const file = path.join(this.dirs.sources, `${key(art.id)}.img`)
    if (existsSync(file)) {
      touch(file)
      return readFileSync(file)
    }
    const url = this.sources?.get(art.source)?.downloadUrl(art) ?? art.imageUrl
    const r = await this.fetchFn(url, {
      headers: this.headers(art),
      redirect: "follow",
      signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) throw new Error(`Museum gaf ${r.status} voor ${art.title}`)
    const buf = Buffer.from(await r.arrayBuffer())
    writeFileSync(file, buf)
    this.prune()
    return buf
  }

  /** Thumbnail bytes (own uploads, and providers whose CDN the browser can't use). */
  async thumb(art: Artwork): Promise<Buffer> {
    const own = this.local(art.thumbUrl)
    if (own) return own
    const file = path.join(this.dirs.thumbs, `${key(art.id)}.jpg`)
    if (existsSync(file)) return readFileSync(file)
    const r = await this.fetchFn(art.thumbUrl, {
      headers: this.headers(art),
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    })
    if (!r.ok) throw new Error(`Thumbnail ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    writeFileSync(file, buf)
    return buf
  }

  /** Store an upload for "My collection" and return where it lives. */
  async storeUpload(data: Buffer): Promise<StoredUpload> {
    const id = randomUUID()
    const img = sharp(data, { failOn: "none", limitInputPixels: 300_000_000 }).rotate()
    const meta = await img.metadata()
    if (!meta.width || !meta.height) throw new Error("Geen geldige afbeelding")
    const full = await img
      .clone()
      .resize(MAX_UPLOAD_PX, MAX_UPLOAD_PX, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true })
    const thumb = await sharp(full.data).resize(800, 800, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer()
    writeFileSync(path.join(this.dirs.collection, `${id}.jpg`), full.data)
    writeFileSync(path.join(this.dirs.collection, `${id}_thumb.jpg`), thumb)
    return {
      id,
      width: full.info.width,
      height: full.info.height,
      imageUrl: `${COLLECTION_PREFIX}${id}.jpg`,
      thumbUrl: `${COLLECTION_PREFIX}${id}_thumb.jpg`,
    }
  }

  deleteUpload(art: Artwork) {
    for (const url of [art.imageUrl, art.thumbUrl]) {
      if (!url.startsWith(COLLECTION_PREFIX)) continue
      const file = path.join(this.dirs.collection, path.basename(url.slice(COLLECTION_PREFIX.length)))
      if (existsSync(file)) unlinkSync(file)
    }
    for (const mode of ["light", "dark", "blur", "fill"] as Mode[]) {
      const r = this.renderPath(art.id, mode)
      if (existsSync(r)) unlinkSync(r)
    }
  }

  renderPath(id: string, mode: Mode): string {
    return path.join(this.dirs.renders, `${key(id)}_${mode}.jpg`)
  }

  private files() {
    return [this.dirs.sources, this.dirs.renders, this.dirs.thumbs].flatMap((d) =>
      readdirSync(d).map((f) => {
        const p = path.join(d, f)
        const st = statSync(p)
        return { p, size: st.size, mtime: st.mtimeMs }
      }),
    )
  }

  usage(): number {
    return this.files().reduce((n, f) => n + f.size, 0)
  }

  prune(): void {
    const files = this.files()
    let total = files.reduce((n, f) => n + f.size, 0)
    if (total <= this.capBytes) return
    for (const f of files.toSorted((a, b) => a.mtime - b.mtime)) {
      unlinkSync(f.p)
      total -= f.size
      if (total <= this.capBytes * 0.8) break
    }
  }
}

export function touch(file: string) {
  const t = new Date()
  utimesSync(file, t, t)
}

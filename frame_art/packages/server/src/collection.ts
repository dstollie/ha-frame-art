/** "My collection": uploads (file, URL or base64) become works of the `mine` provider, grouped in albums. */
import { randomUUID } from "node:crypto"

import { categorize } from "./categorize.js"
import type { Store } from "./db.js"
import type { ImageCache } from "./images.js"
import { newArtwork, type Artwork } from "./models.js"
import { USER_AGENT, round4, type Fetch } from "./providers/http.js"
import { MINE } from "./providers/mine.js"

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024

export class CollectionError extends Error {}

export class Collection {
  constructor(
    private readonly store: Store,
    private readonly images: ImageCache,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async add(input: { data: Buffer; title?: string | null; artist?: string | null; albumId?: string | null }) {
    if (input.data.length > MAX_UPLOAD_BYTES) throw new CollectionError("Afbeelding is groter dan 40 MB")
    if (input.albumId && !this.store.album(input.albumId)) throw new CollectionError("Onbekend album")
    const stored = await this.images.storeUpload(input.data).catch(() => {
      throw new CollectionError("Dit is geen afbeelding die we kunnen lezen")
    })
    const now = new Date()
    const art = newArtwork({
      id: `${MINE}:${stored.id}`,
      source: MINE,
      sourceId: stored.id,
      title: input.title?.trim() || `Upload ${now.toISOString().slice(0, 16).replace("T", " ")}`,
      artist: input.artist?.trim() ?? "",
      dateText: now.toISOString().slice(0, 10),
      year: now.getFullYear(),
      department: "My collection",
      licence: "Yours",
      imageUrl: stored.imageUrl,
      thumbUrl: stored.thumbUrl,
      aspect: round4(stored.width / stored.height),
      maxPx: Math.max(stored.width, stored.height),
    })
    art.categories = categorize(art)
    this.store.upsertArtworks([art])
    if (input.albumId) this.store.setAlbumItem(input.albumId, art.id, true)
    return this.store.get(art.id)!
  }

  async addFromUrl(url: string, extra: { title?: string | null; albumId?: string | null } = {}) {
    if (!/^https?:\/\//i.test(url)) throw new CollectionError("Alleen http(s)-URL's")
    const r = await this.fetchFn(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) throw new CollectionError(`Downloaden mislukte (${r.status})`)
    const length = Number(r.headers.get("content-length") ?? 0)
    if (length > MAX_UPLOAD_BYTES) throw new CollectionError("Afbeelding is groter dan 40 MB")
    return this.add({ data: Buffer.from(await r.arrayBuffer()), ...extra })
  }

  async addFromBase64(base64: string, extra: { title?: string | null; albumId?: string | null } = {}) {
    const clean = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "")
    return this.add({ data: Buffer.from(clean, "base64"), ...extra })
  }

  remove(art: Artwork) {
    if (art.source !== MINE) throw new CollectionError("Alleen eigen uploads kun je verwijderen")
    this.images.deleteUpload(art)
    this.store.deleteArtwork(art.id)
  }

  createAlbum(name: string) {
    const id = randomUUID().slice(0, 8)
    this.store.createAlbum(id, name.trim() || "Album")
    return this.store.album(id)!
  }
}

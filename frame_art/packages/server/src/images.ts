/** Download sources once and keep sources + renders in an LRU-capped disk cache. */
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

import type { Artwork, Mode } from "./models.js"
import { USER_AGENT, type Fetch } from "./sources/index.js"

export function downloadUrl(art: Artwork): string {
  // IIIF: let the server scale; never fetch the 10k+ px master on a Pi.
  if (art.source === "rijks") return art.imageUrl.replace("/full/max/", "/full/!4096,4096/")
  return art.imageUrl
}

const key = (id: string) => createHash("sha1").update(id).digest("hex").slice(0, 20)

export class ImageCache {
  constructor(
    private readonly sourcesDir: string,
    private readonly rendersDir: string,
    private readonly capBytes: number,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async source(art: Artwork): Promise<Buffer> {
    const file = path.join(this.sourcesDir, `${key(art.id)}.img`)
    if (existsSync(file)) {
      touch(file)
      return readFileSync(file)
    }
    const r = await this.fetchFn(downloadUrl(art), {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) throw new Error(`Museum gaf ${r.status} voor ${art.title}`)
    const buf = Buffer.from(await r.arrayBuffer())
    writeFileSync(file, buf)
    this.prune()
    return buf
  }

  renderPath(id: string, mode: Mode): string {
    return path.join(this.rendersDir, `${key(id)}_${mode}.jpg`)
  }

  private files() {
    return [this.sourcesDir, this.rendersDir].flatMap((d) =>
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

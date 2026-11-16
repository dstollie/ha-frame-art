/**
 * Live search in the museum providers. Results aren't stored: you save one to My collection or
 * propose it to frame-art-collections. Each result says whether the catalogue already has it.
 */
import type { Catalogue } from "./community.js"
import { COMMUNITY_REPO, workLine } from "./community.js"
import type { Store } from "./db.js"
import type { Artwork } from "./models.js"
import { USER_AGENT, type Fetch } from "./providers/http.js"
import type { Sources } from "./sources.js"

export interface LiveResult {
  art: Artwork
  /** The catalogue work this is, when the catalogue already has it. */
  inCatalogue: string | null
  saved: boolean
  /** Pre-filled "new collection" issue with this work, when the collections bot can look it up. */
  proposeUrl: string | null
}

/** An issue in frame-art-collections with only the works filled in. */
export function proposeUrl(lines: string[]): string {
  const u = new URL(`${COMMUNITY_REPO}/issues/new`)
  u.searchParams.set("template", "new-collection.yml")
  u.searchParams.set("works", lines.join("\n"))
  return u.toString()
}

export class LiveSearch {
  /** Recent results by id, so "save" can find what was shown. */
  private recent = new Map<string, Artwork>()

  constructor(
    private readonly store: Store,
    private readonly sources: Sources,
    private readonly catalogue: Catalogue,
    private readonly fetchFn: Fetch,
  ) {}

  async search(q: string, opts: { limit?: number; timeoutMs?: number; only?: string } = {}) {
    const live = this.sources
      .list()
      .filter((s) => s.enabled && s.provider.search && (!opts.only || s.provider.id === opts.only))
    const idx = this.catalogue.matchIndex()
    return Promise.all(
      live.map(async ({ provider, apiKey }) => {
        try {
          const found = await withTimeout(
            provider.search!(q, { fetch: this.fetchFn, apiKey, limit: opts.limit ?? 12 }),
            opts.timeoutMs ?? 20_000,
          )
          const results: LiveResult[] = []
          for (const art of found) {
            this.remember(art)
            const m = await this.catalogue.match(art, idx, () => this.thumb(art))
            const line = workLine(art, null)
            results.push({
              art,
              inCatalogue: m?.id ?? null,
              saved: this.store.isSaved(art.id),
              proposeUrl: line ? proposeUrl([line]) : null,
            })
          }
          return { id: provider.id, name: provider.name, results, error: null as string | null }
        } catch (e) {
          return {
            id: provider.id,
            name: provider.name,
            results: [] as LiveResult[],
            error: e instanceof Error ? e.message : String(e),
          }
        }
      }),
    )
  }

  private remember(art: Artwork) {
    this.recent.delete(art.id)
    this.recent.set(art.id, art)
    while (this.recent.size > 1000) this.recent.delete(this.recent.keys().next().value!)
  }

  private async thumb(art: Artwork): Promise<Buffer> {
    const r = await this.fetchFn(art.thumbUrl, {
      headers: { "User-Agent": USER_AGENT, ...this.sources.get(art.source)?.imageHeaders },
      signal: AbortSignal.timeout(20_000),
    })
    if (!r.ok) throw new Error(`thumbnail ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }

  /** Puts a live result in My collection (stored, but not part of the catalogue). */
  save(id: string): Artwork | null {
    const art = this.store.get(id) ?? this.recent.get(id)
    if (!art) return null
    if (!this.store.get(id)) this.store.upsertArtworks([art])
    this.store.setSaved(id, true)
    return this.store.get(id)
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms).unref())])

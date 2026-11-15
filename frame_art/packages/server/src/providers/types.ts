import type { Artwork } from "../models.js"
import type { Fetch } from "./http.js"

export interface HarvestContext {
  fetch: Fetch
  /** IDs (`<provider>:<id>`) already in the catalogue; skip them. */
  known: Set<string>
  /** The user's API key from Settings, or null. */
  apiKey: string | null
  /** Politeness delay between requests; tests pass 0. */
  delayMs?: number
}

/**
 * An art source. A provider only knows how to list its works and where their images live;
 * the catalogue, categories, colours, rendering and TVs are shared.
 */
export interface ArtProvider {
  /** Stable id, also the prefix of artwork ids (`aic:16568`). */
  id: string
  name: string
  /** One sentence, English; shown in Settings. */
  description: string
  homepage: string
  /** Licence of what this provider lets into the catalogue, e.g. "CC0" or "Public domain". */
  licence: string
  defaultEnabled: boolean
  apiKey?: {
    required: boolean
    helpUrl: string
  }
  /**
   * "direct": the browser loads thumbnails straight from the source.
   * "proxy": the add-on fetches and caches them (sources that block browsers or need headers).
   */
  thumbnails: "direct" | "proxy"
  /** Extra headers for image downloads (e.g. AIC wants an AIC-User-Agent). */
  imageHeaders?: Record<string, string>
  /** Nightly sync: yield works that aren't in `ctx.known` yet. Omit for local sources. */
  harvest?(ctx: HarvestContext): AsyncGenerator<Artwork>
  /** URL of a source image big enough for a 3840×2160 render, without fetching 10k+ px masters. */
  downloadUrl(art: Artwork): string
}

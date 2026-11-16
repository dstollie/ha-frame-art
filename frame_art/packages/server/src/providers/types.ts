import type { Artwork } from "../models.js"
import type { Fetch } from "./http.js"

export interface SearchContext {
  fetch: Fetch
  /** The user's API key from Settings, or null. */
  apiKey: string | null
  /** At most this many results. */
  limit: number
}

/**
 * An art source. The catalogue comes from the community collections; museum providers answer
 * live searches (nothing is stored until you save a result) and know where their images live.
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
  /** Live search: open-licence works with an image for this text. Omit for local sources. */
  search?(q: string, ctx: SearchContext): Promise<Artwork[]>
  /** URL of a source image big enough for a 3840×2160 render, without fetching 10k+ px masters. */
  downloadUrl(art: Artwork): string
}

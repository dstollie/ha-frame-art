export const MODES = ["light", "dark", "blur", "fill"] as const
export type Mode = (typeof MODES)[number]

/** Provider id, e.g. "met", "aic", "mine". */
export type Source = string

export interface Artwork {
  id: string // "<source>:<source_id>"
  source: Source
  sourceId: string
  title: string
  artist: string
  nationality: string
  dateText: string
  year: number | null
  department: string
  culture: string
  medium: string
  tags: string[]
  imageUrl: string // best full-size source
  thumbUrl: string // ~600-900 px, loaded by the browser directly
  pageUrl: string
  /** "CC0", "Public domain", or a licence URL; empty when the provider decides. */
  licence: string
  /** Credit line the licence asks for (CC BY / BY-SA); empty for CC0 and public domain. */
  attribution: string
  aspect: number | null // width / height
  maxPx: number | null
  categories: string[]
  colorHex: string | null
  colorFamily: string | null
  hidden: boolean
}

export function newArtwork(a: Pick<Artwork, "id" | "source" | "sourceId" | "title"> & Partial<Artwork>): Artwork {
  return {
    artist: "",
    nationality: "",
    dateText: "",
    year: null,
    department: "",
    culture: "",
    medium: "",
    tags: [],
    imageUrl: "",
    thumbUrl: "",
    pageUrl: "",
    licence: "",
    attribution: "",
    aspect: null,
    maxPx: null,
    categories: [],
    colorHex: null,
    colorFamily: null,
    hidden: false,
    ...a,
  }
}

/** Tag on works made with generative AI. */
export const AI_TAG = "ai-generated"

export const FILL_MIN = 1.5
export const FILL_MAX = 2.1

export function fillAllowed(aspect: number | null | undefined): boolean {
  return aspect != null && aspect >= FILL_MIN && aspect <= FILL_MAX
}

export interface ArtworkDTO {
  id: string
  source: Source
  title: string
  artist: string
  date: string
  year: number | null
  medium: string
  department: string
  licence: string
  attribution: string
  /** Made with a generative AI model. */
  ai: boolean
  /** Direct image URL for the browser, or null when `thumbPath` must be used. */
  thumb: string | null
  /** API path (relative to the API base) for thumbnails the add-on serves itself. */
  thumbPath: string | null
  page: string
  aspect: number | null
  categories: string[]
  color: string | null
  colorFamily: string | null
  favourite: boolean
  /** One of the user's own uploads ("My collection"). */
  own: boolean
}

export function toDTO(a: Artwork, favourite: boolean, thumbPath: string | null = null): ArtworkDTO {
  return {
    id: a.id,
    source: a.source,
    title: a.title,
    artist: a.artist,
    date: a.dateText,
    year: a.year,
    medium: a.medium,
    department: a.department,
    licence: a.licence,
    attribution: a.attribution,
    ai: a.tags.includes(AI_TAG),
    thumb: thumbPath ? null : a.thumbUrl,
    thumbPath,
    page: a.pageUrl,
    aspect: a.aspect,
    categories: a.categories,
    color: a.colorHex,
    colorFamily: a.colorFamily,
    favourite,
    own: a.source === "mine",
  }
}

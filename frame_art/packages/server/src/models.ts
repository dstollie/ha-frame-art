export const MODES = ["light", "dark", "blur", "fill"] as const
export type Mode = (typeof MODES)[number]

export type Source = "met" | "rijks" | "cleveland"

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
    aspect: null,
    maxPx: null,
    categories: [],
    colorHex: null,
    colorFamily: null,
    hidden: false,
    ...a,
  }
}

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
  thumb: string
  page: string
  aspect: number | null
  categories: string[]
  color: string | null
  colorFamily: string | null
  fillAllowed: boolean
  favourite: boolean
}

export function toDTO(a: Artwork, favourite: boolean): ArtworkDTO {
  return {
    id: a.id,
    source: a.source,
    title: a.title,
    artist: a.artist,
    date: a.dateText,
    year: a.year,
    medium: a.medium,
    department: a.department,
    thumb: a.thumbUrl,
    page: a.pageUrl,
    aspect: a.aspect,
    categories: a.categories,
    color: a.colorHex,
    colorFamily: a.colorFamily,
    fillAllowed: fillAllowed(a.aspect),
    favourite,
  }
}

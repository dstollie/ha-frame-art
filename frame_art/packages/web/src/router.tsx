import {
  parseSearchWith,
  stringifySearchWith,
  createBrowserHistory,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"

import { Shell } from "@/components/shell"
import type { BrowseFilters, Mode, Orient } from "@/lib/api"
import { ArtworkPage } from "@/pages/artwork"
import { CollectionPage } from "@/pages/collection"
import { ExplorePage } from "@/pages/explore"
import { HistoryPage } from "@/pages/history"
import { SeriesPage } from "@/pages/series"
import { SeriesDetailPage } from "@/pages/series-detail"
import { SettingsPage } from "@/pages/settings"
import { SharePage } from "@/pages/share"

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
/** A list in the URL: an array (TanStack's JSON search) or a comma-separated string. */
const strs = (v: unknown) => {
  const list = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : typeof v === "number" ? [v] : [])
    .map(String)
    .filter(Boolean)
  return list.length ? list : undefined
}
const ORIENTS = new Set(["landscape", "portrait", "square", "all"])
const MODES = new Set(["light", "dark", "blur", "fill"])

const rootRoute = createRootRoute({ component: Shell })

const exploreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): BrowseFilters => ({
    cat: str(s.cat),
    color: str(s.color),
    q: str(s.q),
    collection: strs(s.collection),
    century: strs(s.century)?.map(Number).filter(Number.isFinite),
    artist: str(s.artist),
    orient: ORIENTS.has(String(s.orient)) ? (s.orient as Orient) : undefined,
    uhd: s.uhd === true || s.uhd === "true" || s.uhd === 1 ? true : undefined,
    ai: s.ai === "yes" || s.ai === "no" ? s.ai : undefined,
    licence: strs(s.licence),
    sort: s.sort === "new" || s.sort === "shuffle" ? s.sort : undefined,
    seed: typeof s.seed === "number" ? s.seed : undefined,
  }),
  component: function Explore() {
    return <ExplorePage filters={exploreRoute.useSearch()} />
  },
})

const artworkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/art/$id",
  validateSearch: (s: Record<string, unknown>): { mode?: Mode | undefined } => ({
    mode: MODES.has(String(s.mode)) ? (s.mode as Mode) : undefined,
  }),
  component: function Artwork() {
    const { id } = artworkRoute.useParams()
    const { mode } = artworkRoute.useSearch()
    return <ArtworkPage key={id} id={id} mode={mode} />
  },
})

const collectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collection",
  validateSearch: (s: Record<string, unknown>): { album?: string | undefined } => ({ album: str(s.album) }),
  component: function Collection() {
    return <CollectionPage album={collectionRoute.useSearch().album} />
  },
})

const seriesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/series", component: SeriesPage })
const seriesDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/series/$id",
  component: function SeriesDetail() {
    const { id } = seriesDetailRoute.useParams()
    return <SeriesDetailPage key={id} id={id} />
  },
})

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share",
  validateSearch: (s: Record<string, unknown>): { series?: string | undefined; album?: string | undefined } => ({
    series: str(s.series),
    album: str(s.album),
  }),
  component: function Share() {
    const { series, album } = shareRoute.useSearch()
    return <SharePage series={series} album={album} />
  },
})

const historyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/history", component: HistoryPage })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage })

const routeTree = rootRoute.addChildren([
  exploreRoute,
  artworkRoute,
  collectionRoute,
  seriesRoute,
  seriesDetailRoute,
  shareRoute,
  historyRoute,
  settingsRoute,
])

/** Browser history under the panel's URL inside HA; hash history on the ingress page. */
export function createAppRouter(history: "browser" | "hash", basepath: string) {
  return createRouter({
    routeTree,
    basepath,
    history: history === "hash" ? createHashHistory() : createBrowserHistory(),
    scrollRestoration: true,
    // Readable, shareable URLs: lists as "a,b", the rest as JSON values.
    stringifySearch: stringifySearchWith((v) => (Array.isArray(v) ? v.join(",") : JSON.stringify(v))),
    parseSearch: parseSearchWith((v) => {
      try {
        return JSON.parse(v)
      } catch {
        return v
      }
    }),
    defaultPreload: "intent",
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

import {
  createBrowserHistory,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"

import { Shell } from "@/components/shell"
import type { Mode } from "@/lib/api"
import { ArtworkPage } from "@/pages/artwork"
import { CollectionPage } from "@/pages/collection"
import { ExplorePage } from "@/pages/explore"
import { HistoryPage } from "@/pages/history"
import { SeriesPage } from "@/pages/series"
import { SeriesDetailPage } from "@/pages/series-detail"
import { SettingsPage } from "@/pages/settings"

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
const MODES = new Set(["light", "dark", "blur", "fill"])

const rootRoute = createRootRoute({ component: Shell })

const exploreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    cat?: string | undefined
    color?: string | undefined
    q?: string | undefined
    source?: string | undefined
    all?: boolean | undefined
  } => ({
    cat: str(s.cat),
    color: str(s.color),
    q: str(s.q),
    source: str(s.source),
    all: s.all === true || s.all === "true" ? true : undefined,
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

const historyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/history", component: HistoryPage })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage })

const routeTree = rootRoute.addChildren([
  exploreRoute,
  artworkRoute,
  collectionRoute,
  seriesRoute,
  seriesDetailRoute,
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
    defaultPreload: "intent",
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

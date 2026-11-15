import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"
import type { Mode } from "@/lib/api"
import { ArtworkPage } from "@/pages/artwork"
import { DiscoverPage } from "@/pages/discover"
import { FavouritesPage } from "@/pages/favourites"
import { HistoryPage } from "@/pages/history"
import { SettingsPage } from "@/pages/settings"

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
const MODES = new Set(["light", "dark", "blur", "fill"])

const rootRoute = createRootRoute({ component: AppShell })

const discoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): { cat?: string; color?: string; q?: string; all?: boolean } => ({
    cat: str(s.cat),
    color: str(s.color),
    q: str(s.q),
    all: s.all === true || s.all === "true" ? true : undefined,
  }),
  component: function Discover() {
    return <DiscoverPage filters={discoverRoute.useSearch()} />
  },
})

const artworkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/werk/$id",
  validateSearch: (s: Record<string, unknown>): { mode?: Mode } => ({
    mode: MODES.has(String(s.mode)) ? (s.mode as Mode) : undefined,
  }),
  component: function Artwork() {
    const { id } = artworkRoute.useParams()
    const { mode } = artworkRoute.useSearch()
    return <ArtworkPage key={id} id={id} mode={mode} />
  },
})

const favouritesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/favorieten", component: FavouritesPage })
const historyRoute = createRoute({ getParentRoute: () => rootRoute, path: "/geschiedenis", component: HistoryPage })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/instellingen", component: SettingsPage })

const routeTree = rootRoute.addChildren([discoverRoute, artworkRoute, favouritesRoute, historyRoute, settingsRoute])

/** Hash history: every view has its own URL, and nothing depends on the ingress base path. */
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultViewTransition: true,
  scrollRestoration: true,
  defaultPreload: "intent",
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

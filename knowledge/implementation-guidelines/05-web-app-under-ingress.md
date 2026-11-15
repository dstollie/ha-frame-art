# The panel (native HA) and the ingress page

## Principles

### Two hosts, one bundle
`<frame-art-panel>` runs as a custom panel inside HA (browser history under `/frame-art`, API at `/api/frame_art/api` through `hass.fetchWithAuth`) and as the ingress page (`standalone` attribute, hash history, API relative to the page). `lib/env.ts` decides; components never build URLs themselves (`apiUrl`, `api()`).

### HA's look, HA's elements
Use the wrappers in `components/ha.tsx` (`Card`, `Button`, `Switch`, `Alert`, …): they render HA's element when it's defined and a fallback styled with the same theme variables otherwise. Never hard-code colours; use the Tailwind tokens mapped to HA variables (`bg-card`, `text-text2`, `border-divider`, `text-primary`). See @knowledge/codebase/05-adr-native-panel.md.

### Language follows HA
Strings live in `lib/i18n.ts` (English, Dutch). Add a key to `en`; TypeScript forces the `nl` entry.

### Nothing absolute
HA serves the panel at `/api/hassio_ingress/<token>/`, and the token differs per install.
- Vite `base: "./"`, so assets are `./assets/…`.
- `createHashHistory()`, so routes live after `#` and the server only ever serves `index.html`.
- `hc<ApiType>(new URL("api", document.baseURI).toString())`, so API calls are relative to the page.
- Images from our own server need relative URLs too; museum thumbnails are absolute and fine.

The Playwright test "loads under the ingress prefix…" fails when a request leaves the prefix.

### Typed end to end
```ts
// ✅ types flow from the Hono route to the hook
export const useTvs = () => useQuery({ queryKey: keys.tvs, queryFn: async () => ok(await api.tvs.$get()) })
export type TvState = InferResponseType<typeof api.tvs.$get>[number]

// ❌ hand-written response interfaces in the web app
interface TvState { id: string; on: boolean }
```
Server routes must stay chained in `createApi` for inference to work, and validation errors must throw (`validate()`) rather than return.

### Every view has a URL
No modals (Dennis' rule). Detail is `#/werk/<id>?mode=dark`, filters live in search params (`validateSearch`), and a reload shows the same thing. Pairing and job progress render inline.

### Gallery feel, phone first
- Dark, warm palette (`index.css`), Fraunces for display type, Geist for UI.
- Artwork is never cropped in the grid (`object-contain` on a tinted tile).
- The grid is virtualised by row (TanStack Virtual) and pages in through `useInfiniteQuery`.
- Bottom navigation on phones, top navigation from `sm:` up.
- Motion only on interaction (view transitions, image fade-in); respect `prefers-reduced-motion`.

### shadcn/ui
Components live in `src/components/ui` (generated, excluded from lint). Add new ones with `pnpm dlx shadcn@latest add <name>` in `packages/web`; restyle through the theme variables, not by editing every component.

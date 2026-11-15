/**
 * Where the API lives and how to call it. Inside HA (custom panel) everything goes through the
 * Frame Art integration at /api/frame_art/api with the user's HA login. On the ingress page the
 * add-on is called directly, relative to the page.
 */
import { getHass } from "./hass"

export interface Env {
  mode: "panel" | "standalone"
  /** Absolute API base URL, without a trailing slash. */
  apiBase: string
  /** Router base path in panel mode, e.g. "/frame-art". */
  basepath: string
}

let env: Env = {
  mode: "standalone",
  apiBase: new URL("api", document.baseURI).toString().replace(/\/$/, ""),
  basepath: "/",
}

export function configureEnv(next: Env) {
  env = next
}

export const getEnv = () => env

/** fetch for the API: HA's fetchWithAuth in panel mode (refreshes tokens), plain fetch otherwise. */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  const hass = getHass()
  if (env.mode === "panel" && hass?.fetchWithAuth) {
    const u = new URL(url, location.origin)
    return hass.fetchWithAuth(u.pathname + u.search, init)
  }
  return fetch(url, init)
}

/** Absolute URL for an API path such as "artworks/x/thumb". */
export const apiUrl = (path: string) => `${env.apiBase}/${path.replace(/^\//, "")}`

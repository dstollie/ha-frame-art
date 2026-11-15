import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"

import { configureEnv } from "./lib/env"
import { setHass, type HassLike } from "./lib/hass"
import { setNarrow } from "./lib/narrow"
import { followParentTheme } from "./lib/standalone"
import { createAppRouter } from "./router"

/**
 * <frame-art-panel>: a Home Assistant custom panel. HA sets `hass`, `narrow`, `route` and `panel`
 * on it. Rendering happens in a shadow root, so our styles can't leak into HA and HA's theme
 * variables flow in.
 */
import css from "./index.css?inline"

class FrameArtPanel extends HTMLElement {
  private root: Root | null = null
  private urlPath = "frame-art"

  set hass(value: HassLike) {
    setHass(value)
  }

  set narrow(value: boolean) {
    setNarrow(Boolean(value))
  }

  set panel(value: { url_path?: string } | undefined) {
    if (value?.url_path) this.urlPath = value.url_path
  }

  /** Properties set before the element was defined live on the instance; re-run them through the setters. */
  private upgrade(prop: "hass" | "narrow" | "panel") {
    if (Object.prototype.hasOwnProperty.call(this, prop)) {
      const value = (this as Record<string, unknown>)[prop]
      delete (this as Record<string, unknown>)[prop]
      ;(this as Record<string, unknown>)[prop] = value
    }
  }

  connectedCallback() {
    for (const p of ["panel", "narrow", "hass"] as const) this.upgrade(p)
    if (this.root) return
    const standalone = this.hasAttribute("standalone")
    configureEnv(
      standalone
        ? { mode: "standalone", apiBase: new URL("api", document.baseURI).toString().replace(/\/$/, ""), basepath: "/" }
        : { mode: "panel", apiBase: `${location.origin}/api/frame_art/api`, basepath: `/${this.urlPath}` },
    )
    if (standalone) followParentTheme(this)

    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = css
    const mount = document.createElement("div")
    shadow.append(style, mount)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: true, retry: 1 } },
    })
    const router = createAppRouter(standalone ? "hash" : "browser", standalone ? "/" : `/${this.urlPath}`)
    this.root = createRoot(mount)
    this.root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    )
  }

  disconnectedCallback() {
    // HA keeps panels around while you navigate; only unmount when really removed.
    queueMicrotask(() => {
      if (!this.isConnected) {
        this.root?.unmount()
        this.root = null
        this.shadowRoot?.replaceChildren()
      }
    })
  }
}

if (!customElements.get("frame-art-panel")) customElements.define("frame-art-panel", FrameArtPanel)

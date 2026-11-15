/**
 * The ingress page lives in an iframe inside HA (same origin). It borrows HA's theme variables and
 * `hass` (language, dark mode) from the page around it, so it looks the same as the native panel.
 */
import { setHass, type HassLike } from "./hass"

const THEME_VARS = [
  "--primary-color",
  "--accent-color",
  "--primary-background-color",
  "--secondary-background-color",
  "--card-background-color",
  "--ha-card-background",
  "--primary-text-color",
  "--secondary-text-color",
  "--disabled-text-color",
  "--text-primary-color",
  "--divider-color",
  "--error-color",
  "--success-color",
  "--warning-color",
  "--info-color",
  "--app-header-background-color",
  "--app-header-text-color",
  "--ha-card-border-radius",
  "--ha-card-border-color",
  "--ha-card-border-width",
  "--ha-card-box-shadow",
  "--ha-font-family-body",
  "--switch-unchecked-track-color",
  "--input-fill-color",
]

const DARK: Record<string, string> = {
  "--primary-background-color": "#111111",
  "--secondary-background-color": "#202020",
  "--card-background-color": "#1c1c1c",
  "--primary-text-color": "#e1e1e1",
  "--secondary-text-color": "#9b9b9b",
  "--divider-color": "rgba(225, 225, 225, 0.12)",
  "--app-header-background-color": "#111111",
  "--app-header-text-color": "#e1e1e1",
}

function parentHa(): (Element & { hass?: HassLike }) | null {
  try {
    return window.parent !== window ? window.parent.document.querySelector("home-assistant") : null
  } catch {
    return null // not same-origin: just use defaults
  }
}

export function followParentTheme(host: HTMLElement) {
  const sync = () => {
    const ha = parentHa()
    if (ha?.hass) setHass(ha.hass)
    const style = ha ? getComputedStyle(window.parent.document.documentElement) : null
    if (style) {
      for (const v of THEME_VARS) {
        const value = style.getPropertyValue(v).trim()
        if (value) host.style.setProperty(v, value)
        else host.style.removeProperty(v)
      }
      document.body.style.background = style.getPropertyValue("--primary-background-color")
    } else {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches
      for (const [k, v] of Object.entries(DARK)) {
        if (dark) host.style.setProperty(k, v)
        else host.style.removeProperty(k)
      }
    }
  }
  sync()
  setInterval(sync, 2000)
}

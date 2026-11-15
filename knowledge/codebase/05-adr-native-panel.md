# ADR: a native HA panel via a custom integration (15 Nov 2026)

## Context

Up to 0.1.x the UI was an ingress app with its own dark "gallery" design. Dennis' feedback: it should look and feel like Home Assistant itself, with HA's own UI elements, light and dark theme following HA.

## Options

| Option | How | Look | Updates | Verdict |
|---|---|---|---|---|
| A. Ingress app, styled with HA's theme variables | iframe at `/api/hassio_ingress/<token>/`; read the parent page's CSS variables (same origin) | Close, but no HA elements (they're defined in HA's document, not the iframe), no native header, no `narrow` | Add-on only | Fallback only |
| B. Custom integration with a `panel_custom` panel (`embed_iframe: false`) | A web component in HA's own document, gets `hass`, `narrow`, `route`, `panel` | Native: HA's elements, theme, language, header and menu button | Integration via HACS + add-on | **Chosen** |
| C. Lovelace cards only | Custom cards on a dashboard | Native, but a dashboard isn't an app (no routing, no settings pages) | HACS | Rejected |

How others do it: Zigbee2MQTT, ESPHome and Music Assistant ship ingress apps with their own UI (A). Alarmo, Scheduler and HACS itself use custom panels with HA's elements (B) and have stayed working across HA releases by keeping to the stable elements.

## Decision

- **B**, with the add-on as the backend. The integration is thin: Supervisor discovery → config entry; it registers the panel and proxies `/api/frame_art/api/*` (HA login; settings admin-only), `/api/frame_art/mcp` (MCP token) and `/api/frame_art/panel.js`.
- **The add-on serves the panel module.** UI changes ship with add-on releases; the integration rarely changes.
- **HA elements with a fallback.** HA's elements aren't a public API, and many moved to Web Awesome in 2025–2026 (`ha-button`, `ha-input`, `ha-input-search`). The panel uses `ha-card`, `ha-button`, `ha-switch` and `ha-alert` when `customElements.get()` finds them, and a styled fallback (same theme variables) otherwise. Inputs and selects are our own, styled like HA's, because their element APIs change most.
- **Shadow DOM + theme variables.** All colours map to HA's variables (`--primary-color`, `--card-background-color`, `--primary-text-color`, `--divider-color`, …), so light/dark and custom themes just work. Tailwind's preflight stays inside our shadow root.
- **The ingress page stays** (option A): the same bundle in `standalone` mode, borrowing theme and `hass` from the HA page around it. It works without the integration.

## Consequences

- Two install steps (add-on + HACS integration). The README covers both; discovery makes the second nearly automatic.
- A new HA release can drop or change an element: the fallback keeps the panel working, at worst with a slightly different control.
- Keep the panel's element usage to the few listed above; check HA's frontend `src/components` before adopting another.

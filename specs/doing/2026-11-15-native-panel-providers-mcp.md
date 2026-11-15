# Native HA panel, pluggable art providers, MCP server (v0.2.0)

## Goal
Dennis' feedback on 0.1.x: (1) look like a native Home Assistant app, (2) not Dutch-only, generic art sources plus his own uploads, (3) MCP tools so an AI can upload and push art.

## Decisions
- UI: a **custom integration** (`custom_components/frame_art`, installed through HACS) registers a native sidebar panel (`panel_custom`, `embed_iframe: false`). The panel is a web component that gets `hass`, so theme (light/dark), language and the header behave natively, and it uses HA's own elements (`ha-card`, `ha-button`, `ha-switch`, `ha-icon`, …) with a styled fallback when an element isn't loaded. The panel bundle itself is served **by the add-on** (proxied by the integration), so UI changes ship with add-on releases. See knowledge/codebase/05-adr-native-panel.md.
- The integration proxies `/api/frame_art/api/*` (HA auth) and `/api/frame_art/mcp` (MCP token) to the add-on with an internal token it receives through **Supervisor discovery**.
- Providers: an `ArtProvider` interface + registry; per-source on/off and API keys stored in SQLite and edited in the panel. Defaults on: The Met, Art Institute of Chicago, Cleveland, Rijksmuseum, SMK, Wikimedia Commons. Off by default: Europeana (key; demo key fallback), Smithsonian (key). Plus "My collection" (uploads + albums).
- Categories and colours get English ids; the UI follows the HA language (English, Dutch).
- MCP: stateless streamable HTTP at `/mcp` in the add-on, token generated at first boot, shown/rotated in Settings, never logged; accepted as `Authorization: Bearer` or `?token=`.

## Steps
1. Server: provider interface + new providers (AIC, SMK, Wikimedia, Europeana, Smithsonian) with fixture tests; source settings table + API; English categories/colours + migration of stored ids.
2. Server: My collection (upload URL/base64/multipart, albums, thumbnails, delete) with tests.
3. Server: auth middleware (ingress / internal token / MCP token), Supervisor discovery, panel bundle route.
4. Server: MCP server + tools, tested through the MCP client SDK.
5. Web: panel web component (shadow DOM, HA theme vars, HA elements with fallbacks), i18n en/nl, pages incl. Collection and Settings (sources, MCP).
6. Integration: config flow (hassio discovery + manual), proxy views, panel registration; pytest.
7. CI: python lint + tests; e2e through a fake HA host page (light + dark).
8. Docs: README (install add-on + HACS integration, providers how-to, MCP clients), knowledge ADR + updates.
9. Release 0.2.0, HA backup, install integration (HACS), restart, update add-on, verify panel + logs + MCP.

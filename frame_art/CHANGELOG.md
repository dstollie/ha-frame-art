# Changelog

## 0.2.0

- **Native Home Assistant panel.** New companion integration (HACS) puts Frame Art in the sidebar as a native panel: HA's own components, theme (light and dark) and language (English, Dutch). The add-on announces itself through Supervisor discovery, so setting it up is one click. The ingress page shows the same UI.
- **Pluggable art sources.** Providers for The Met, Art Institute of Chicago, Rijksmuseum, Cleveland, SMK (Denmark), Wikimedia Commons, Europeana and the Smithsonian, each on/off in Settings, with API keys where needed. Categories are international (English ids, labels in English and Dutch); 0.1.x data is migrated.
- **My collection.** Upload your own images (files or URL), organise them in albums, show them like any other work. Rotation can pick from My collection.
- **MCP server.** AI assistants can search art, list TVs, see what's showing, upload images and put art on a TV (fill or passe-partout). Reachable through Home Assistant at `/api/frame_art/mcp` (Nabu Casa too), protected by a token you manage in Settings.
- The add-on's API now only accepts HA ingress and the integration's token.

## 0.1.2

- Fix: "Geen antwoord op verzoek" after "Zet op …" on a 2022 Frame (QE55LS03B). That firmware shows the work but doesn't confirm `select_image` and `set_artmode_status` with our request id; those confirmations are now optional (a confirming broadcast, or 4 s of silence, counts as done), and cleanup runs again. Unanswered TV events are logged.
- New: display mode per TV, **Vullen (slim bijsnijden)** (the default) or **Passe-partout** (light, dark, blur). Fill uses an attention-based crop to exactly 3840×2160 so faces and the subject stay in frame, for every aspect ratio. On a work you can choose another mode for this one time; the preview shows the real crop.

## 0.1.1

- Fix: pairing with a Frame that accepts FrameArt without handing out a token (2022 LS03B) now counts as paired. Before, the app kept showing "niet gekoppeld".
- Pairing attempts and their outcome are logged.

## 0.1.0

- First release: browse open-access paintings from The Met, the Rijksmuseum and the Cleveland Museum of Art, and send one to a Samsung The Frame with one tap (light, dark, blur or fill passe-partout).
- Pair each TV from Instellingen; tokens stay in `/data/tokens`.
- Favourites, history, a rotation category per TV, and MQTT entities (button, select, sensor, image) for HA and Node-RED.

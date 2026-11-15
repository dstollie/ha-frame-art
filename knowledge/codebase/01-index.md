# Codebase Index

Foundational knowledge about how Frame Art is put together. Load the file that matches the request.

## Available Guidelines

### Architecture
**File:** @knowledge/codebase/02-architecture.md
**Keywords:** architecture, packages, ingress, add-on, hono, rpc, sqlite, docker, ghcr, supervisor, mqtt
**When to use:** understanding how the add-on, the API, the web app, the TV client and Home Assistant fit together, or where a change belongs

### Processes
**File:** @knowledge/codebase/03-processes.md
**Keywords:** job, one tap, upload, wake, pairing, token, sync, catalogue, rotation, release, flow
**When to use:** changing what happens when someone taps "Zet op …", pairs a TV, presses the MQTT button, or when the catalogue syncs

### Data models
**File:** @knowledge/codebase/04-data-models.md
**Keywords:** database, schema, drizzle, table, artworks, uploads, history, favourites, meta, categories
**When to use:** touching `db.ts`, queries, filters or anything stored in SQLite

### ADR: native HA panel
**File:** @knowledge/codebase/05-adr-native-panel.md
**Keywords:** panel, native, integration, hacs, ingress, theme, ha-card, ha-button, web component, shadow dom
**When to use:** changing the UI shell, the integration, or deciding whether to use another HA element

### ADR: series playback
**File:** @knowledge/codebase/06-adr-series-playback.md
**Keywords:** series, playlist, slideshow, playback, player, shuffle, duration, pause, next, set_slideshow_status, re-use uploads
**When to use:** changing how series play, the player in `player.ts`, upload re-use in `jobs.ts`, or the series entities and MCP tools

## Loading Logic

1. **Primary:** Match keywords from the request
2. **Secondary:** Match the files being changed (`db.ts` → data models, `jobs.ts`/`tv.ts`/`sync.ts` → processes)
3. **Tertiary:** Load the architecture file when unsure where something belongs

## Usage

Load the matched files before changing code, and keep them accurate when the code they describe changes.

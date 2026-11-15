# AGENTS.md

You are a senior software engineer for this codebase.
**CRITICAL**: Load ONLY the specific execution instruction files relevant to the current request. Never load all of them.

## Project

Frame Art puts open-access museum art (pluggable providers: the Met, AIC, Rijksmuseum, Cleveland, SMK, Wikimedia, Europeana, Smithsonian) and the user's own uploads on a Samsung The Frame with one tap. Two parts: a Home Assistant **add-on** (TypeScript: Hono API, catalogue, sharp rendering, a TypeScript port of the Frame's art channel, an MCP server) and a **custom integration** (Python, HACS) that adds a native sidebar panel and proxies the API and MCP through HA. Runs on a Raspberry Pi 4 (aarch64); CI builds the image and publishes it to GHCR.

## What we never compromise on

### 1. Never surprise the TV

The Frame shows an "Allow" prompt for every new connection without a valid token. The add-on connects to a TV only once it has a token, or when someone presses **Koppelen** in Instellingen. No code path may open the art channel on its own to "check" a TV. Deleting from the TV only touches content IDs this add-on uploaded itself (the `uploads` table).

### 2. What you see is what lands on the wall

The preview in the web app and the 3840×2160 JPEG on the TV come from the same geometry (`packages/server/src/geometry.ts`). Change the layout there, never in one place only.

### 3. Open access only

Only CC0 or public-domain works enter the catalogue from providers. A source without a licence per work doesn't go in. Users' own uploads live in "My collection" and never leave the Pi. See @knowledge/external/museum-apis/sources.md.

### 4. Native in Home Assistant

The panel looks and behaves like HA: HA's theme variables for every colour, HA's elements where available (with fallbacks), HA's language. No custom colour palette, no custom fonts. See @knowledge/codebase/05-adr-native-panel.md.

### 5. Tokens stay secret

The internal token (integration ↔ add-on) and the MCP token live in SQLite, are never logged, and the MCP token is only shown to admins. Settings with secrets (API keys) are write-only from the panel.

### 6. Light on the Pi

The Pi also runs HA, Zigbee2MQTT and Node-RED. Keep renders bounded (sharp shrink-on-load, `concurrency(2)`), keep the cache capped, and don't add runtime processes. Node only serves the API and the static files.

## A small glossary

- **you** means the coding agent reading this file. **Dennis** owns the repo and the TVs.
- **Frame** or **TV** means a Samsung The Frame. **Art channel** means its `com.samsung.art-app` WebSocket channel.
- **Work** means an artwork in the catalogue. **Mode** or **passe-partout** means `light`, `dark`, `blur` or `fill`.
- **Job** means one tap: download, render, wake, upload and show, clean up.

## The ways to hurt yourself

1. **Pairing a real TV from a test or script.** Tests use `FakeFrame` (`@frame-art/frame-tv/fake`). Never point a test, script or dev stack at a real TV IP.
2. **Releasing the same version twice.** The Supervisor only updates when `version` in `frame_art/config.yaml` changes. A code change without a version bump never reaches the Pi, and CI refuses to overwrite a published version tag.
3. **Breaking a host.** The panel runs inside HA (`/frame-art`, API at `/api/frame_art/api`) and as the ingress page (dynamic prefix, relative paths). Build URLs only through `lib/env.ts`. Playwright covers both hosts.
4. **Secrets.** Nothing secret lives in this public repo. Pairing tokens are written to `/data/tokens` at runtime, API keys and the MCP and internal tokens live in SQLite, and MQTT credentials come from the Supervisor. No `.env` files.
5. **Opening the API.** Every `/api/*` route is behind the auth middleware (ingress proxy or internal token); `/mcp` needs the MCP token. Don't add routes outside `createApi`, and don't log request headers.

## Hit every surface

Before calling work done, walk this list and say which entries applied:

- **MCP.** If the capability is useful to an AI (search, show, upload…), expose it as a tool in `mcp.ts` and test it through the MCP client in `api.test.ts`.
- **Integration.** New API paths work through the proxy automatically; anything under `settings/` is admin-only there.
- **Languages.** New UI strings go into `lib/i18n.ts` for English and Dutch.
- **API contract.** Routes are chained in `createApi` so `ApiType` stays inferred; the web app uses `hc<ApiType>`. Validation errors throw an `HTTPException` (`validate()`), so they never widen response types.
- **Web app.** If the API gained a capability, the UI needs a way to use and see it, on desktop and on the phone.
- **HA entities.** If behaviour per TV changes, check the MQTT discovery entities (`mqtt.ts`) and `DOCS.md`.
- **Fake Frame.** If you use a new art-channel request, teach `FakeFrame` the same request and its error case.
- **Add-on options.** A new option goes into `config.yaml` (`options` and `schema`), `translations/en.yaml`, `config.ts` (zod) and `DOCS.md`.
- **Release.** A change meant for the Pi bumps `version` in `frame_art/config.yaml` (and `custom_components/frame_art/manifest.json` when the integration changed) and gets a `CHANGELOG.md` line.
- **Reverse states.** Favourite needs unfavourite, pair needs re-pair, hide needs a way back. A one-way door is a bug.

## Framework & Technology Stack

- **Runtime:** Node 22 (Alpine, aarch64), as a Home Assistant add-on with ingress
- **Backend:** Hono + `@hono/node-server`, typed RPC (`hono/client`), zod 4
- **Database:** SQLite via better-sqlite3 + drizzle-orm (schema in `db.ts`, created at boot)
- **Images:** sharp (libvips)
- **TV I/O:** `@frame-art/frame-tv`, our TypeScript port of the samsungtvws art channel (`ws`, `node:tls`, `node:net`)
- **Home Assistant:** Supervisor API (wake via `media_player.turn_on`), MQTT discovery via mqtt.js
- **Frontend:** a `<frame-art-panel>` web component: React 19 in a shadow root, Vite (library build), TanStack Router/Query/Virtual, Tailwind 4 mapped onto HA theme variables, HA elements via `components/ha.tsx`, MDI icons (`@mdi/js`)
- **Integration:** Python 3.14, Home Assistant custom component (`custom_components/frame_art`), tested with pytest-homeassistant-custom-component; uv + ruff
- **MCP:** `@modelcontextprotocol/sdk` + `@hono/mcp`, stateless streamable HTTP
- **Package Manager:** pnpm (workspace in `frame_art/`)
- **Testing:** Vitest (unit + integration), Playwright (e2e)
- **Linting/formatting:** oxlint, oxfmt; husky + nano-staged pre-commit
- **CI/CD:** GitHub Actions → `ghcr.io/dstollie/frame-art-aarch64`

## Where code lives

- `repository.yaml`: makes this repo an HA add-on repository.
- `frame_art/`: the add-on (`config.yaml`, `Dockerfile`, `DOCS.md`, `translations/`) and the pnpm workspace.
  - `packages/frame-tv`: art-channel client (`FrameArtClient`, `deviceInfo`) and `FakeFrame`. No app logic.
  - `packages/server`: Hono app (`app.ts`), catalogue sources (`sources/`), categories (`categorize.ts`), SQLite (`db.ts`), render (`render.ts`, `geometry.ts`), jobs (`jobs.ts`), sync (`sync.ts`), MQTT (`mqtt.ts`), TV wrapper (`tv.ts`). `scripts/dev-stack.ts` runs everything with fake TVs behind a fake ingress prefix.
  - `packages/web`: the panel. `panel.tsx` (custom element), `router.tsx`, API hooks in `lib/api.ts`, strings in `lib/i18n.ts`, HA element wrappers in `components/ha.tsx`, pages in `pages/`.
  - `packages/server/src/providers`: one file per art provider + `registry.ts`; `sources.ts` holds their on/off and keys; `collection.ts` is My collection; `mcp.ts` the MCP tools; `auth.ts` the tokens.
- `custom_components/frame_art/`: the HA integration (config flow, proxy views, panel registration). `hacs.json` at the root.
- `tests/`: Python tests for the integration.
- `knowledge/`: architecture, guidelines and external API notes.
- `specs/`: implementation plans (RPI). `thoughts/` is local and gitignored.

## Knowledge folder

When you need to find information about a specific package, API or service, it might be in the @knowledge/ folder, so check the files in that directory if you need specific information like an SDK specification.

When asked to add or download new knowledge, add it to the @knowledge/ folder. Knowledge about external libraries must be in the @knowledge/external/ folder.

Start with @knowledge/codebase/01-index.md for the architecture and the main flows.

## Available guidelines

### Code Review

When asked to perform a code review:
1. Load @knowledge/review-guidelines/01-index.md for detailed execution instructions
2. Follow the step-by-step process outlined in that file
3. Provide a comprehensive review focused exclusively on the applicable guidelines

### Implement a feature or change

When asked to implement a feature or change:
1. Load @knowledge/implementation-guidelines/01-index.md for detailed execution instructions
2. Find relevant guidelines based on the request and load them in context.

## Essential commands

All commands run in `frame_art/`.

- `pnpm install` installs the workspace (and the pre-commit hook).
- `pnpm dev:stack` builds the panel and starts the API with two fake Frames and about 660 real works: http://localhost:8123/frame-art/ (as an HA panel, `?theme=dark`, `?lang=nl`) and http://localhost:8123/api/hassio_ingress/dev-token-123/ (ingress page).
- `pnpm --filter web dev` starts the Vite dev server (proxies `/api` to `localhost:8099`).
- `pnpm build` builds all packages.
- `pnpm docker:build` builds the aarch64 image locally the way the Supervisor would (legacy builder).

## Testing and linting commands

- `pnpm lint:fix` and `pnpm format` fix lint and formatting issues (faster than letting the agent fix them).
- `pnpm typecheck` type-checks every package. **Always run it when finishing a task.**
- `pnpm test` runs the frame-tv protocol tests and the server unit and integration tests.
- `pnpm test:e2e` builds the web app and runs Playwright (desktop and phone) behind a fake ingress prefix.
- `pnpm check` runs everything CI runs for TypeScript: lint, format check, typecheck, tests and e2e.
- `uv run ruff check && uv run ruff format --check && uv run pytest` (repo root) for the integration.

Behaviour changes ship with tests for that behaviour. Test observable behaviour, not wiring. See @knowledge/implementation-guidelines/02-writing-tests.md.

## Taste

- Inferred types over annotations. `any` is the enemy: parse untyped JSON with small readers (see `sources/rijks.ts`).
- Comments only when the code can't be made clearer: the *why*, never the *what*.
- No barrel re-exports beyond a package's entry.
- Fix the code; don't disable a lint rule inline. If a rule doesn't fit, turn it off in `.oxlintrc.json` with a reason.
- UI copy in English and Dutch (`lib/i18n.ts`); code, docs and commits in English.
- No modals. A view gets its own URL (hash route) and survives a reload.
- No continuously repainting animations; the panel also runs on a wall tablet and a phone.

## Adding dependencies

- Add new dependencies ALWAYS via the package manager. For example: `pnpm --filter @frame-art/server add <dependency>`.
- NEVER add dependencies manually to the `package.json` file, even when instructed to do so. Always use the package manager.
- ALWAYS look up the latest version of a GitHub Action and its documentation before using it in workflows, and pin it to a commit SHA with the version in a comment.

## Commit Messages

- Follow the [Conventional Commits](https://www.conventionalcommits.org) specification for all commit messages
- Always include a scope in your commit messages
- Format: `type(scope): Description`
  ```
  # Examples:
  feat(web): Add colour filter to Ontdek
  fix(frame-tv): Accept conn_info as a JSON string
  docs(readme): Explain the release flow
  refactor(server): Move preview geometry into geometry.ts
  test(server): Cover pruning of favourite uploads
  chore(release): 0.1.1
  ```
- Types: feat, fix, docs, refactor, test, chore, ci, etc.
- Scopes: `frame-tv`, `server`, `web`, `integration`, `addon`, `ci`, `knowledge`, `readme`, `release`
- Description should be clear and concise in present tense
- Description must start with a capital letter
- Never open a PR or push a tag unless asked. Fill in `.github/PULL_REQUEST_TEMPLATE.md`.

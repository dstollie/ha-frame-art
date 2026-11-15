# Implementation Guidelines Index

This index helps determine which implementation guidelines to load based on the development request.

## Available Guidelines

### Writing tests
**File:** @knowledge/implementation-guidelines/02-writing-tests.md
**Keywords:** test, testing, vitest, playwright, e2e, fake, fixture, integration
**When to use:** any behaviour change; adding a route, a job step, an art-channel request, a source parser or a UI flow

### Talking to The Frame
**File:** @knowledge/implementation-guidelines/03-frame-art-channel.md
**Keywords:** tv, frame, samsung, art mode, upload, pairing, token, websocket, d2d, frame-tv, fakeframe
**When to use:** changing `packages/frame-tv`, `tv.ts`, or anything that sends requests to a TV

### Images and the preview
**File:** @knowledge/implementation-guidelines/04-images-and-preview.md
**Keywords:** render, sharp, matte, passe-partout, preview, geometry, jpeg, 3840, 16:9, colour, thumbnail
**When to use:** changing how works are rendered, previewed or coloured

### Web app under ingress
**File:** @knowledge/implementation-guidelines/05-web-app-under-ingress.md
**Keywords:** web, react, vite, router, route, ingress, rpc, hc, query, ui, shadcn, tailwind, phone
**When to use:** adding or changing screens, routes, API calls or styling

### Museum sources and the catalogue
**File:** @knowledge/implementation-guidelines/06-museum-sources.md
**Keywords:** museum, source, harvest, sync, catalogue, category, met, rijksmuseum, cleveland, licence, cc0
**When to use:** adding a source, changing parsers, categories or the sync

## Loading Logic

1. **Primary:** Check the development request for keywords
2. **Secondary:** Analyze which packages the change touches (`frame-tv` → 03, `render.ts`/`geometry.ts` → 04, `web` → 05, `sources/`/`sync.ts`/`categorize.ts` → 06)
3. **Tertiary:** Always add 02 when the change alters behaviour

## Usage

When implementing new features, load guidelines based on keyword matching:
1. Match keywords from the implementation request against the available guidelines
2. Load the relevant guideline files for the matched categories
3. Follow the specific implementation patterns outlined in each guideline

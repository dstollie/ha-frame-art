# Writing tests

## Overview

Three layers, each proving something the others can't:

| Layer | Where | Proves |
|---|---|---|
| Protocol | `packages/frame-tv/test` | Our client speaks the art channel correctly against `FakeFrame`: token, Weigeren, timeouts, plain and TLS D2D uploads, error codes, dropped connections. |
| Unit + integration | `packages/server/test` | Parsers on real API fixtures, categories, render output (size, matte pixels, budget), SQLite queries, and **end to end** through `testClient(createApi())` → real `FrameTV` → `FakeFrame`, with a fake museum and fake HA. |
| E2E | `packages/web/e2e` | The real build behind a fake ingress prefix: every request stays under the prefix, deep links survive a reload, pairing and one tap work on desktop and phone. |

## Principles

### Fake the edges, not the middle
```ts
// ✅ Real FrameTV + real protocol, fake TV
frame = await new FakeFrame({ powerState: "standby" }).start()
const tv = new FrameTV({ ...cfg, wsPort: frame.wsPort, restPort: frame.restPort }, tokensDir)

// ❌ Mocking FrameTV.show() proves nothing about the TV conversation
vi.spyOn(tv, "show").mockResolvedValue("MY_F0001")
```
Fakes exist for the TV (`FakeFrame`), the museums (a `fetchFn` that serves generated JPEGs) and HA (`HomeAssistant` interface). Everything between them runs for real, sharp included.

### Assert what a person would notice
Assert the uploaded JPEG is exactly 3840×2160 and under 4 MB, that `current` on the TV is the new content ID, that the matte colour sits at the corners. Not that a function was called.

### Every new art request gets a fake twin
When `FrameArtClient` learns a request, `FakeFrame` learns it too, including its error answer. Otherwise the e2e tests silently stop covering the real path.

### Fixtures are real API responses
`packages/server/test/fixtures` holds actual responses from the Met, the Rijksmuseum and Cleveland. When a museum changes its format, add a new fixture next to the old one instead of editing it.

### Playwright: shared server, isolated data
Both Playwright projects (desktop, phone) share one dev stack. Pick different works per project and make tests idempotent (pairing helper checks state first). Wait for responses (`waitForResponse`) before navigating away from an optimistic update.

## Common pitfalls

- **Reading a heading during a view transition** matches the old page. Scope locators (`aside h1`) or wait for the URL first.
- **`getByRole(..., { name: "Koppelen" })` also matches "Opnieuw koppelen".** Use `exact: true`.
- **Timing-based waits.** Use `runner.idle()` in server tests instead of sleeps.

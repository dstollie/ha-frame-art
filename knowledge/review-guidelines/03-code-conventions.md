# Code conventions and project invariants

## Blocking

- ❌ Any code path that opens the art channel without a token outside `pair()`.
- ❌ Deleting content IDs on a TV that aren't in our `uploads` table.
- ❌ Absolute asset or API paths in the web app (`/api/…`, `/assets/…`).
- ❌ Layout numbers in `render.ts` or `frame-preview.tsx` instead of `geometry.ts`.
- ❌ A change meant for the Pi without a `version` bump in `frame_art/config.yaml`.
- ❌ Secrets, tokens, `.env` files or local paths committed (this repo is public).
- ❌ `any` in `src/` (tests may use it), or inline lint disables.
- ❌ A modal dialog. Views need their own hash route.

## Should fix

- A new art request without a `FakeFrame` counterpart and a test.
- A new add-on option missing from `config.yaml` schema, `translations/en.yaml`, `config.ts` or `DOCS.md`.
- Response types written by hand in the web app instead of `InferResponseType`.
- Validation through plain `zValidator` (widens RPC types) instead of `validate()`.
- Comments that explain *what* instead of *why*.
- Unpinned GitHub Actions (use a SHA with a version comment).

## Style

- oxfmt decides formatting (no semicolons, 120 columns); oxlint must pass with `--deny-warnings`.
- Conventional Commits with a scope, description starting with a capital letter.
- UI copy in Dutch; identifiers, docs and commits in English.

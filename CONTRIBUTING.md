# Contributing to Frame Art

Thanks for helping. There are two places to contribute:

- **Art collections** live in [frame-art-collections](https://github.com/dstollie/frame-art-collections). That is the easiest way in: a form, an AI agent skill or a pull request, and no code. Start with a [good first collection](https://github.com/dstollie/frame-art-collections/labels/good%20first%20collection).
- **The app, the panel and the integration** live here.

## Bugs and ideas

Open an issue with the [bug](https://github.com/dstollie/ha-frame-art/issues/new?template=bug.yml) or [feature](https://github.com/dstollie/ha-frame-art/issues/new?template=feature.yml) form. For a bug, the app version, your Frame model and the app log help most.

## Code

```sh
cd frame_art
pnpm install
pnpm dev:stack   # the panel, the API and two fake Frames, no TV needed
pnpm check       # lint, format, typecheck, tests, end-to-end
cd .. && uv run ruff check && uv run pytest   # the integration
```

- Read [AGENTS.md](AGENTS.md) and [knowledge/](knowledge/codebase/01-index.md) first: they describe the architecture and the conventions, for people and AI agents alike.
- Small pull requests, [Conventional Commits](https://www.conventionalcommits.org) with a scope (`feat(web): …`, `fix(server): …`).
- Non-trivial changes come with tests. The fake Frame (`packages/frame-tv`) lets you test TV behaviour without a TV.
- A new museum is one provider file; see [Add a museum](README.md#add-a-museum).
- CI runs every check, plus the HACS action and hassfest. They have to be green.

## Brand

Logos, colours and type are in [docs/brand](docs/brand/README.md). Please don't change the mark in a feature PR.

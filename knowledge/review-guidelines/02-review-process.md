# Review process

1. **Read the diff by package.** Note which of `frame-tv`, `server`, `web`, `config.yaml`/`Dockerfile`, CI and docs changed.
2. **Load the matching implementation guidelines** via @knowledge/implementation-guidelines/01-index.md.
3. **Walk "Hit every surface" in `AGENTS.md`** and check each entry that applies (API contract, web, HA entities, FakeFrame, options, release, reverse states).
4. **Check the invariants** in @knowledge/review-guidelines/03-code-conventions.md.
5. **Check the tests.** Behaviour changes need a test at the right layer (protocol, server e2e, Playwright). Tests assert outcomes, not calls.
6. **Run the gate** if you can: `cd frame_art && pnpm check`.
7. **Report** findings most severe first: file:line, what breaks, and for whom (the TV, the Pi, the phone, a future release).

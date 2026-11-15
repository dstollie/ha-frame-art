# Museum sources and the catalogue

## Principles

### A source must earn its place
Only add a source that: (1) has a per-work open licence we can filter on (CC0 or public domain), (2) serves images of at least about 3000 px to a server without a browser challenge, and (3) has stable IDs. See @knowledge/external/museum-apis/sources.md for the comparison, including why the Art Institute of Chicago, Europeana and Wikimedia are out.

### Pure parser, thin harvester
```ts
// ✅ parseObject(raw: unknown): Artwork | null  ← unit-tested on a real fixture
// ✅ harvest(fetchFn, known, opts)              ← paging, skipping known IDs, politeness delay

// ❌ parsing inside the fetch loop, untestable without the network
```
Parsers read untyped JSON through small readers (`node`, `list`, `text` in `rijks.ts`) instead of `any`.

### Never trust a missing value to overwrite a known one
Upserts keep an existing `aspect`/`max_px` when the new value is null. Colour enrichment fills `aspect` from the thumbnail only when it's still missing.

### Categories are ours
`categorize.ts` derives categories from nationality, year, department, culture, medium, tags and title words, with word boundaries (so "seat" isn't "sea"). Add a case to `categorize.test.ts` for every rule you add or fix.

### Be polite
Default delays: Met 120 ms per object, Rijksmuseum 250 ms, Cleveland 500 ms per page, colours 1 s. Send the `USER_AGENT`. Incremental syncs skip known IDs, so only the first sync is long (about 40 min).

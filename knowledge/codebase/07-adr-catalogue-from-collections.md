# ADR: the catalogue comes from frame-art-collections; museums are live search (16 Nov 2026)

## Context

Up to 0.3.x the add-on harvested museum APIs every night (Met, AIC, Rijksmuseum, Cleveland, SMK, Wikimedia, Europeana, Smithsonian) into one catalogue of about 5,400 works. Quality varied per museum, categories were guessed from titles, and the same painting came in through several sources. [frame-art-collections](https://github.com/dstollie/frame-art-collections) now publishes curated, openly licensed collections as static JSON (an index and a manifest per collection, schema v1) that anyone can propose to through a GitHub issue.

## Decision

- **The catalogue is the collections.** `Catalogue.sync()` (nightly and "Refresh now") reads `index.json` and every manifest, stores each work once as `community:<item id>` however many collections hold it (`community_items` links collections to works, `community_raw` keeps the item as published), and removes works that left every collection unless something still uses them. A collection can be switched off in Settings; Explore only shows works in an enabled collection.
- **Museums are live search.** Each provider has `search(q)` instead of `harvest()`. Results aren't stored. One tap saves a result to My collection (`saved` table; My collection = own uploads + saved works), or proposes it to the collections repository (a pre-filled issue with the work's line).
- **Duplicates only matter for live search.** A result shows "already in your catalogue" when it is the same work: the same id at the source (`smk:KMS1` = `smk-KMS1`, `met:N` = `met-N`), the same Wikimedia Commons file, or the same title, artist and year confirmed by a thumbnail dHash (at most 10 of 64 bits differ). Wikidata QIDs would be the next key once a provider returns them.
- **Moving from the old catalogue** runs once, after the first sync: old works that nothing uses are deleted; used ones (favourites, albums, series, history, uploads on a TV, a playing series) are mapped onto the matching community work with the same three checks and every reference is rewritten; used ones without a match stay. My collection is never touched.
- **Search** is SQLite FTS5 with the trigram tokenizer (`remove_diacritics`) over title, artist and an "extra" column (tags, date, source, collection names). A query first needs every word as a substring; when nothing matches, a typo-tolerant query (any trigram of each word) ranks close matches with bm25 and the UI says so.
- **Facets** (collection, century, artist, colour, shape, 4K, AI, licence) are counted in SQL with the same filters, each facet without its own filter, so you can switch between values.

## Consequences

- No museum API is called at night any more; the add-on only fetches ~40 small JSON files.
- Curating happens in the collections repository, in public, with a bot that checks licences. The add-on's quality is the repository's.
- CC BY and CC BY-SA works can now enter the catalogue (the repository requires an attribution); the panel shows the credit line on the work.
- Live search depends on museum APIs being up; a museum that fails shows its error and the others still answer.

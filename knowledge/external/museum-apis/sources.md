# Museum APIs (tested 15 Nov 2026)

| Source | Licence | Key | Search | Images | Status |
|---|---|---|---|---|---|
| **The Met** | CC0 when `isPublicDomain` | none | `/public/collection/v1.1/search` (offset/limit ≤ 500; `/v1/search` retired 1 Oct 2026), IDs only, then `/v1/objects/{id}` | `primaryImage` original JPEG (3000–6000 px), `primaryImageSmall` for the grid | used |
| **Rijksmuseum** | CC0 / Public Domain Mark per image | none (new Linked Art APIs) | `data.rijksmuseum.nl/search/collection?type=painting&imageAvailable=true`, Linked Art IDs, `pageToken` paging, then resolve each ID with `Accept: application/ld+json` | IIIF Image API 3 on `iiif.micr.io`, `full/max` or `full/!w,h` | used |
| **Cleveland Museum of Art** | `share_license_status: CC0` | none | `openaccess-api.clevelandart.org/api/artworks/?type=Painting&cc0=1&has_image=1&limit=500&skip=…`, everything inline | `print` JPEG about 3400 px, `full` TIFF up to 14k (too heavy for the Pi), `web` about 900 px | used |
| Art Institute of Chicago | CC0 | none | excellent (style, colour) | IIIF on `www.artic.edu` returns a Cloudflare challenge (403) to servers | rejected |
| National Gallery of Art | CC0 | none | no search API; CSV dump on GitHub + IIIF | good | later, as an offline catalogue |
| Europeana | mixed per record | required | rich facets | quality varies | rejected |
| Wikimedia Commons | per file | none | MediaWiki + Wikidata | very large | rejected as main source (messy metadata) |

## Field notes

- **Met measurements:** use the `Overall` (or `Image`/`Sheet`) element for the aspect, not `Framed`.
- **Met departments:** 11 European Paintings, 1 American Wing (`medium=Paintings`), 21 Modern Art (mostly not public domain), 6 Asian Art (`geoLocation=Japan&q=woodblock`).
- **Rijksmuseum:** the image and its licence sit under `subject_of[].digitally_carried_by[]`; titles under `identified_by[type=Name]` with an AAT language (`300388256` Dutch, `300388277` English); height/width dimensions are classified `https://id.rijksmuseum.nl/22011` / `22012`.
- **Cleveland:** `creators[0].description` is "Name (Nationality, dates)".

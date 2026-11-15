# Data models

SQLite at `/data/frame_art.sqlite`, defined with drizzle in `packages/server/src/db.ts`. Tables are created at boot (`CREATE TABLE IF NOT EXISTS`); there are no migrations yet. When a column changes, add an idempotent `ALTER TABLE` next to the DDL.

```mermaid
erDiagram
  artworks {
    text id PK "source:source_id"
    text source "met | rijks | cleveland"
    text title
    text artist
    integer year
    text image_url "full-size source"
    text thumb_url "browser loads it directly"
    real aspect "width / height"
    text categories ",a,b, (LIKE '%,a,%')"
    text color_hex
    text color_family "rood|goud|bruin|groen|blauw|donker|licht|onbekend"
    integer hidden
    text search "normalized title+artist+date"
  }
  favourites {
    text artwork_id PK
    real added_at
  }
  uploads {
    text tv PK
    text content_id PK "MY_Fxxxx on the TV"
    text artwork_id
    integer seq "insert order for pruning"
  }
  history {
    integer id PK
    text tv
    text artwork_id
    text mode
    real shown_at
  }
  meta {
    text key PK "last_sync, category:<tv>"
    text value
  }
  artworks ||--o| favourites : "is"
  artworks ||--o{ uploads : "uploaded as"
  artworks ||--o{ history : "shown"
```

## Rules

- **Upsert never wipes knowledge:** `aspect` and `max_px` use `COALESCE(excluded, existing)`.
- **"Liggend" means 1.2 ≤ aspect ≤ 2.8.** Wider (handscrolls) and narrower (portrait) works stay browsable with the switch off.
- **Ordering** of the browse grid is a per-day seeded shuffle (`rowid * seed % 1000003`), so paging is stable within a day and the gallery feels fresh tomorrow.
- **Pruning** uses `seq`, not timestamps: several uploads within one second must still keep their order.

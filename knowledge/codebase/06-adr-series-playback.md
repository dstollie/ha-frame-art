# ADR: series play from the add-on, with the TV as a cache (15 Nov 2026)

## Context

A **series** is an ordered list of works (from single works, an album, My collection or search results) that plays on one or more Frames: a duration per series, an optional duration per work, shuffle, and pause, next and stop. Dennis wants to see what's playing now and what comes next, control it from the panel, from HA entities and over MCP, and keep the TV's storage tidy.

The Frame has its own slideshow. The art channel exposes it as `set_slideshow_status` (and the older `set_auto_rotation_status`) with `value` (minutes or `"off"`), `category_id` (`MY-C0002` my pictures, `MY-C0004` favourites, `MY-C0008` store) and `type` (`slideshow` or `shuffleslideshow`); see samsungtvws `art.py`.

## Options

| Option | How | Fits | Verdict |
|---|---|---|---|
| A. Native slideshow | Upload every work of the series, then `set_slideshow_status` on "my pictures" | Rotates a whole **category**: every photo on the TV, not one series. One duration for all; the TV's menu offers fixed steps. No per-work duration, no "now/next", no state we can read back reliably on 2022 firmware (acks are optional there). Two series on two TVs work, but a work added later needs a new upload anyway | Rejected as the engine |
| B. Add-on drives it, uploads every step | A scheduler in the add-on runs a normal job (render, upload, select) each step | Everything the feature needs; each step costs a 1–3 MB upload over Wi-Fi | Works, wasteful |
| C. **Add-on drives it, the TV caches** | As B, but a work already on that TV in that mode is only *selected* (`select_image`, a few hundred ms); it's uploaded only when missing. Cleanup keeps the newest uploads, so a series that loops stays on the TV | Everything from B, steps are near-instant once the series has played once | **Chosen** |

C is the hybrid: the add-on owns the schedule and the state; the TV owns the bytes.

## Decision

- **Scheduler in the add-on** (`player.ts`): per TV a playback (`series`, `order`, `index`, `status`, `nextAt`), stored in SQLite `meta` so it survives a restart. A single timer wakes at the earliest `nextAt`. No extra process.
- **Order:** the series order, or a shuffled order drawn when playback starts and redrawn at every wrap. Editing a playing series is safe: removed works drop out of the order, added ones join at the end.
- **Durations:** the work's own duration wins, then the series duration. Minimum 1 minute.
- **Reuse uploads:** `uploads` gets a `mode` column. A job looks for an upload of the same work in the same mode on that TV and selects it; if the TV says no (deleted on the TV), it uploads again. This also speeds up "Zet op TV" for works shown before.
- **The TV is off or showing TV:** "play" wakes the TV and switches Art Mode on (an explicit tap, like "Zet op TV"). Later steps never do: they check `get_artmode_status` first and only select a work when the TV is already in Art Mode (no `set_artmode_status`); otherwise they retry a minute later. A TV showing TV still reports `PowerState: on` over REST, so "on" alone is not enough (0.4.0 switched a TV that was showing TV to Art Mode; fixed in 0.4.1). The MQTT "new artwork" button, which automations press, follows the same rule.
- **Native slideshow:** not touched. If someone enables it on the TV, both rotate; DOCS.md says so.
- **Surfaces:** REST (`/series`, `/tvs/:tv/playback`), the panel (Series page and `/series/:id`), MQTT (per TV a `select` "Serie" plus buttons next, pause/resume, stop; per series a sensor with count, duration and cover), MCP (series CRUD, `play_series`, `control_playback`).

## Consequences

- A step costs one `select_image` once a series has played; first plays upload like any job.
- `keep_uploads` now also bounds how much of a long series stays cached on the TV. A series longer than `keep_uploads` uploads again on every loop; DOCS.md recommends raising it for long series.
- The add-on must run for a series to advance. That's already true for rotation and HA entities.

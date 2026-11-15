# Frame Art

Open-access museum art and your own photos on a Samsung The Frame, with one tap.

> Install the **Frame Art integration** too (HACS → ⋮ → Custom repositories → `https://github.com/dstollie/ha-frame-art`, type _Integration_, then restart HA). It adds the native sidebar panel and the MCP endpoint. Once this add-on runs, HA shows **Frame Art discovered** under Devices & services: press _Configure_. Without the integration, use **Open Web UI**.

## Using it

- **Explore:** public-domain paintings from the sources you enabled, by category, colour, source or search. **Surprise me** picks one at random.
- **A work:** the preview shows how it will look on the Frame. **Fill (smart crop)** fills the screen and keeps the subject in view; **Passe-partout** (light, dark or blur) shows the whole work. Each TV has a default (Settings); on a work you can choose differently for this one time. Then **Show on …**.
- **My collection:** upload images or add them from a URL, and organise them in albums.
- **Series:** on a work, **Add to series** or **New series**; or make one from search results or an album. The **Series** tab lists them with cover, count and duration. On a series: drag (or the arrows) to reorder, set the time per work for the whole series or per work, turn shuffle on, and **Play on …** one or more TVs. You see what's on now and what comes next, with pause, next and stop. Playing something else on a TV pauses the series there.
- **History**, favourites, and a rotation category per TV.

## Pairing (once per TV)

1. Switch the TV on with a normal picture and stand next to it.
2. Settings → **Pair** for that TV.
3. On the TV, choose **Allow** for _FrameArt_. You have a minute.

The add-on never connects to a TV that hasn't been paired, so it can't pop up prompts by itself.

## Options

| Option                                    | Meaning                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tvs`                                     | Per Frame: `name` (also the id), `host` (IP) and optionally `wake_entity`, the `media_player` that switches it on (SamsungTV Smart).                                            |
| `default_mode`                            | Passe-partout style when a TV is set to passe-partout and nothing else is chosen.                                                                                               |
| `keep_uploads` / `keep_favourite_uploads` | How many of its own uploads stay on each TV. Works still on the TV are selected instead of uploaded again, so raise `keep_uploads` to at least the length of a series you loop. |
| `cache_mb`                                | Disk cache for downloads, thumbnails and renders. My collection isn't part of it.                                                                                               |
| `sync_hour` / `sync_on_start`             | Nightly catalogue refresh.                                                                                                                                                      |
| `mqtt`                                    | HA entities through MQTT discovery (needs Mosquitto).                                                                                                                           |

Art sources, API keys and the MCP token are managed in the panel under **Settings**, not here.

## Home Assistant entities

With MQTT, each TV gets a device **Frame Art <name>**: `button.frame_art_<tv>_nieuw` (a new work from the rotation), `select.frame_art_<tv>_rotatie`, `sensor.frame_art_<tv>_schilderij` and `image.frame_art_<tv>_schilderij`.

Series: per TV `select.frame_art_<tv>_serie` (pick a series to play it, `—` stops it; attributes: status, current, next, next_at) and the buttons `button.frame_art_<tv>_series_next`, `…_series_pause` (pause/resume) and `…_series_stop`. Each series is also a sensor on the device **Frame Art Series** (state: number of works; attributes: duration and total in minutes, shuffle, playing_on, cover).

A series only advances while the add-on runs. It never switches a TV on by itself: when the TV is off, it waits and continues once the TV is on. Pressing **Play** does switch it on, like **Show on**. If you also turn on the TV's own slideshow, both will change the picture.

## AI assistants (MCP)

Settings → **AI assistants (MCP)** shows the endpoint (`https://<your-ha>/api/frame_art/mcp`, Nabu Casa works too) and the token. For Claude Code:

```
claude mcp add --transport http frame-art https://<your-ha>/api/frame_art/mcp --header "Authorization: Bearer <token>"
```

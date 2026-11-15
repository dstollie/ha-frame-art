# Frame Art

Open-access paintings (The Met, the Rijksmuseum and the Cleveland Museum of Art, all CC0) on your Samsung The Frame, with one tap.

## Using it

- Open **Frame Art** in the sidebar. **Ontdek** shows the catalogue by category, colour and search; **Verras me** picks something at random.
- On a work, the preview shows how it will look. **Vullen (slim bijsnijden)** fills the whole screen with a crop that keeps the subject in frame; **Passe-partout** (licht, donker, blur) shows the whole work. Each TV has its own default under **Instellingen → Weergave**; on a work you can choose another mode for this one time. Then tap **Zet op woonkamer** or **Zet op slaapkamer**. The add-on downloads the work, renders it to 3840×2160, switches the TV on if needed, uploads it, shows it and switches Art Mode on.
- **Favorieten** and **Geschiedenis** have their own page. Under **Instellingen** you pair each TV and choose the rotation category.

## Pairing (once per TV)

The add-on talks to the Frame's art channel under its own name, **FrameArt**. That needs its own approval on the TV, separate from SamsungTV Smart:

1. Switch the TV on with a normal picture and stand next to it.
2. Under **Instellingen**, press **Koppelen** for that TV.
3. On the TV, choose **Toestaan**. You have a minute.

The token goes into `/data/tokens/<tv>.token` (the add-on's own storage, included in HA backups). The add-on never connects to a TV that hasn't been paired, so it can never pop up a prompt on its own.

## Options

| Option                                    | Meaning                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tvs`                                     | Per Frame: `name` (also the id, e.g. `woonkamer`), `host` (IP) and optionally `wake_entity`, the `media_player` that switches it on (SamsungTV Smart). |
| `default_mode`                            | `light`, `dark`, `blur` or `fill`, for rotation and when nothing is chosen.                                                                            |
| `keep_uploads` / `keep_favourite_uploads` | How many of its own uploads stay on each TV; older ones are deleted.                                                                                   |
| `cache_mb`                                | Disk cache for downloads and renders (LRU).                                                                                                            |
| `sync_hour` / `sync_on_start`             | Nightly catalogue refresh.                                                                                                                             |
| `mqtt`                                    | HA entities through MQTT discovery (needs the Mosquitto add-on).                                                                                       |

## Home Assistant and Node-RED

With MQTT, each TV gets one device, **Frame Art <name>**, with:

- `button.frame_art_<tv>_nieuw`: a new work from the rotation category,
- `select.frame_art_<tv>_rotatie`: the rotation category (Alles, Favorieten, Impressionisme, …),
- `sensor.frame_art_<tv>_schilderij`: the current title, with artist, year and museum as attributes,
- `image.frame_art_<tv>_schilderij`: a thumbnail of what's showing now.

For a daily rotation, let Node-RED press `button.frame_art_<tv>_nieuw`.

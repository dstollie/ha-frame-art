# Home Assistant add-on: ingress, Supervisor and MQTT

## config.yaml essentials used here

- `ingress: true`, `ingress_port: 8099`, `panel_icon`, `panel_title`: sidebar panel, proxied by HA at `/api/hassio_ingress/<token>/`. The app must work under that prefix (relative paths only).
- `image: ghcr.io/dstollie/frame-art-{arch}`: the Supervisor pulls `<image>:<version>` instead of building the Dockerfile. `version` must exist as a tag.
- `homeassistant_api: true`: lets the add-on call `http://supervisor/core/api/...` with `SUPERVISOR_TOKEN` (we use `services/media_player/turn_on`).
- `services: [mqtt:want]`: `GET http://supervisor/services/mqtt` returns host, port, username and password for the Mosquitto add-on.
- `watchdog`: the Supervisor restarts the add-on when `/api/config` stops answering.
- `options` + `schema`: written to `/data/options.json`; `translations/en.yaml` labels them in the UI.

## MQTT discovery

Discovery topics `homeassistant/<component>/<node>/<object>/config` with `retain`. Since HA 2025.10, use `default_entity_id` (full entity ID) instead of the deprecated `object_id`. The `image` component takes raw JPEG bytes on `image_topic` with `content_type: image/jpeg`. An `availability_topic` with a last-will `offline` marks the entities unavailable when the add-on stops.

## Store repositories

An add-on repository is a git repo with `repository.yaml` at its root and one folder per add-on. Add it in HA under Settings → Add-ons → Add-on Store → ⋮ → Repositories, or through `POST /store/repositories {"repository": "<url>"}` on the Supervisor API.

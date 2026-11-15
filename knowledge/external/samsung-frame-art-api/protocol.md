# Samsung The Frame: art channel protocol

Source: samsungtvws 3.0.7 (`samsungtvws/connection.py`, `samsungtvws/art/art.py`), ported to `packages/frame-tv/src/index.ts`.

## Ports

| Port | What |
|---|---|
| 8001 | HTTP REST: `GET /api/v2/` gives `device.PowerState` (`on`/`standby`), `FrameTVSupport`, `modelName` |
| 8002 | WSS (self-signed certificate) for channels, including `com.samsung.art-app` |
| dynamic | D2D upload socket announced in `ready_to_use.conn_info` (TCP, or TLS when `secured: true`) |

## Connect

```
wss://<tv>:8002/api/v2/channels/com.samsung.art-app?name=<base64(client name)>&token=<token>
```
1. The TV sends `ms.channel.connect`. On first pairing its `data.token` holds the token to persist (bound to the client name).
2. Then `ms.channel.ready`. Only after this can requests be sent.
3. `ms.channel.unauthorized` means the user chose Weigeren (or the token is invalid).
4. Other events (`ms.channel.clientConnect`, `ms.remote.touchEnable`, …) can arrive at any time; ignore them.

## Request / response

Send:
```json
{"method":"ms.channel.emit","params":{"event":"art_app_request","to":"host",
 "data":"{\"request\":\"select_image\",\"content_id\":\"MY_F0003\",\"show\":true,\"id\":\"<uuid>\",\"request_id\":\"<uuid>\"}"}}
```
Receive `{"event":"d2d_service_message","data":"<json string>"}`, where the inner JSON has `event` (the sub-event), `request_id`/`id`, and on failure `event:"error"`, `error_code`, `request_data`.

| Request | Params | Answer |
|---|---|---|
| `api_version` (new) / `get_api_version` (old) | none | `version` |
| `send_image` | `file_type`, `file_size`, `image_date` (`YYYY:MM:DD HH:MM:SS`), `matte_id`, `portrait_matte_id`, `conn_info{d2d_mode:"socket", connection_id, id}` | `ready_to_use` with `conn_info{ip, port, key, secured}` |
| D2D socket | 4-byte BE header length + header JSON `{num:0,total:1,fileLength,fileName,fileType,secKey:key,version:"0.0.1"}` + bytes | `image_added` with `content_id` (new request ID!) |
| `select_image` | `content_id`, `category_id: null`, `show` | `select_image` |
| `set_artmode_status` | `value: "on"|"off"` | `set_artmode_status` |
| `get_artmode_status` | none | `value` |
| `delete_image_list` | `content_id_list: [{content_id}]` | `content_id_list` (JSON string) echoing what was deleted |
| `get_content_list` | `category: "MY-C0002"` | `content_list` (My Photos) |
| `get_matte_list`, `change_matte`, `get_photo_filter_list`, `set_photo_filter` | | not used: we draw our own matte |

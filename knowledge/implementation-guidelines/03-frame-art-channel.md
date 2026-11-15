# Talking to The Frame

## Overview

`@frame-art/frame-tv` is a TypeScript port of samsungtvws 3.0.7 (`connection.py`, `art/art.py`). Protocol details: @knowledge/external/samsung-frame-art-api/protocol.md. Model quirks: @knowledge/external/samsung-frame-art-api/firmware-quirks.md.

## Principles

### 🔐 No token, no connection
`FrameTV.withClient` throws when there is no token file, unless `pair()` is running. That is the only thing standing between a stray request and an "Allow?" prompt on Dennis' TV. Keep it that way.

### One connection per action, one action at a time
```ts
// ✅ show(): connect, upload, select, Art Mode, close, inside serial()
show(jpeg) { return this.serial(() => this.withClient(async (c) => { … })) }

// ❌ Long-lived connection shared by jobs and status polling
```
The TV handles one art client poorly and parallel ones worse. Status checks use REST on :8001 (`deviceInfo`), never the art channel.

### Correlate by request ID, except for `image_added`
Every request carries `id` and `request_id` (the same UUID); answers are matched on it. The `image_added` event after a D2D upload comes with a **new** ID, so the upload waits for any `image_added`, and registers that waiter *before* sending the bytes.

### Be liberal in what you parse
`conn_info` and `content_id_list` arrive as JSON strings on some firmware and as objects on others (`parseMaybeJson`). Old firmware sends JSON followed by binary in one frame (`parseFrame`).

### Errors name the request
A d2d `event: "error"` becomes ``FrameError(`select_image` mislukte met foutcode -11)``, so the job shows something a human can act on.

## Common pitfalls

- **Switching Art Mode on before `select_image`** shows the previous work for a moment. Order: upload → select → Art Mode.
- **Waking takes two steps.** REST answers before the art channel is ready, so wait about 3 s after `PowerState` turns `on`.
- **Matte IDs differ per model.** We upload with `matte_id: "none"` and draw our own passe-partout, so both TVs look the same.

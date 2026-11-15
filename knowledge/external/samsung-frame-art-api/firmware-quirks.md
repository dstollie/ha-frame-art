# The Frame: model and firmware quirks

Our TVs: QE55LS03B (2022, living room, wired, 192.168.1.151) and QE32LS03C (2023, bedroom, 192.168.1.152).

- **2022 (LS03B):** the first 2022 firmware removed the art WebSocket API, and a later update restored it. Check `api_version` while pairing; if it fails, update the TV first. (Samsung developer forum, 2023.)
- **Upload path:** 2022+ uses the D2D socket. The 0.97 API (older firmware) sends the image as one binary WebSocket frame; not implemented here.
- **Matte:** on 2022+ the TV forces a matte on your own uploads unless the image is exactly 16:9. Hence: always 3840×2160 with `matte_id: "none"`.
- **Size:** Samsung documents a 5 MB limit for app uploads; we stay ≤ 4 MB.
- **Storage:** "My Photos" shares internal storage (a few GB). We keep 20 of our own uploads per TV (50 for favourites).
- **Power:** a short power press toggles TV ↔ Art Mode; a long press (or HA `turn_off` through SamsungTV Smart) is fully off. From fully off only Wake-on-LAN helps, which is SamsungTV Smart's `media_player.turn_on` (our `wake_entity`).
- **Tokens:** per client name. SamsungTV Smart (HA) and Frame Art each have their own; pairing one doesn't pair the other.

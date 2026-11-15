# Images and the preview

## Principles

### One geometry, two renderers
`geometry.ts` (`LAYOUT`, `artBox`, `bevelWidth`) is the single source of truth. `render.ts` (sharp) draws it in pixels; `frame-preview.tsx` draws it in CSS percentages and `cqw` units. Change a margin, shadow or bevel in `LAYOUT`, never in a renderer.

```ts
// ✅ the preview reads the same numbers
const box = artBox(ratio * 10_000, 10_000, mode)
style={{ left: pct(box.x, W), width: pct(box.w, W) }}

// ❌ a hand-tuned CSS margin "that looks about right"
className="m-[10%]"
```

### Always exactly 3840×2160, always ours
Every upload is a 16:9 JPEG of exactly 3840×2160 with `matte_id: "none"`. On 2022+ firmware that is the only way to get full screen and the same look on both TVs.

### Budget, not quality setting
`encodeJpeg` walks quality down from 90 until the file is ≤ 4 MB (the TV's photo limit). Paintings land around 1–3 MB at 88–90.

### Cheap on the Pi
- `prepare()` pre-shrinks huge sources to at most about 1.2× the canvas before any compositing.
- Rijksmuseum sources are requested through IIIF at `!4096,4096`, never `max`.
- `sharp.cache(false)` and `concurrency(2)` keep memory flat; renders are cached per (work, mode).
- Composite overlays must fit inside the canvas (sharp throws otherwise); `shadowLayer` clips itself.

### Modes
| Mode | Use |
|---|---|
| `light` / `dark` | Default. Work at most 80 % wide and 76 % high, bevel and soft shadow. Portraits look good too. |
| `blur` | The work blurred and darkened as the background. Lively, less "museum". |
| `fill` | Cover crop with sharp's attention strategy, only for aspect 1.5–2.1; otherwise it falls back to `light`. |

Upscaling is capped at 1.5× (`MAX_UPSCALE`); beyond that the work is shown smaller.

### Colour
`dominantColor` uses a 4-bit histogram on a 64×64 thumbnail, weighted toward saturated mid-tones, then maps HSL to a Dutch family (`rood`, `goud`, `bruin`, `groen`, `blauw`, `donker`, `licht`). Thresholds are tested in `render.test.ts`.

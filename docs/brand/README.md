# Frame Art brand

<p>
  <img src="png/lockup.png#gh-light-mode-only" alt="Frame Art" height="72">
  <img src="png/lockup-dark.png#gh-dark-mode-only" alt="Frame Art" height="72">
</p>

The mark is a picture frame, the way The Frame looks in Art Mode: a dark bezel, a gilt fillet and a cream passe-partout. In the window hangs a painting of a mountain shaped like an **A**, for *Art*, with the sun beside it. It reads as one tile at 16 px and as a framed painting at 512 px.

Every file is drawn by hand as SVG and generated from one set of shapes, so the icon, the banners and the social previews always match.

## Files

| File | Use |
|---|---|
| [`svg/mark.svg`](svg/mark.svg) | The icon, on light backgrounds |
| [`svg/mark-dark.svg`](svg/mark-dark.svg) | The icon, on dark backgrounds (graphite bezel) |
| [`svg/mark-mono.svg`](svg/mark-mono.svg) | One colour (`currentColor`), for stamps, stickers and monochrome UI |
| [`svg/wordmark.svg`](svg/wordmark.svg), [`svg/wordmark-dark.svg`](svg/wordmark-dark.svg) | "Frame Art" alone |
| [`svg/lockup.svg`](svg/lockup.svg), [`svg/lockup-dark.svg`](svg/lockup-dark.svg) | Mark and wordmark side by side |
| [`svg/lockup-any.svg`](svg/lockup-any.svg) | Cobalt wordmark that reads on light and dark: the add-on store logo |
| [`svg/banner-light.svg`](svg/banner-light.svg), [`svg/banner-dark.svg`](svg/banner-dark.svg) | README hero, 1600 × 560 |
| [`svg/social-preview.svg`](svg/social-preview.svg) | GitHub social preview, 1280 × 640 |
| [`svg/collections-*.svg`](svg/) | The same for frame-art-collections |
| [`svg/favicon.svg`](svg/favicon.svg) | Favicon |
| [`png/`](png/) | Rendered PNGs of the above |

Rendered where Home Assistant and GitHub look for them:

| Where | Files | Size |
|---|---|---|
| Add-on (app) store | `frame_art/icon.png`, `frame_art/logo.png` | 128 × 128, 250 × 100 |
| Integration (HA 2026.3+) | `custom_components/frame_art/brand/{,dark_}{icon,logo}{,@2x}.png` | icon 256 / 512, logo 256 / 512 high |
| GitHub social preview | `png/social-preview.png`, `png/collections-social-preview.png` | 1280 × 640 |
| Pages site | `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` | 32, 180 |

## Colours

| | Name | Hex | Use |
|---|---|---|---|
| ![](https://img.shields.io/badge/%20-%20%20%20-15171F?style=flat-square) | Ink | `#15171F` | Bezel, text on light |
| ![](https://img.shields.io/badge/%20-%20%20%20-2A2F3D?style=flat-square) | Graphite | `#2A2F3D` | Bezel on dark |
| ![](https://img.shields.io/badge/%20-%20%20%20-F6F0E6?style=flat-square) | Gallery cream | `#F6F0E6` | Passe-partout, light backgrounds, text on dark |
| ![](https://img.shields.io/badge/%20-%20%20%20-E3B341?style=flat-square) | Gilt | `#E3B341` | The fillet, small highlights only |
| ![](https://img.shields.io/badge/%20-%20%20%20-142C78?style=flat-square) | Prussian | `#142C78` | Sky (top) |
| ![](https://img.shields.io/badge/%20-%20%20%20-3159D8?style=flat-square) | Cobalt | `#3159D8` | Sky (bottom), links and the add-on logo |
| ![](https://img.shields.io/badge/%20-%20%20%20-F2542D?style=flat-square) | Vermilion | `#F2542D` | The A-mountain, the one loud accent |
| ![](https://img.shields.io/badge/%20-%20%20%20-FFB627?style=flat-square) | Saffron | `#FFB627` | The sun |
| ![](https://img.shields.io/badge/%20-%20%20%20-12A486?style=flat-square) | Viridian | `#12A486` | The ground |

Keep vermilion for one thing per screen. Cream and ink carry everything else.

## Type

- **Fraunces** (SemiBold–Bold, soft 30, optical size 96) for the wordmark and big headings: a warm, slightly old-style serif that feels like a museum label.
- **Inter** (Regular–SemiBold) for everything else.

Both are free under the SIL Open Font Licence, on [Google Fonts](https://fonts.google.com). The SVGs contain the letters as paths, so they need no fonts installed.

## Do and don't

- Do give the mark room: at least a quarter of its width on every side.
- Do use `mark-dark` on dark backgrounds rather than the light one on a dark square.
- Don't recolour the painting, stretch the mark, or put it on a busy photo.
- Don't use the Home Assistant logo, or Samsung's, in or next to the mark. Frame Art is independent, and Home Assistant asks custom integrations not to use its branding.

## Change it

```sh
# fonts once: the variable Fraunces and Inter from github.com/google/fonts (ofl/)
mkdir -p /tmp/fa-fonts   # Fraunces.ttf and Inter.ttf go here
cd docs/brand/tools && uv run --with fonttools python gen.py   # writes ../svg
cd ../../../frame_art && node ../docs/brand/tools/export.mjs   # writes every PNG
```

`tools/room-mockup.html` is the living room in the README: open it in a browser next to `art.jpg` and `phone.png`, and screenshot it at 1600 × 900.

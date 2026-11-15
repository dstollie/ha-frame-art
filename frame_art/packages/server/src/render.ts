/**
 * Render any artwork to exactly 3840x2160 for The Frame, with our own passe-partout.
 * The web preview draws with the same LAYOUT/artBox (served by /api/config), so the phone
 * shows what lands on the TV.
 */
import sharp, { type OverlayOptions, type Sharp } from "sharp"

import type { Mode } from "./models.js"

sharp.cache(false)
sharp.concurrency(2)

import { H, LAYOUT, MAX_UPSCALE, W, artBox, bevelWidth, type Box } from "./geometry.js"

export { H, LAYOUT, MAX_UPSCALE, W, artBox, bevelWidth }
export const MAX_BYTES = 4_000_000

const hex = (c: string) => ({
  r: parseInt(c.slice(1, 3), 16),
  g: parseInt(c.slice(3, 5), 16),
  b: parseInt(c.slice(5, 7), 16),
})

/** Decode once, auto-rotate, flatten alpha onto white, sRGB. Big JPEGs shrink on load. */
async function prepare(data: Buffer): Promise<{ img: Sharp; width: number; height: number }> {
  const base = sharp(data, { limitInputPixels: 300_000_000, failOn: "none" }).rotate()
  const meta = await base.metadata()
  const swap = (meta.orientation ?? 1) >= 5
  const width = (swap ? meta.height : meta.width) ?? 1
  const height = (swap ? meta.width : meta.height) ?? 1
  // Pre-shrink very large sources to at most ~2x the canvas: cheaper on a Pi, no visible loss.
  const factor = Math.max(width / (W * 1.2), height / (H * 1.2), 1)
  const pre = await base
    .resize(Math.round(width / factor), Math.round(height / factor), { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { info } = pre
  return {
    img: sharp(pre.data, { raw: { width: info.width, height: info.height, channels: info.channels } }),
    width: info.width,
    height: info.height,
  }
}

async function shadowLayer(box: Box, strength: number, size: [number, number]): Promise<OverlayOptions | null> {
  if (strength <= 0) return null
  const pad = Math.max(8, Math.floor(box.w / 30))
  const layerW = box.w + pad * 4
  const layerH = box.h + pad * 4
  let left = box.x - pad * 2
  let top = box.y - pad * 2 + Math.floor(pad / 3)
  // Clip to the canvas: sharp refuses overlays that stick out.
  const cropL = Math.max(0, -left)
  const cropT = Math.max(0, -top)
  const width = Math.min(layerW - cropL, size[0] - Math.max(left, 0))
  const height = Math.min(layerH - cropT, size[1] - Math.max(top, 0))
  if (width <= 0 || height <= 0) return null
  const blurred = await sharp({
    create: { width: box.w, height: box.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: strength } },
  })
    .extend({
      top: pad * 2,
      bottom: pad * 2,
      left: pad * 2,
      right: pad * 2,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .blur(Math.max(0.3, pad * 0.8))
    .png()
    .toBuffer()
  const input = await sharp(blurred).extract({ left: cropL, top: cropT, width, height }).png().toBuffer()
  left = Math.max(left, 0)
  top = Math.max(top, 0)
  return { input, left, top }
}

export async function render(data: Buffer, mode: Mode, size: [number, number] = [W, H]): Promise<Sharp> {
  const [cw, ch] = size
  const src = await prepare(data)
  const spec = LAYOUT[mode]

  if (mode === "fill") {
    const buf = await src.img.resize(cw, ch, { fit: "cover", position: sharp.strategy.attention }).toBuffer()
    return sharp(buf, { raw: { width: cw, height: ch, channels: 3 } })
  }

  const box = artBox(src.width, src.height, mode, size)
  let canvas: Buffer
  if (mode === "blur") {
    const small = await src.img
      .clone()
      .resize(Math.ceil(cw / 16), Math.ceil(ch / 16), { fit: "cover" })
      .blur(6)
      .toBuffer()
    canvas = await sharp(small, { raw: { width: Math.ceil(cw / 16), height: Math.ceil(ch / 16), channels: 3 } })
      .resize(cw, ch, { kernel: "cubic" })
      .linear(0.55, 0)
      .png()
      .toBuffer()
  } else {
    canvas = await sharp({ create: { width: cw, height: ch, channels: 3, background: hex(spec.matte!) } })
      .png()
      .toBuffer()
  }

  const layers: OverlayOptions[] = []
  const shadow = await shadowLayer(box, spec.shadow, size)
  if (shadow) layers.push(shadow)
  if (spec.bevel) {
    // The cut edge of a real passe-partout: a thin lighter band around the opening.
    const b = bevelWidth(cw)
    layers.push({
      input: { create: { width: box.w + b * 2, height: box.h + b * 2, channels: 3, background: hex(spec.bevel) } },
      left: box.x - b,
      top: box.y - b,
    })
  }
  const art = await src.img.resize(box.w, box.h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer()
  layers.push({ input: art, left: box.x, top: box.y })
  return sharp(canvas).composite(layers)
}

/** Rounded to 4 decimals; `+ 0` turns -0 into 0. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000 + 0

export interface Crop {
  /** Fractions of the source: where the 16:9 window sits. */
  left: number
  top: number
  width: number
  height: number
}

/** The centre 16:9 window for a work of this aspect; used when the thumbnail can't be read. */
export function centredCrop(aspect: number | null): Crop {
  const a = aspect ?? 16 / 9
  const width = Math.min(1, 16 / 9 / a)
  const height = Math.min(1, a / (16 / 9))
  return { left: round4((1 - width) / 2), top: round4((1 - height) / 2), width: round4(width), height: round4(height) }
}

/**
 * Where "fill" cuts a work to 16:9: sharp's attention strategy (skin tones, saturation, detail),
 * so faces and the subject stay in frame. Computed on a small copy; the preview uses it as-is.
 */
export async function smartCrop(data: Buffer): Promise<Crop> {
  const meta = await sharp(data, { failOn: "none" }).rotate().metadata()
  const swap = (meta.orientation ?? 1) >= 5
  const w = (swap ? meta.height : meta.width) ?? 1
  const h = (swap ? meta.width : meta.height) ?? 1
  const [tw, th] = [480, 270]
  const { info } = await sharp(data, { failOn: "none" })
    .rotate()
    .resize(tw, th, { fit: "cover", position: sharp.strategy.attention })
    .toBuffer({ resolveWithObject: true })
  const scale = Math.max(tw / w, th / h)
  const [sw, sh] = [w * scale, h * scale]
  const offset = info as typeof info & { cropOffsetLeft?: number; cropOffsetTop?: number }
  return {
    left: round4(-(offset.cropOffsetLeft ?? 0) / sw),
    top: round4(-(offset.cropOffsetTop ?? 0) / sh),
    width: round4(Math.min(1, tw / sw)),
    height: round4(Math.min(1, th / sh)),
  }
}

export async function encodeJpeg(img: Sharp, maxBytes = MAX_BYTES): Promise<Buffer> {
  const raw = await img.raw().toBuffer({ resolveWithObject: true })
  let out = Buffer.alloc(0)
  for (const quality of [90, 88, 86, 84, 82, 78, 74, 68, 60, 50]) {
    out = await sharp(raw.data, {
      raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels },
    })
      .jpeg({ quality, chromaSubsampling: "4:2:0", progressive: false, mozjpeg: false })
      .withMetadata({})
      .toBuffer()
    if (out.length <= maxBytes) return out
  }
  return out
}

export async function renderJpeg(data: Buffer, mode: Mode): Promise<Buffer> {
  return encodeJpeg(await render(data, mode))
}

export async function thumbnailJpeg(jpeg: Buffer, width = 640, height = 360): Promise<Buffer> {
  return sharp(jpeg).resize(width, height, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer()
}

// ---------------------------------------------------------------- colour

export const COLOR_FAMILIES = ["rood", "goud", "bruin", "groen", "blauw", "donker", "licht"] as const

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return [h, s, l]
}

export function colorFamily(rgb: [number, number, number]): string {
  const [deg, s, l] = rgbToHsl(...rgb)
  if (l < 0.16) return "donker"
  if (l > 0.78 && s < 0.35) return "licht"
  if (s < 0.12) return l < 0.45 ? "donker" : "licht"
  if (deg < 18 || deg >= 330) return "rood"
  if (deg < 65) return l < 0.42 ? "bruin" : "goud"
  if (deg < 170) return "groen"
  if (deg < 270) return "blauw"
  return "rood"
}

/** The most characteristic colour: a 4-bit-per-channel histogram, weighted toward saturated mid-tones. */
export async function dominantColor(data: Buffer): Promise<{ hex: string; family: string; aspect: number | null }> {
  const meta = await sharp(data, { failOn: "none" }).metadata()
  const { data: px } = await sharp(data, { failOn: "none" })
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true })
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 2 < px.length; i += 3) {
    const r = px[i]!,
      g = px[i + 1]!,
      b = px[i + 2]!
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    e.n++
    e.r += r
    e.g += g
    e.b += b
    buckets.set(key, e)
  }
  let best: [number, number, number] = [128, 128, 128]
  let bestScore = -1
  for (const e of buckets.values()) {
    const rgb: [number, number, number] = [e.r / e.n, e.g / e.n, e.b / e.n]
    const [, s, l] = rgbToHsl(...rgb)
    const score = e.n * (0.35 + s) * (0.4 + Math.min(l, 1 - l))
    if (score > bestScore) {
      bestScore = score
      best = rgb
    }
  }
  const rounded = best.map(Math.round) as [number, number, number]
  return {
    hex: `#${rounded.map((c) => c.toString(16).padStart(2, "0")).join("")}`,
    family: colorFamily(rounded),
    aspect: meta.width && meta.height ? Math.round((meta.width / meta.height) * 10_000) / 10_000 : null,
  }
}

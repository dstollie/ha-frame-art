import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { MODES } from "../src/models.js"
import {
  H,
  MAX_BYTES,
  MAX_UPSCALE,
  W,
  artBox,
  colorFamily,
  dominantColor,
  encodeJpeg,
  renderJpeg,
} from "../src/render.js"
import { jpeg } from "./helpers.js"

const LIGHT: [number, number, number] = [236, 232, 225]
const DARK: [number, number, number] = [28, 27, 25]

async function pixels(buf: Buffer) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    info,
    at(x: number, y: number): [number, number, number] {
      const i = (y * info.width + x) * info.channels
      return [data[i]!, data[i + 1]!, data[i + 2]!]
    },
  }
}
const close = (a: number[], b: number[], tol = 6) => a.every((v, i) => Math.abs(v - b[i]!) <= tol)

describe("render", () => {
  const sizes: [number, number][] = [
    [4000, 2518],
    [1800, 2400],
    [6000, 1500],
    [900, 600],
  ]
  for (const mode of MODES) {
    it.each(sizes)(`${mode}: %ix%i becomes exactly 3840x2160 JPEG under 4 MB`, async (w, h) => {
      const out = await renderJpeg(await jpeg(w, h), mode)
      expect(out.length).toBeLessThanOrEqual(MAX_BYTES)
      const meta = await sharp(out).metadata()
      expect([meta.format, meta.width, meta.height, meta.channels]).toEqual(["jpeg", W, H, 3])
      expect(meta.isProgressive).toBe(false)
    })
  }

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("%s: matte at the edges, art in the centre", async (mode, matte) => {
    const px = await pixels(await renderJpeg(await jpeg(4000, 2518, [30, 120, 60]), mode))
    for (const [x, y] of [
      [5, 5],
      [3834, 5],
      [5, 2154],
      [3834, 2154],
      [1920, 10],
    ] as const)
      expect(close(px.at(x, y), matte)).toBe(true)
    expect(close(px.at(1920, 300), matte)).toBe(false)
  })

  it("keeps the art box centred, within limits and in aspect", () => {
    for (const [w, h] of [
      [4000, 2518],
      [1800, 2400],
      [6000, 1500],
    ] as const) {
      const b = artBox(w, h, "light")
      expect(Math.abs(b.x + b.w / 2 - 1920)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.y + b.h / 2 - 1080)).toBeLessThanOrEqual(1)
      expect(b.w).toBeLessThanOrEqual(3840 * 0.8 + 1)
      expect(b.h).toBeLessThanOrEqual(2160 * 0.76 + 1)
      expect(Math.abs(b.w / b.h - w / h)).toBeLessThan(0.01)
    }
  })

  it("does not upscale small sources beyond the limit", () => {
    expect(artBox(800, 500, "light").w).toBe(Math.round(800 * MAX_UPSCALE))
  })

  it("preview geometry matches the full render proportionally", () => {
    const full = artBox(3000, 2000, "dark")
    const small = artBox(3000, 2000, "dark", [1280, 720])
    expect(Math.abs(full.w / 3840 - small.w / 1280)).toBeLessThan(0.002)
    expect(Math.abs(full.y / 2160 - small.y / 720)).toBeLessThan(0.002)
  })

  it("fill covers the screen for near-16:9 and falls back to light for portrait", async () => {
    const wide = await pixels(await renderJpeg(await jpeg(3200, 1900, [30, 120, 60]), "fill"))
    expect(close(wide.at(2, 2), LIGHT)).toBe(false)
    const tall = await pixels(await renderJpeg(await jpeg(1800, 2400), "fill"))
    expect(close(tall.at(5, 5), LIGHT)).toBe(true)
  })

  it("handles PNG with alpha and CMYK JPEG", async () => {
    const png = await sharp({
      create: { width: 1200, height: 800, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer()
    expect((await sharp(await renderJpeg(png, "dark")).metadata()).width).toBe(W)
    const cmyk = await sharp(await jpeg(1200, 800))
      .toColourspace("cmyk")
      .jpeg()
      .toBuffer()
    expect((await sharp(await renderJpeg(cmyk, "light")).metadata()).space).toBe("srgb")
  })

  it("lowers JPEG quality until it fits the budget", async () => {
    const noise = await sharp({
      create: { width: 3840, height: 2160, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } },
    })
      .blur(0.6)
      .raw()
      .toBuffer()
    const img = sharp(noise, { raw: { width: 3840, height: 2160, channels: 3 } })
    const q90 = await img.clone().jpeg({ quality: 90 }).toBuffer()
    const budget = Math.floor(q90.length / 2)
    const out = await encodeJpeg(img.clone(), budget)
    expect(out.length).toBeLessThanOrEqual(budget)
  })
})

describe("colour", () => {
  it.each([
    [[200, 30, 30], "rood"],
    [[30, 140, 60], "groen"],
    [[40, 70, 170], "blauw"],
    [[220, 180, 60], "goud"],
    [[100, 65, 30], "bruin"],
    [[15, 15, 15], "donker"],
    [[240, 238, 230], "licht"],
  ] as [[number, number, number], string][])("%j is %s", (rgb, fam) => {
    expect(colorFamily(rgb)).toBe(fam)
  })
  it("finds the main colour and the aspect", async () => {
    const c = await dominantColor(await jpeg(300, 200, [30, 60, 160]))
    expect(c.family).toBe("blauw")
    expect(c.aspect).toBe(1.5)
  })
})

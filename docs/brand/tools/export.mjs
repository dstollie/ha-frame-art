// Renders the PNGs Home Assistant, the add-on store and GitHub need from ../svg.
// Run from frame_art/ so sharp resolves: node ../docs/brand/tools/export.mjs
import { createRequire } from "node:module"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "../../..")
const require = createRequire(join(repo, "frame_art/packages/server/package.json"))
const sharp = require("sharp")
const svg = (n) => join(here, "../svg", n)
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

async function out(src, dest, { w, h, trim = false, fit = "contain", bg = transparent } = {}) {
  mkdirSync(dirname(dest), { recursive: true })
  const meta = await sharp(src).metadata()
  const scale = Math.max((w ?? 0) / meta.width, (h ?? 0) / meta.height, 1)
  let img = sharp(src, { density: Math.min(72 * scale * 2, 2400) })
  if (trim) img = sharp(await img.png().toBuffer()).trim({ threshold: 1 })
  const buf = await img.png().toBuffer()
  await sharp(buf).resize(w, h, { fit, background: bg }).png({ compressionLevel: 9, adaptiveFiltering: true, progressive: true }).toFile(dest)
  console.log(dest.replace(repo + "/", ""))
}

// Add-on (app) store
await out(svg("mark.svg"), join(repo, "frame_art/icon.png"), { w: 128, h: 128, trim: true })
await out(svg("lockup-any.svg"), join(repo, "frame_art/logo.png"), { w: 250, h: 100, trim: true })

// Integration brand images (HA 2026.3+: custom_components/<domain>/brand/)
const brand = join(repo, "custom_components/frame_art/brand")
for (const [prefix, mark, lockup] of [["", "mark.svg", "lockup.svg"], ["dark_", "mark-dark.svg", "lockup-dark.svg"]]) {
  await out(svg(mark), join(brand, `${prefix}icon.png`), { w: 256, h: 256, trim: true })
  await out(svg(mark), join(brand, `${prefix}icon@2x.png`), { w: 512, h: 512, trim: true })
  await out(svg(lockup), join(brand, `${prefix}logo.png`), { h: 256, trim: true })
  await out(svg(lockup), join(brand, `${prefix}logo@2x.png`), { h: 512, trim: true })
}

// GitHub
const png = join(here, "../png")
await out(svg("social-preview.svg"), join(png, "social-preview.png"), { w: 1280, h: 640 })
await out(svg("collections-social-preview.svg"), join(png, "collections-social-preview.png"), { w: 1280, h: 640 })
await out(svg("banner-light.svg"), join(png, "banner-light.png"), { w: 1600, h: 560 })
await out(svg("banner-dark.svg"), join(png, "banner-dark.png"), { w: 1600, h: 560 })
await out(svg("collections-banner-light.svg"), join(png, "collections-banner-light.png"), { w: 1600, h: 560 })
await out(svg("collections-banner-dark.svg"), join(png, "collections-banner-dark.png"), { w: 1600, h: 560 })
await out(svg("mark.svg"), join(png, "mark-512.png"), { w: 512, h: 512, trim: true })
await out(svg("lockup.svg"), join(png, "lockup.png"), { h: 256, trim: true })
await out(svg("lockup-dark.svg"), join(png, "lockup-dark.png"), { h: 256, trim: true })

// Favicons (for the collections Pages site; copy into frame-art-collections/site/)
await out(svg("favicon.svg"), join(png, "favicon-32.png"), { w: 32, h: 32, trim: true })
await out(svg("favicon.svg"), join(png, "apple-touch-icon.png"), { w: 180, h: 180, trim: true, bg: { r: 21, g: 23, b: 31, alpha: 1 } })

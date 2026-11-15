/**
 * Frame geometry, shared by the sharp renderer (server) and the live preview (web), so the
 * phone shows exactly what lands on the TV. No Node or sharp imports here.
 */
import type { Mode } from "./models.js"

export const W = 3840
export const H = 2160
export const MAX_UPSCALE = 1.5 // beyond this the work is shown smaller instead of blown up

export interface LayoutSpec {
  maxW: number
  maxH: number
  matte: string | null
  bevel: string | null
  shadow: number
}

export const LAYOUT: Record<Mode, LayoutSpec> = {
  light: { maxW: 0.8, maxH: 0.76, matte: "#ECE8E1", bevel: "#F8F6F1", shadow: 0.28 },
  dark: { maxW: 0.8, maxH: 0.76, matte: "#1C1B19", bevel: "#34322E", shadow: 0.55 },
  blur: { maxW: 0.86, maxH: 0.84, matte: null, bevel: null, shadow: 0.6 },
  fill: { maxW: 1, maxH: 1, matte: null, bevel: null, shadow: 0 },
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function artBox(srcW: number, srcH: number, mode: Mode, size: [number, number] = [W, H]): Box {
  const [cw, ch] = size
  const spec = LAYOUT[mode]
  let scale = Math.min((cw * spec.maxW) / srcW, (ch * spec.maxH) / srcH)
  scale = Math.min(scale, (MAX_UPSCALE * cw) / W) // relative to the full canvas, so previews behave the same
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  return { x: Math.floor((cw - w) / 2), y: Math.floor((ch - h) / 2), w, h }
}

export function bevelWidth(canvasW: number): number {
  return Math.max(2, Math.round(canvasW / 640)) * 3
}

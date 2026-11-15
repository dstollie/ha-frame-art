/** Colour families for the colour filter. Pure functions, no sharp: the database uses them too. */
export const COLOR_FAMILIES = ["red", "gold", "brown", "green", "blue", "dark", "light"] as const

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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
  if (l < 0.16) return "dark"
  if (l > 0.78 && s < 0.35) return "light"
  if (s < 0.12) return l < 0.45 ? "dark" : "light"
  if (deg < 18 || deg >= 330) return "red"
  if (deg < 65) return l < 0.42 ? "brown" : "gold"
  if (deg < 170) return "green"
  if (deg < 270) return "blue"
  return "red"
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null
}

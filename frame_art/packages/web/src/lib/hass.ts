/**
 * The bits of Home Assistant's `hass` object the panel uses. HA sets it on the element many times
 * per second (every state change); components subscribe to what they need through `useHass`.
 */
import { useSyncExternalStore } from "react"

export interface HassLike {
  language?: string
  locale?: { language?: string }
  themes?: { darkMode?: boolean }
  user?: { is_admin?: boolean; name?: string }
  fetchWithAuth?: (path: string, init?: RequestInit) => Promise<Response>
}

let current: HassLike | null = null
const listeners = new Set<() => void>()

export function setHass(hass: HassLike | null) {
  current = hass
  for (const l of listeners) l()
}

export function getHass() {
  return current
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useHass<T>(select: (h: HassLike | null) => T): T {
  return useSyncExternalStore(subscribe, () => select(current))
}

export const useLanguage = () =>
  useHass((h) => {
    const lang = h?.locale?.language ?? h?.language ?? navigator.language
    return lang.toLowerCase().startsWith("nl") ? "nl" : "en"
  })

export type Lang = "en" | "nl"

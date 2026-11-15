/** HA's `narrow` flag: the sidebar is hidden (phones), so the panel shows its own menu button. */
import { useSyncExternalStore } from "react"

let narrow = false
const listeners = new Set<() => void>()

export function setNarrow(v: boolean) {
  narrow = v
  for (const l of listeners) l()
}

export const useNarrow = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => narrow,
  )

import type { Artwork } from "../models.js"

export const USER_AGENT = "FrameArt/0.1 (Home Assistant add-on; open-access paintings for a Samsung The Frame)"

export type Fetch = typeof fetch
export type Harvester = (fetchFn: Fetch, known: Set<string>, opts?: { delayMs?: number }) => AsyncGenerator<Artwork>

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function getJson<T>(fetchFn: Fetch, url: string, headers: Record<string, string> = {}): Promise<T | null> {
  const r = await fetchFn(url, { headers: { "User-Agent": USER_AGENT, ...headers }, redirect: "follow" })
  if (!r.ok) return null
  return (await r.json()) as T
}

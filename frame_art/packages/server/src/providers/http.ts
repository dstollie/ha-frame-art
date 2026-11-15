export const USER_AGENT = "FrameArt/0.2 (Home Assistant add-on; https://github.com/dstollie/ha-frame-art)"

export type Fetch = typeof fetch

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function getJson<T>(
  fetchFn: Fetch,
  url: string,
  headers: Record<string, string> = {},
  init: { method?: string; body?: string } = {},
): Promise<T | null> {
  const r = await fetchFn(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  })
  if (!r.ok) return null
  return (await r.json()) as T
}

/** First four-digit year in a free-text date ("c. 1665", "between 1546 and 1547"). */
export function firstYear(text: string | null | undefined): number | null {
  const m = /\b(1[0-9]{3}|20[0-2][0-9])\b/.exec(text ?? "")
  return m ? Number(m[1]) : null
}

export const round4 = (n: number) => Math.round(n * 10_000) / 10_000

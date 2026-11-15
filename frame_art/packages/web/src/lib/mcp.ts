/** MCP endpoint URLs and the copy command. Pure, so it's unit-tested. */
export interface HaUrls {
  external: string | null
  external_is_cloud: boolean
  internal: string | null
  mcp_path: string
}

export interface McpEndpoint {
  label: "remote" | "local" | "browser"
  cloud: boolean
  url: string
}

/** Absolute MCP endpoints, best first: remote (Nabu Casa / external), local, then this browser's origin. */
export function mcpEndpoints(
  urls: HaUrls | null | undefined,
  origin: string,
  path = "/api/frame_art/mcp",
): McpEndpoint[] {
  const out: McpEndpoint[] = []
  const add = (label: McpEndpoint["label"], base: string | null | undefined, cloud = false) => {
    if (!base) return
    const url = `${base.replace(/\/$/, "")}${path}`
    if (!out.some((e) => e.url === url)) out.push({ label, cloud, url })
  }
  add("remote", urls?.external, urls?.external_is_cloud ?? false)
  add("local", urls?.internal)
  add("browser", origin)
  return out
}

/** The command to paste into a terminal; the real token only when it's revealed. */
export function claudeCommand(endpoint: string, token: string | null): string {
  return `claude mcp add --transport http frame-art ${endpoint} --header "Authorization: Bearer ${token ?? "<token>"}"`
}

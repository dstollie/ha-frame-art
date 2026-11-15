import { describe, expect, it } from "vitest"

import { claudeCommand, mcpEndpoints } from "./mcp"

describe("MCP endpoints", () => {
  it("are absolute, remote (Nabu Casa) first, then local, then this browser, without duplicates", () => {
    const urls = {
      external: "https://abc.ui.nabu.casa/",
      external_is_cloud: true,
      internal: "http://192.168.1.10:8123",
      mcp_path: "/api/frame_art/mcp",
    }
    expect(mcpEndpoints(urls, "http://192.168.1.10:8123")).toEqual([
      { label: "remote", cloud: true, url: "https://abc.ui.nabu.casa/api/frame_art/mcp" },
      { label: "local", cloud: false, url: "http://192.168.1.10:8123/api/frame_art/mcp" },
    ])
  })

  it("fall back to the browser's origin without the integration", () => {
    expect(mcpEndpoints(null, "https://ha.example.com")).toEqual([
      { label: "browser", cloud: false, url: "https://ha.example.com/api/frame_art/mcp" },
    ])
    for (const e of mcpEndpoints(null, "https://ha.example.com")) expect(e.url).toMatch(/^https?:\/\//)
  })

  it("put the real token in the command only when given, otherwise a placeholder", () => {
    const url = "https://abc.ui.nabu.casa/api/frame_art/mcp"
    expect(claudeCommand(url, null)).toBe(
      `claude mcp add --transport http frame-art ${url} --header "Authorization: Bearer <token>"`,
    )
    expect(claudeCommand(url, "s3cret")).toContain('"Authorization: Bearer s3cret"')
  })
})

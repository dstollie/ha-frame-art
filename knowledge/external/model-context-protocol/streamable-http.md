# MCP over streamable HTTP (as used here)

- SDK: `@modelcontextprotocol/sdk` 1.32 (`McpServer`, `registerTool(name, { title, description, inputSchema: zodShape }, handler)`), Hono transport `@hono/mcp` (`StreamableHTTPTransport`).
- **Stateless:** `sessionIdGenerator: undefined`, a fresh `McpServer` + transport per request, `enableJsonResponse: true`. No session storage on the Pi, and the HA proxy only needs plain request/response.
- A tool result is `{ content: [{ type: "text", text }] }`; errors set `isError: true` with a human-readable text (the model reads it).
- Clients send `Accept: application/json, text/event-stream` and `Content-Type: application/json`; the integration forwards `mcp-session-id` and `mcp-protocol-version` too.
- Tests use the SDK's `Client` + `StreamableHTTPClientTransport` with a custom `fetch` that calls `app.request()`, so the whole protocol runs without a socket.

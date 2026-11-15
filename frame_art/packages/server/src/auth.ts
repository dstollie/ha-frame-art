/**
 * Who may call the add-on:
 * - HA ingress (the Supervisor proxy at 172.30.32.2 adds X-Ingress-Path),
 * - the Frame Art integration, with the internal token it got through Supervisor discovery,
 * - MCP clients on /mcp, with the MCP token from Settings (Bearer or ?token=).
 * Tokens live in SQLite and are never logged.
 */
import { randomBytes, timingSafeEqual } from "node:crypto"

import type { Store } from "./db.js"

export const INGRESS_PROXY = "172.30.32.2"

const newToken = () => randomBytes(32).toString("base64url")

export class Tokens {
  constructor(private readonly store: Store) {}

  private get(key: string): string {
    let token = this.store.getMeta(key)
    if (!token) {
      token = newToken()
      this.store.setMeta(key, token)
    }
    return token
  }

  get internal() {
    return this.get("internal_token")
  }

  get mcp() {
    return this.get("mcp_token")
  }

  rotateMcp(): string {
    const token = newToken()
    this.store.setMeta("mcp_token", token)
    return token
  }
}

export function sameToken(given: string | null | undefined, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function bearer(header: string | undefined | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "")
  return m ? m[1]!.trim() : null
}

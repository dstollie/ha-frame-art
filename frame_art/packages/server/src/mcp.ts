/**
 * MCP server: lets an AI search the catalogue, upload to "My collection", and put art on a TV.
 * Stateless streamable HTTP (one server per request), JSON responses, token-protected in app.ts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Services } from "./app.js"
import { CATEGORIES } from "./categorize.js"
import { COLOR_FAMILIES } from "./color.js"
import type { JobDTO } from "./jobs.js"
import type { Artwork, Mode } from "./models.js"

const display = z
  .enum(["fill", "matte"])
  .optional()
  .describe('"fill" = smart crop to fill the screen (default per TV); "matte" = passe-partout, whole work visible')
const matteStyle = z.enum(["light", "dark", "blur"]).optional().describe("Passe-partout style when display is matte")

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] })
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true })

function summary(a: Artwork) {
  return {
    id: a.id,
    title: a.title,
    artist: a.artist,
    date: a.dateText,
    source: a.source,
    licence: a.licence,
    categories: a.categories,
    color: a.colorFamily,
    aspect: a.aspect,
    page: a.pageUrl || undefined,
  }
}

async function finished(svc: Services, job: JobDTO, timeoutMs = 120_000): Promise<JobDTO> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && (job.status === "queued" || job.status === "running")) {
    await new Promise((r) => setTimeout(r, 400))
    job = svc.runner.jobs.get(job.id) ?? job
  }
  return job
}

export function modeFrom(svc: Services, tv: string, d?: "fill" | "matte", style?: Mode): Mode {
  if (d === "fill") return "fill"
  if (d === "matte") return style ?? svc.displayOf(tv).matteStyle
  return svc.modeFor(tv)
}

export function createMcpServer(svc: Services): McpServer {
  const server = new McpServer({ name: "frame-art", version: "0.2.0" })

  server.registerTool(
    "search_art",
    {
      title: "Search art",
      description:
        "Search the Frame Art catalogue (open-access paintings from museums, plus the user's own collection). " +
        "Returns works with an id you can pass to show_artwork.",
      inputSchema: {
        query: z.string().optional().describe("Words in title, artist or date, e.g. 'monet water lilies'"),
        category: z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]).optional(),
        color: z.enum(COLOR_FAMILIES).optional(),
        source: z.string().optional().describe("Provider id, e.g. met, aic, rijks, smk, mine (see list_sources)"),
        landscape_only: z.boolean().optional().describe("Only works that suit a landscape TV (default true)"),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async (args) => {
      const { items, total } = svc.store.query({
        q: args.query ?? null,
        category: args.category ?? null,
        color: args.color ?? null,
        source: args.source ?? null,
        sources: args.source ? undefined : svc.sources.enabledIds(),
        landscape: args.landscape_only ?? true,
        limit: args.limit ?? 10,
        seed: Math.floor(Date.now() / 86_400_000),
      })
      return text({ total, items: items.map(summary) })
    },
  )

  server.registerTool(
    "list_sources",
    {
      title: "List art sources",
      description: "The art providers (museums, Wikimedia, My collection), whether they're on, and the categories.",
      inputSchema: {},
    },
    async () =>
      text({
        sources: svc.sources
          .toDTO()
          .map(({ id, name, licence, enabled, count }) => ({ id, name, licence, enabled, count })),
        categories: CATEGORIES.map((c) => ({ id: c.id, name: c.en })),
        colors: COLOR_FAMILIES,
      }),
  )

  server.registerTool(
    "list_tvs",
    {
      title: "List TVs",
      description: "The Samsung Frame TVs, whether they're on and paired, their display mode and what they show.",
      inputSchema: {},
    },
    async () => text(await svc.tvStates()),
  )

  server.registerTool(
    "get_current_art",
    {
      title: "Current art",
      description: "What each TV (or one TV) shows now.",
      inputSchema: { tv: z.string().optional().describe("TV id from list_tvs") },
    },
    async ({ tv }) => {
      const states = (await svc.tvStates()).filter((t) => !tv || t.id === tv)
      if (!states.length) return fail(`Unknown TV ${tv}`)
      return text(states.map((t) => ({ tv: t.id, name: t.name, current: t.current })))
    },
  )

  server.registerTool(
    "show_artwork",
    {
      title: "Show artwork on a TV",
      description:
        "Put a work on a TV in Art Mode: renders 3840x2160, wakes the TV if needed, uploads and selects it. " +
        "Waits until it's on the wall unless wait is false.",
      inputSchema: {
        tv: z.string().describe("TV id from list_tvs"),
        artwork_id: z.string().describe("Work id from search_art or upload_image"),
        display,
        matte_style: matteStyle,
        wait: z.boolean().optional(),
      },
    },
    async (args) => {
      const tv = svc.tvs.get(args.tv)
      if (!tv) return fail(`Unknown TV ${args.tv}`)
      if (!tv.paired) return fail(`TV ${args.tv} isn't paired yet; pair it in the Frame Art panel`)
      const art = svc.store.get(args.artwork_id)
      if (!art) return fail(`Unknown artwork ${args.artwork_id}`)
      let job = svc.runner.submit(tv.id, art.id, modeFrom(svc, tv.id, args.display, args.matte_style))
      if (args.wait !== false) job = await finished(svc, job)
      return job.status === "error" ? fail(`Failed: ${job.error}`) : text({ job, artwork: summary(art) })
    },
  )

  server.registerTool(
    "upload_image",
    {
      title: "Upload an image",
      description:
        "Add an image to My collection from a URL or base64 data, optionally into an album, and optionally put it on a TV right away.",
      inputSchema: {
        url: z.string().url().optional(),
        base64: z.string().optional().describe("Image bytes as base64 (a data: URL is fine too)"),
        title: z.string().optional(),
        album: z.string().optional().describe("Album name; created when it doesn't exist"),
        show_on_tv: z.string().optional().describe("TV id to show it on immediately"),
        display,
        matte_style: matteStyle,
      },
    },
    async (args) => {
      if (!args.url && !args.base64) return fail("Give url or base64")
      let albumId: string | null = null
      if (args.album) {
        const existing = svc.store.albums().find((a) => a.name.toLowerCase() === args.album!.toLowerCase())
        albumId = existing?.id ?? svc.collection.createAlbum(args.album).id
      }
      try {
        const extra = { title: args.title ?? null, albumId }
        const art = args.url
          ? await svc.collection.addFromUrl(args.url, extra)
          : await svc.collection.addFromBase64(args.base64!, extra)
        if (!args.show_on_tv) return text({ artwork: summary(art) })
        const tv = svc.tvs.get(args.show_on_tv)
        if (!tv?.paired) return fail(`Uploaded as ${art.id}, but TV ${args.show_on_tv} is unknown or not paired`)
        const job = await finished(
          svc,
          svc.runner.submit(tv.id, art.id, modeFrom(svc, tv.id, args.display, args.matte_style)),
        )
        return job.status === "error"
          ? fail(`Uploaded as ${art.id}; showing failed: ${job.error}`)
          : text({ artwork: summary(art), job })
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e))
      }
    },
  )

  server.registerTool(
    "list_albums",
    { title: "List albums", description: "Albums in My collection with how many works they hold.", inputSchema: {} },
    async () => text(svc.store.albums().map(({ id, name, count }) => ({ id, name, count }))),
  )

  return server
}

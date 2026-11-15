import type { ApiType, ArtworkDTO, JobDTO, Mode } from "@frame-art/server/api"
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hc, type InferResponseType } from "hono/client"
import { useEffect, useState } from "react"

import { apiFetch, apiUrl, getEnv } from "./env"
import { getHass } from "./hass"
import type { HaUrls } from "./mcp"

export type { HaUrls } from "./mcp"

export type { ArtworkDTO, JobDTO, Mode }

const makeClient = () => hc<ApiType>(getEnv().apiBase, { fetch: apiFetch })
let client: ReturnType<typeof makeClient> | null = null
/** Typed client for the add-on API (Hono RPC); created after the environment is known. */
export const api = () => (client ??= makeClient())
export const resetApi = () => {
  client = null
}

export class ApiError extends Error {}

async function ok<T>(res: Response & { json(): Promise<T> }): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

type Client = ReturnType<typeof makeClient>
export type Config = InferResponseType<Client["config"]["$get"]>
export type TvState = InferResponseType<Client["tvs"]["$get"]>[number]
export type ArtworkDetail = InferResponseType<Client["artworks"][":id"]["$get"], 200>
export type HistoryItem = InferResponseType<Client["history"]["$get"]>[number]
export type SyncState = InferResponseType<Client["sync"]["$get"]>
export type SourceSetting = InferResponseType<Client["settings"]["sources"]["$get"]>[number]
export type Album = InferResponseType<Client["albums"]["$get"]>[number]
export type SeriesSummary = InferResponseType<Client["series"]["$get"]>[number]
export type SeriesDetail = InferResponseType<Client["series"][":id"]["$get"], 200>
export type Playback = NonNullable<TvState["playback"]>
export type PlaybackAction = "pause" | "resume" | "next" | "stop"

export interface BrowseFilters {
  cat?: string | undefined
  color?: string | undefined
  q?: string | undefined
  source?: string | undefined
  album?: string | undefined
  all?: boolean | undefined // include portrait works
  favourites?: boolean | undefined
}

const PAGE = 36
const seed = Math.floor(Date.now() / 86_400_000)

export const keys = {
  config: ["config"] as const,
  tvs: ["tvs"] as const,
  artworks: (f: BrowseFilters) => ["artworks", f] as const,
  artwork: (id: string) => ["artwork", id] as const,
  job: (id: string) => ["job", id] as const,
  history: ["history"] as const,
  sync: ["sync"] as const,
  sources: ["sources"] as const,
  albums: ["albums"] as const,
  mcp: ["mcp"] as const,
  seriesList: ["series"] as const,
  series: (id: string) => ["series", id] as const,
}

export const useConfig = () =>
  useQuery({ queryKey: keys.config, queryFn: async () => ok(await api().config.$get()), staleTime: 60_000 })

export const useTvs = () =>
  useQuery({ queryKey: keys.tvs, queryFn: async () => ok(await api().tvs.$get()), refetchInterval: 10_000 })

export function useArtworks(f: BrowseFilters) {
  return useInfiniteQuery({
    queryKey: keys.artworks(f),
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) =>
      ok(
        await api().artworks.$get({
          query: {
            category: f.cat,
            color: f.color,
            q: f.q,
            source: f.source,
            album: f.album,
            landscape: f.all || f.favourites || f.album || f.source === "mine" ? undefined : "1",
            favourites: f.favourites ? "1" : undefined,
            offset: String(pageParam),
            limit: String(PAGE),
            seed: String(seed),
          },
        }),
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  })
}

export const useArtwork = (id: string) =>
  useQuery({ queryKey: keys.artwork(id), queryFn: async () => ok(await api().artworks[":id"].$get({ param: { id } })) })

export async function randomArtwork(f: BrowseFilters): Promise<ArtworkDTO> {
  return ok(
    await api().random.$get({
      query: { category: f.cat, color: f.color, q: f.q, source: f.source, landscape: f.all ? undefined : "1" },
    }),
  )
}

const invalidateArt = (qc: ReturnType<typeof useQueryClient>, id?: string) => {
  if (id) void qc.invalidateQueries({ queryKey: keys.artwork(id) })
  void qc.invalidateQueries({ queryKey: ["artworks"] })
}

export function useFavourite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) =>
      ok(await api().artworks[":id"].favourite.$post({ param: { id }, json: { on } })),
    onMutate: ({ id, on }) => {
      qc.setQueryData<ArtworkDetail>(keys.artwork(id), (old) => (old ? { ...old, favourite: on } : old))
    },
    onSettled: (_d, _e, { id }) => invalidateArt(qc, id),
  })
}

export function useHide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => ok(await api().artworks[":id"].hide.$post({ param: { id } })),
    onSuccess: () => invalidateArt(qc),
  })
}

export function useDeleteArtwork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => ok(await api().artworks[":id"].$delete({ param: { id } })),
    onSuccess: () => {
      invalidateArt(qc)
      void qc.invalidateQueries({ queryKey: keys.albums })
    },
  })
}

export function useRenameArtwork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) =>
      ok(await api().artworks[":id"].$patch({ param: { id }, json: { title } })),
    onSuccess: (_d, { id }) => invalidateArt(qc, id),
  })
}

export function useShow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tv, artworkId, mode }: { tv: string; artworkId: string; mode?: Mode | undefined }) =>
      ok(await api().tvs[":tv"].show.$post({ param: { tv }, json: { artworkId, ...(mode ? { mode } : {}) } })),
    onSuccess: (job) => {
      qc.setQueryData(keys.job(job.id), job)
      void qc.invalidateQueries({ queryKey: keys.tvs })
    },
  })
}

export function useNext() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tv: string) => ok(await api().tvs[":tv"].next.$post({ param: { tv } })),
    onSuccess: (job) => {
      qc.setQueryData(keys.job(job.id), job)
      void qc.invalidateQueries({ queryKey: keys.tvs })
    },
  })
}

export function useJob(id: string | null) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: keys.job(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async () => {
      const job = await ok(await api().jobs[":id"].$get({ param: { id: id! } }))
      if (job.status === "done" || job.status === "error") {
        void qc.invalidateQueries({ queryKey: keys.tvs })
        void qc.invalidateQueries({ queryKey: keys.history })
      }
      return job
    },
    refetchInterval: (q) => (q.state.data && ["done", "error"].includes(q.state.data.status) ? false : 700),
  })
}

export function usePair() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tv: string) => ok(await api().tvs[":tv"].pair.$post({ param: { tv } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.tvs }),
  })
}

export function useSetCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tv, category }: { tv: string; category: string }) =>
      ok(await api().tvs[":tv"].category.$put({ param: { tv }, json: { category } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.tvs }),
  })
}

export function useSetDisplay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { tv: string; display: "fill" | "matte"; matteStyle: "light" | "dark" | "blur" }) =>
      ok(
        await api().tvs[":tv"].display.$put({
          param: { tv: v.tv },
          json: { display: v.display, matteStyle: v.matteStyle },
        }),
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.tvs }),
  })
}

export const useCrop = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["crop", id],
    enabled,
    staleTime: Infinity,
    queryFn: async () => ok(await api().artworks[":id"].crop.$get({ param: { id } })),
  })

export const useHistory = () =>
  useQuery({ queryKey: keys.history, queryFn: async () => ok(await api().history.$get({ query: { limit: "120" } })) })

export const useSync = () =>
  useQuery({
    queryKey: keys.sync,
    queryFn: async () => ok(await api().sync.$get()),
    refetchInterval: (q) => (q.state.data?.state === "running" ? 2000 : 15_000),
  })

export function useStartSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => ok(await api().sync.$post()),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.sync }),
  })
}

export const useSources = () =>
  useQuery({ queryKey: keys.sources, queryFn: async () => ok(await api().settings.sources.$get()) })

export function useSetSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; enabled: boolean; apiKey?: string | null }) =>
      ok(
        await api().settings.sources[":id"].$put({
          param: { id: v.id },
          json: { enabled: v.enabled, ...(v.apiKey === undefined ? {} : { apiKey: v.apiKey }) },
        }),
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.sources })
      void qc.invalidateQueries({ queryKey: keys.config })
      void qc.invalidateQueries({ queryKey: ["artworks"] })
      void qc.invalidateQueries({ queryKey: keys.sync })
    },
  })
}

/**
 * Where this HA is reachable (from the Frame Art integration). Uses hass.fetchWithAuth when we have
 * a hass object (panel, or the ingress page inside HA); null when the integration isn't installed.
 */
export const useHaUrls = () =>
  useQuery({
    queryKey: ["ha-urls"],
    staleTime: 300_000,
    retry: false,
    queryFn: async (): Promise<HaUrls | null> => {
      const hass = getHass()
      const r = hass?.fetchWithAuth
        ? await hass.fetchWithAuth("/api/frame_art/urls")
        : await fetch("/api/frame_art/urls")
      return r.ok ? ((await r.json()) as HaUrls) : null
    },
  })

export const useMcp = (enabled: boolean) =>
  useQuery({ queryKey: keys.mcp, enabled, queryFn: async () => ok(await api().settings.mcp.$get()) })

export function useRotateMcp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => ok(await api().settings.mcp.rotate.$post()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.mcp }),
  })
}

export const useAlbums = () => useQuery({ queryKey: keys.albums, queryFn: async () => ok(await api().albums.$get()) })

export function useAlbumMutations() {
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: keys.albums })
    void qc.invalidateQueries({ queryKey: ["artworks"] })
    void qc.invalidateQueries({ queryKey: ["artwork"] })
  }
  return {
    create: useMutation({
      mutationFn: async (name: string) => ok(await api().albums.$post({ json: { name } })),
      onSuccess: done,
    }),
    rename: useMutation({
      mutationFn: async ({ id, name }: { id: string; name: string }) =>
        ok(await api().albums[":id"].$patch({ param: { id }, json: { name } })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => ok(await api().albums[":id"].$delete({ param: { id } })),
      onSuccess: done,
    }),
    toggle: useMutation({
      mutationFn: async ({ album, artworkId, on }: { album: string; artworkId: string; on: boolean }) =>
        ok(await api().albums[":id"].items.$post({ param: { id: album }, json: { artworkId, on } })),
      onSuccess: done,
    }),
  }
}

/** Upload files (multipart) or a URL into My collection. */
export function useUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { files?: File[]; url?: string; albumId?: string | null }) => {
      let res: Response
      if (input.files?.length) {
        const form = new FormData()
        for (const f of input.files) form.append("file", f)
        if (input.albumId) form.append("albumId", input.albumId)
        res = await apiFetch(apiUrl("collection"), { method: "POST", body: form })
      } else {
        res = await apiFetch(apiUrl("collection"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: input.url, albumId: input.albumId ?? undefined }),
        })
      }
      return ok(res as Response & { json(): Promise<{ items: ArtworkDTO[] }> })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["artworks"] })
      void qc.invalidateQueries({ queryKey: keys.albums })
      void qc.invalidateQueries({ queryKey: keys.config })
    },
  })
}

/** Thumbnail URL for <img>: direct for most museums, an object URL for ones the add-on serves (with auth). */
const blobCache = new Map<string, Promise<string>>()
export function useThumb(art: Pick<ArtworkDTO, "thumb" | "thumbPath" | "source"> | null | undefined): string | null {
  const direct = art?.thumb ? gridThumb(art.thumb, art.source) : null
  const path = art?.thumbPath ?? null
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null)
  useEffect(() => {
    if (direct || !path) return
    let alive = true
    let hit = blobCache.get(path)
    if (!hit) {
      hit = apiFetch(apiUrl(path)).then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return URL.createObjectURL(await r.blob())
      })
      hit.catch(() => blobCache.delete(path))
      blobCache.set(path, hit)
    }
    hit.then((url) => alive && setLoaded({ path, url })).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [direct, path])
  return direct ?? (loaded && loaded.path === path ? loaded.url : null)
}

/** Grid thumbnails: ask IIIF for a smaller image where we can. */
export function gridThumb(thumb: string, source: string): string {
  if (source === "rijks") return thumb.replace("/full/!800,800/", "/full/!520,520/")
  return thumb
}

// ------------------------------------------------------------------ series

export const useSeriesList = () =>
  useQuery({ queryKey: keys.seriesList, queryFn: async () => ok(await api().series.$get()), refetchInterval: 15_000 })

export const useSeries = (id: string) =>
  useQuery({
    queryKey: keys.series(id),
    queryFn: async () => ok(await api().series[":id"].$get({ param: { id } })),
  })

export type SeriesSource = { artworkIds: string[] } | { albumId: string } | { query: BrowseFilters }

export function useSeriesMutations() {
  const qc = useQueryClient()
  const done = (detail?: SeriesDetail) => {
    if (detail) qc.setQueryData(keys.series(detail.id), detail)
    void qc.invalidateQueries({ queryKey: keys.seriesList })
    void qc.invalidateQueries({ queryKey: ["artwork"] })
    void qc.invalidateQueries({ queryKey: keys.tvs })
  }
  return {
    create: useMutation({
      mutationFn: async ({ name, from }: { name: string; from?: SeriesSource }) => {
        const body =
          from && "query" in from
            ? {
                query: {
                  ...(from.query.cat ? { category: from.query.cat } : {}),
                  ...(from.query.color ? { color: from.query.color } : {}),
                  ...(from.query.q ? { q: from.query.q } : {}),
                  ...(from.query.source ? { source: from.query.source } : {}),
                  ...(from.query.all || from.query.source === "mine" ? {} : { landscape: "1" as const }),
                },
              }
            : (from ?? {})
        return ok(await api().series.$post({ json: { name, ...body } }))
      },
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: { id: string; name?: string; duration?: number; shuffle?: boolean }) =>
        ok(await api().series[":id"].$patch({ param: { id }, json: patch })),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => ok(await api().series[":id"].$delete({ param: { id } })),
      onSuccess: () => done(),
    }),
    toggleItem: useMutation({
      mutationFn: async ({ id, artworkId, on }: { id: string; artworkId: string; on: boolean }) =>
        on
          ? ok(await api().series[":id"].items.$post({ param: { id }, json: { artworkId } }))
          : ok(await api().series[":id"].items[":artworkId"].$delete({ param: { id, artworkId } })),
      onSuccess: done,
    }),
    itemDuration: useMutation({
      mutationFn: async ({ id, artworkId, duration }: { id: string; artworkId: string; duration: number | null }) =>
        ok(await api().series[":id"].items[":artworkId"].$patch({ param: { id, artworkId }, json: { duration } })),
      onSuccess: done,
    }),
    reorder: useMutation({
      mutationFn: async ({ id, artworkIds }: { id: string; artworkIds: string[] }) =>
        ok(await api().series[":id"].order.$put({ param: { id }, json: { artworkIds } })),
      onMutate: ({ id, artworkIds }) => {
        qc.setQueryData<SeriesDetail>(keys.series(id), (old) =>
          old
            ? {
                ...old,
                items: artworkIds.flatMap((a) => old.items.filter((i) => i.artwork.id === a)),
              }
            : old,
        )
      },
      onSuccess: done,
    }),
    play: useMutation({
      mutationFn: async ({ id, tvs }: { id: string; tvs: string[] }) =>
        ok(await api().series[":id"].play.$post({ param: { id }, json: { tvs } })),
      onSuccess: () => done(),
    }),
  }
}

export function usePlaybackControl() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tv, action }: { tv: string; action: PlaybackAction }) =>
      ok(await api().tvs[":tv"].playback.$post({ param: { tv }, json: { action } })),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.tvs })
      void qc.invalidateQueries({ queryKey: keys.seriesList })
    },
  })
}

export const DURATIONS = [60, 300, 900, 1800, 3600, 7200, 21600, 43200, 86400] as const

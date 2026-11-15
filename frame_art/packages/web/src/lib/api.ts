import type { ApiType, ArtworkDTO, JobDTO, Mode } from "@frame-art/server/api"
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hc, type InferResponseType } from "hono/client"

export type { ArtworkDTO, JobDTO, Mode }

/** Relative to the page, so it works under any HA ingress prefix. */
export const api = hc<ApiType>(new URL("api", document.baseURI).toString())

export class ApiError extends Error {}

async function ok<T>(res: Response & { json(): Promise<T> }): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? `Fout ${res.status}`)
  }
  return res.json()
}

export type Config = InferResponseType<typeof api.config.$get>
export type TvState = InferResponseType<typeof api.tvs.$get>[number]
export type ArtworkDetail = InferResponseType<(typeof api.artworks)[":id"]["$get"], 200>
export type HistoryItem = InferResponseType<typeof api.history.$get>[number]
export type SyncState = InferResponseType<typeof api.sync.$get>

export interface BrowseFilters {
  cat?: string | undefined
  color?: string | undefined
  q?: string | undefined
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
}

export const useConfig = () =>
  useQuery({ queryKey: keys.config, queryFn: async () => ok(await api.config.$get()), staleTime: 60_000 })

export const useTvs = () =>
  useQuery({ queryKey: keys.tvs, queryFn: async () => ok(await api.tvs.$get()), refetchInterval: 10_000 })

export function useArtworks(f: BrowseFilters) {
  return useInfiniteQuery({
    queryKey: keys.artworks(f),
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) =>
      ok(
        await api.artworks.$get({
          query: {
            category: f.cat,
            color: f.color,
            q: f.q,
            landscape: f.all || f.favourites ? undefined : "1",
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
  useQuery({ queryKey: keys.artwork(id), queryFn: async () => ok(await api.artworks[":id"].$get({ param: { id } })) })

export async function randomArtwork(f: BrowseFilters): Promise<ArtworkDTO> {
  return ok(
    await api.random.$get({
      query: { category: f.cat, color: f.color, q: f.q, landscape: f.all ? undefined : "1" },
    }),
  )
}

export function useFavourite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) =>
      ok(await api.artworks[":id"].favourite.$post({ param: { id }, json: { on } })),
    onMutate: async ({ id, on }) => {
      qc.setQueryData<ArtworkDetail>(keys.artwork(id), (old) => (old ? { ...old, favourite: on } : old))
    },
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.artwork(id) })
      void qc.invalidateQueries({ queryKey: ["artworks"] })
    },
  })
}

export function useHide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => ok(await api.artworks[":id"].hide.$post({ param: { id } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["artworks"] }),
  })
}

export function useShow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tv, artworkId, mode }: { tv: string; artworkId: string; mode: Mode }) =>
      ok(await api.tvs[":tv"].show.$post({ param: { tv }, json: { artworkId, mode } })),
    onSuccess: (job) => {
      qc.setQueryData(keys.job(job.id), job)
      void qc.invalidateQueries({ queryKey: keys.tvs })
    },
  })
}

export function useNext() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tv: string) => ok(await api.tvs[":tv"].next.$post({ param: { tv } })),
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
      const job = await ok(await api.jobs[":id"].$get({ param: { id: id! } }))
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
    mutationFn: async (tv: string) => ok(await api.tvs[":tv"].pair.$post({ param: { tv } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.tvs }),
  })
}

export function useSetCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tv, category }: { tv: string; category: string }) =>
      ok(await api.tvs[":tv"].category.$put({ param: { tv }, json: { category } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.tvs }),
  })
}

export const useHistory = () =>
  useQuery({ queryKey: keys.history, queryFn: async () => ok(await api.history.$get({ query: { limit: "120" } })) })

export const useSync = () =>
  useQuery({
    queryKey: keys.sync,
    queryFn: async () => ok(await api.sync.$get()),
    refetchInterval: (q) => (q.state.data?.state === "running" ? 2000 : 15_000),
  })

export function useStartSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => ok(await api.sync.$post()),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.sync }),
  })
}

/** Grid thumbnails: ask IIIF for a smaller image where we can. */
export function gridThumb(a: Pick<ArtworkDTO, "thumb" | "source">): string {
  if (a.source === "rijks") return a.thumb.replace("/full/!800,800/", "/full/!520,520/")
  return a.thumb
}

export const SOURCE_LABEL: Record<ArtworkDTO["source"], string> = {
  met: "The Met",
  rijks: "Rijksmuseum",
  cleveland: "Cleveland Museum of Art",
}

export const MODE_LABEL: Record<Mode, string> = {
  fill: "Vullen (slim bijsnijden)",
  light: "Passe-partout licht",
  dark: "Passe-partout donker",
  blur: "Passe-partout blur",
}
export const MODE_SHORT: Record<Mode, string> = { fill: "Vullen", light: "Licht", dark: "Donker", blur: "Blur" }

export const useCrop = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["crop", id],
    enabled,
    staleTime: Infinity,
    queryFn: async () => ok(await api.artworks[":id"].crop.$get({ param: { id } })),
  })

export function useSetDisplay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      tv,
      display,
      matteStyle,
    }: {
      tv: string
      display: "fill" | "matte"
      matteStyle: "light" | "dark" | "blur"
    }) => ok(await api.tvs[":tv"].display.$put({ param: { tv }, json: { display, matteStyle } })),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.tvs }),
  })
}

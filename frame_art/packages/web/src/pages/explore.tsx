import { mdiArrowRight, mdiDiceMultipleOutline, mdiMagnify, mdiShuffleVariant, mdiSortClockDescending } from "@mdi/js"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { ArtworkCard, ArtworkGrid } from "@/components/artwork-grid"
import { FacetBar } from "@/components/facets"
import { Alert, Button, Icon, Spinner, TextField } from "@/components/ha"
import { LiveResults } from "@/components/live-results"
import { CreateSeriesButton } from "@/components/series"
import { NowShowing } from "@/components/tv-actions"
import {
  isFiltering,
  randomArtwork,
  useArtworks,
  useLanding,
  useSync,
  type ArtworkDTO,
  type BrowseFilters,
} from "@/lib/api"
import { useT } from "@/lib/i18n"

/** A horizontal row of large cards on the landing: a collection, the newest, or the popular works. */
function Row({ title, items, onAll }: { title: string; items: ArtworkDTO[]; onAll?: () => void }) {
  const t = useT()
  if (!items.length) return null
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">{title}</h2>
        {onAll && (
          <button type="button" onClick={onAll} className="inline-flex items-center gap-1 text-sm text-primary">
            {t.seeAll}
            <Icon path={mdiArrowRight} size={16} />
          </button>
        )}
      </div>
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 scrollbar-none sm:mx-0 sm:px-0">
        {items.map((a) => (
          <div key={a.id} className="w-56 shrink-0 snap-start sm:w-64">
            <ArtworkCard art={a} />
          </div>
        ))}
      </div>
    </section>
  )
}

function Landing({ set }: { set: (patch: Partial<BrowseFilters>) => void }) {
  const t = useT()
  const landing = useLanding()
  if (landing.isLoading) return <Spinner />
  const l = landing.data
  if (!l) return null
  return (
    <div className="space-y-6">
      <Row title={t.popular} items={l.popular} />
      <Row title={t.newest} items={l.newest} onAll={() => set({ sort: "new" })} />
      {l.collections.map((c) => (
        <Row key={c.id} title={c.title} items={c.items} onAll={() => set({ collection: [c.id] })} />
      ))}
      <Button appearance="filled" onClick={() => set({ sort: "shuffle", seed: Math.floor(Math.random() * 1e6) })}>
        {t.browseAll}
      </Button>
    </div>
  )
}

export function ExplorePage({ filters }: { filters: BrowseFilters }) {
  const t = useT()
  const navigate = useNavigate({ from: "/" })
  const sync = useSync()
  const [q, setQ] = useState(filters.q ?? "")
  const [surprising, setSurprising] = useState(false)
  const filtering = isFiltering(filters)
  const works = useArtworks(filters, filtering)
  const items = filtering ? (works.data?.pages.flatMap((p) => p.items) ?? []) : []
  const first = works.data?.pages[0]
  const total = first?.total ?? 0

  const set = useCallback(
    (patch: Partial<BrowseFilters>) =>
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false }),
    [navigate],
  )
  // Search as you type, a moment after the last key.
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((filters.q ?? "") !== q.trim()) set({ q: q.trim() || undefined })
    }, 250)
    return () => clearTimeout(timer)
  }, [q, filters.q, set])

  const surprise = async () => {
    setSurprising(true)
    try {
      const art = await randomArtwork(filters)
      await navigate({ to: "/art/$id", params: { id: art.id } })
    } catch {
      setSurprising(false)
    }
  }

  const empty = sync.data && sync.data.total === 0

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label={t.tabExplore}>
        <div className="flex flex-wrap items-center gap-2">
          <TextField
            value={q}
            onChange={setQ}
            label={t.search}
            icon={mdiMagnify}
            type="search"
            className="min-w-[220px] flex-1"
          />
          <Button onClick={surprise} disabled={surprising}>
            {surprising ? <Spinner size={18} /> : <Icon path={mdiDiceMultipleOutline} size={18} />}
            {t.surprise}
          </Button>
        </div>
        <FacetBar filters={filters} set={set} />
      </section>

      {empty ? (
        <Alert type="info">{t.buildingCatalogue}</Alert>
      ) : !filtering ? (
        <>
          <NowShowing />
          <Landing set={set} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text2">
            <span aria-live="polite">{t.works(total)}</span>
            {first?.fuzzy && <span>· {t.closeMatches}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-1">
              <Button
                appearance="plain"
                onClick={() => set({ sort: "shuffle", seed: Math.floor(Math.random() * 1e6) })}
              >
                <Icon path={mdiShuffleVariant} size={18} />
                {t.shuffle2}
              </Button>
              <Button
                appearance="plain"
                onClick={() => set({ sort: filters.sort === "new" ? undefined : "new", seed: undefined })}
              >
                <Icon path={mdiSortClockDescending} size={18} />
                {t.sortNew}
              </Button>
              {total > 0 && (
                <CreateSeriesButton
                  label={t.seriesFromResults}
                  name={filters.q ?? filters.artist ?? t.series}
                  from={{ query: filters }}
                />
              )}
            </span>
          </div>
          {!works.isLoading && !items.length ? (
            <Alert type="info">{t.nothingFound}</Alert>
          ) : (
            <ArtworkGrid
              items={items}
              hasMore={Boolean(works.hasNextPage)}
              loading={works.isLoading || works.isFetchingNextPage}
              loadMore={() => void works.fetchNextPage()}
            />
          )}
          {filters.q && filters.q.length >= 2 && <LiveResults key={filters.q} q={filters.q} />}
        </>
      )}
    </div>
  )
}

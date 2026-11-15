import { mdiDiceMultipleOutline, mdiMagnify } from "@mdi/js"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"

import { ArtworkGrid } from "@/components/artwork-grid"
import { Alert, Button, Chip, cn, Icon, Select, Spinner, Switch, TextField } from "@/components/ha"
import { CreateSeriesButton } from "@/components/series"
import { NowShowing } from "@/components/tv-actions"
import { randomArtwork, useArtworks, useConfig, useSync, type BrowseFilters } from "@/lib/api"
import { useLanguage } from "@/lib/hass"
import { useT } from "@/lib/i18n"

export const SWATCH: Record<string, string> = {
  red: "#c0392b",
  gold: "#d4a537",
  brown: "#7b5230",
  green: "#3f7f4a",
  blue: "#3b6ea8",
  dark: "#262626",
  light: "#ece8e1",
}

export function ExplorePage({ filters }: { filters: BrowseFilters }) {
  const t = useT()
  const lang = useLanguage()
  const navigate = useNavigate({ from: "/" })
  const config = useConfig()
  const sync = useSync()
  const [q, setQ] = useState(filters.q ?? "")
  const [surprising, setSurprising] = useState(false)
  const works = useArtworks(filters)
  const items = works.data?.pages.flatMap((p) => p.items) ?? []
  const total = works.data?.pages[0]?.total ?? 0

  const set = useCallback(
    (patch: Partial<BrowseFilters>) =>
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false }),
    [navigate],
  )
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((filters.q ?? "") !== q) set({ q: q || undefined })
    }, 280)
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
      <NowShowing />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <TextField
            value={q}
            onChange={setQ}
            label={t.search}
            icon={mdiMagnify}
            type="search"
            className="min-w-[220px] flex-1"
          />
          <Select
            label={t.source}
            value={filters.source ?? ""}
            onChange={(v) => set({ source: v || undefined })}
            options={[
              { value: "", label: t.allSources },
              ...(config.data?.sources ?? []).map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <Button onClick={surprise} disabled={surprising}>
            {surprising ? <Spinner size={18} /> : <Icon path={mdiDiceMultipleOutline} size={18} />}
            {t.surprise}
          </Button>
        </div>

        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip active={!filters.cat} onClick={() => set({ cat: undefined })}>
            {t.all}
          </Chip>
          {config.data?.categories.map((c) => (
            <Chip
              key={c.id}
              active={filters.cat === c.id}
              onClick={() => set({ cat: filters.cat === c.id ? undefined : c.id })}
            >
              {c.label[lang]}
              {c.count > 0 && <span className="text-xs text-text2">{c.count.toLocaleString(lang)}</span>}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5" role="group" aria-label="Colour">
            {config.data?.colors.map((c) => (
              <button
                key={c}
                type="button"
                title={t.colors[c] ?? c}
                aria-label={t.colors[c] ?? c}
                aria-pressed={filters.color === c}
                onClick={() => set({ color: filters.color === c ? undefined : c })}
                className={cn(
                  "size-6 rounded-full border border-divider transition-transform hover:scale-110",
                  filters.color === c && "ring-2 ring-primary ring-offset-2 ring-offset-bg",
                )}
                style={{ background: SWATCH[c] }}
              />
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={!filters.all}
              onChange={(on) => set({ all: on ? undefined : true })}
              label={t.landscapeOnly}
            />
            {t.landscapeOnly}
          </label>
          <span className="ml-auto flex items-center gap-2 text-sm text-text2">
            {(filters.q || filters.cat || filters.color || filters.source) && total > 0 && (
              <CreateSeriesButton
                label={t.seriesFromResults}
                name={
                  filters.q ??
                  config.data?.categories.find((c) => c.id === filters.cat)?.label[lang] ??
                  filters.source ??
                  t.series
                }
                from={{ query: filters }}
              />
            )}
            {t.works(total)}
          </span>
        </div>
      </section>

      {empty ? (
        <Alert type="info">{t.buildingCatalogue}</Alert>
      ) : !works.isLoading && !items.length ? (
        <Alert type="info">{t.nothingFound}</Alert>
      ) : (
        <ArtworkGrid
          items={items}
          hasMore={Boolean(works.hasNextPage)}
          loading={works.isLoading || works.isFetchingNextPage}
          loadMore={() => void works.fetchNextPage()}
        />
      )}
    </div>
  )
}

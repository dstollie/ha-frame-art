import { useNavigate } from "@tanstack/react-router"
import { Loader2, Search, Sparkles, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { ArtworkGrid } from "@/components/artwork-grid"
import { OnTheWall } from "@/components/on-the-wall"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { randomArtwork, useArtworks, useConfig, useSync, type BrowseFilters } from "@/lib/api"
import { cn } from "@/lib/utils"

export const SWATCH: Record<string, string> = {
  rood: "#a5402f",
  goud: "#c9a24a",
  bruin: "#6b4a2b",
  groen: "#3f6b4a",
  blauw: "#3c5a86",
  donker: "#1d1c1a",
  licht: "#e9e3d6",
}

export function DiscoverPage({ filters }: { filters: BrowseFilters }) {
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
    const t = setTimeout(() => {
      if ((filters.q ?? "") !== q) set({ q: q || undefined })
    }, 280)
    return () => clearTimeout(t)
  }, [q, filters.q, set])

  const surprise = async () => {
    setSurprising(true)
    try {
      const art = await randomArtwork(filters)
      await navigate({ to: "/werk/$id", params: { id: art.id } })
    } catch {
      toast.error("Niets gevonden met deze filters")
    } finally {
      setSurprising(false)
    }
  }

  const catalogueEmpty = sync.data && sync.data.total === 0

  return (
    <div className="space-y-10">
      <OnTheWall />

      <section className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-light tracking-tight sm:text-[2.6rem]">
              {config.data?.categories.find((c) => c.id === filters.cat)?.label ?? "Ontdek"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {catalogueEmpty
                ? "De catalogus wordt opgebouwd…"
                : `${total.toLocaleString("nl-NL")} werken${filters.all ? "" : " · liggend"} uit The Met, het Rijksmuseum en Cleveland`}
            </p>
          </div>
          <Button
            size="lg"
            onClick={surprise}
            disabled={surprising}
            className="h-11 rounded-full px-5 shadow-[0_10px_30px_-14px_var(--primary)]"
          >
            {surprising ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Verras me
          </Button>
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip active={!filters.cat} onClick={() => set({ cat: undefined })}>
            Alles
          </Chip>
          {config.data?.categories.map((c) => (
            <Chip
              key={c.id}
              active={filters.cat === c.id}
              onClick={() => set({ cat: filters.cat === c.id ? undefined : c.id })}
            >
              {c.label}
              {c.count > 0 && (
                <span className="ml-1.5 text-[0.7rem] opacity-55">{c.count.toLocaleString("nl-NL")}</span>
              )}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Titel of kunstenaar…"
              className="h-10 rounded-full border-white/[0.07] bg-white/[0.03] pr-9 pl-10"
              aria-label="Zoeken"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Wis zoekopdracht"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Kleur">
            {config.data?.colors.map((c) => (
              <button
                key={c}
                title={c}
                aria-label={`Kleur ${c}`}
                aria-pressed={filters.color === c}
                onClick={() => set({ color: filters.color === c ? undefined : c })}
                className={cn(
                  "size-7 rounded-full ring-offset-2 ring-offset-background transition-all hover:scale-110",
                  filters.color === c ? "ring-2 ring-primary" : "ring-1 ring-white/10",
                )}
                style={{ background: SWATCH[c] }}
              />
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
            <Switch checked={!filters.all} onCheckedChange={(on) => set({ all: on ? undefined : true })} />
            Alleen liggend
          </label>
        </div>
      </section>

      {catalogueEmpty ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 size-5 animate-spin" />
          De eerste keer haalt Frame Art de collecties op. Dat duurt een tijdje; de eerste werken verschijnen zo.
        </div>
      ) : !works.isLoading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          Niets gevonden met deze filters.
        </div>
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full border px-4 py-1.5 text-sm whitespace-nowrap transition-all",
        active
          ? "border-primary/60 bg-primary text-primary-foreground shadow-[0_6px_20px_-10px_var(--primary)]"
          : "border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

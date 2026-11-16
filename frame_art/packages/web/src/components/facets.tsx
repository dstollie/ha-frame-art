import { mdiChevronDown, mdiClose } from "@mdi/js"
import { useState } from "react"

import { Chip, cn, Icon } from "@/components/ha"
import { useFacets, type BrowseFilters, type Orient } from "@/lib/api"
import { useLocale, useT } from "@/lib/i18n"

export const SWATCH: Record<string, string> = {
  red: "#c0392b",
  gold: "#d4a537",
  brown: "#7b5230",
  green: "#3f7f4a",
  blue: "#3b6ea8",
  dark: "#262626",
  light: "#ece8e1",
}

type Key = "collection" | "century" | "artist" | "color" | "orient" | "uhd" | "ai" | "licence"

const toggle = <T,>(list: T[] | undefined, v: T): T[] | undefined => {
  const next = list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]
  return next.length ? next : undefined
}

/**
 * Facets as HA filter chips: one row of buttons; the open one shows its values (with counts) inline
 * underneath. Active filters show as removable chips.
 */
export function FacetBar({ filters, set }: { filters: BrowseFilters; set: (patch: Partial<BrowseFilters>) => void }) {
  const t = useT()
  const locale = useLocale()
  const facets = useFacets(filters)
  const [open, setOpen] = useState<Key | null>(null)
  const f = facets.data
  const n = (x: number) => x.toLocaleString(locale)
  const collectionTitle = (id: string) => f?.collections.find((c) => c.id === id)?.title ?? id

  const active: { key: string; label: string; clear: () => void }[] = [
    ...(filters.collection ?? []).map((id) => ({
      key: `c:${id}`,
      label: collectionTitle(id),
      clear: () => set({ collection: toggle(filters.collection, id) }),
    })),
    ...(filters.century ?? []).map((c) => ({
      key: `p:${c}`,
      label: t.century(c),
      clear: () => set({ century: toggle(filters.century, c) }),
    })),
    ...(filters.artist ? [{ key: "a", label: filters.artist, clear: () => set({ artist: undefined }) }] : []),
    ...(filters.color
      ? [{ key: "k", label: t.colors[filters.color] ?? filters.color, clear: () => set({ color: undefined }) }]
      : []),
    ...(filters.orient && filters.orient !== "landscape"
      ? [{ key: "o", label: t.orient[filters.orient]!, clear: () => set({ orient: undefined }) }]
      : []),
    ...(filters.uhd ? [{ key: "u", label: t.uhdOnly, clear: () => set({ uhd: undefined }) }] : []),
    ...(filters.ai
      ? [{ key: "i", label: filters.ai === "yes" ? t.aiYes : t.aiNo, clear: () => set({ ai: undefined }) }]
      : []),
    ...(filters.licence ?? []).map((l) => ({
      key: `l:${l}`,
      label: l,
      clear: () => set({ licence: toggle(filters.licence, l) }),
    })),
  ]

  const buttons: { key: Key; label: string; on: boolean }[] = [
    { key: "collection", label: t.facetCollection, on: Boolean(filters.collection?.length) },
    { key: "century", label: t.facetPeriod, on: Boolean(filters.century?.length) },
    { key: "artist", label: t.facetArtist, on: Boolean(filters.artist) },
    { key: "color", label: t.facetColour, on: Boolean(filters.color) },
    { key: "orient", label: t.facetOrient, on: Boolean(filters.orient && filters.orient !== "landscape") },
    { key: "uhd", label: t.facetUhd, on: Boolean(filters.uhd) },
    { key: "ai", label: t.facetAi, on: Boolean(filters.ai) },
    { key: "licence", label: t.facetLicence, on: Boolean(filters.licence?.length) },
  ]

  return (
    <div className="space-y-2">
      <div
        className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0"
        role="toolbar"
        aria-label={t.facetCollection}
      >
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-expanded={open === b.key}
            onClick={() => setOpen((o) => (o === b.key ? null : b.key))}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-solid px-3 text-sm",
              b.on || open === b.key
                ? "border-primary bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-text"
                : "border-[var(--color-divider)] text-text",
            )}
          >
            {b.label}
            <Icon
              path={mdiChevronDown}
              size={16}
              className={cn("transition-transform", open === b.key && "rotate-180")}
            />
          </button>
        ))}
      </div>

      {open && f && (
        <div
          className="flex flex-wrap gap-1.5 rounded-lg border border-divider p-2"
          role="group"
          aria-label={buttons.find((b) => b.key === open)!.label}
        >
          {open === "collection" &&
            f.collections.map((c) => (
              <Chip
                key={c.id}
                active={Boolean(filters.collection?.includes(c.id))}
                onClick={() => set({ collection: toggle(filters.collection, c.id) })}
              >
                {c.title} <Count n={n(c.n)} />
              </Chip>
            ))}
          {open === "century" &&
            f.centuries.map((c) => (
              <Chip
                key={c.id}
                active={Boolean(filters.century?.includes(c.id))}
                onClick={() => set({ century: toggle(filters.century, c.id) })}
              >
                {t.century(c.id)} <Count n={n(c.n)} />
              </Chip>
            ))}
          {open === "artist" &&
            f.artists.map((a) => (
              <Chip
                key={a.id}
                active={filters.artist === a.id}
                onClick={() => set({ artist: filters.artist === a.id ? undefined : a.id })}
              >
                {a.id} <Count n={n(a.n)} />
              </Chip>
            ))}
          {open === "color" &&
            f.colors
              .filter((c) => c.id !== "unknown")
              .map((c) => (
                <Chip
                  key={c.id}
                  active={filters.color === c.id}
                  onClick={() => set({ color: filters.color === c.id ? undefined : c.id })}
                >
                  <span className="size-3.5 rounded-full border border-divider" style={{ background: SWATCH[c.id] }} />
                  {t.colors[c.id] ?? c.id} <Count n={n(c.n)} />
                </Chip>
              ))}
          {open === "orient" &&
            (["landscape", "portrait", "square", "all"] as Orient[]).map((o) => {
              const count =
                o === "all" ? f.orient.reduce((s, x) => s + x.n, 0) : (f.orient.find((x) => x.id === o)?.n ?? 0)
              return (
                <Chip
                  key={o}
                  active={(filters.orient ?? "landscape") === o}
                  onClick={() => set({ orient: o === "landscape" ? undefined : o })}
                >
                  {t.orient[o]} <Count n={n(count)} />
                </Chip>
              )
            })}
          {open === "uhd" && (
            <Chip active={Boolean(filters.uhd)} onClick={() => set({ uhd: filters.uhd ? undefined : true })}>
              {t.uhdOnly} <Count n={n(f.uhd.find((x) => x.id)?.n ?? 0)} />
            </Chip>
          )}
          {open === "ai" &&
            (["yes", "no"] as const).map((v) => (
              <Chip key={v} active={filters.ai === v} onClick={() => set({ ai: filters.ai === v ? undefined : v })}>
                {v === "yes" ? t.aiYes : t.aiNo} <Count n={n(f.ai.find((x) => x.id === (v === "yes"))?.n ?? 0)} />
              </Chip>
            ))}
          {open === "licence" &&
            f.licences.map((l) => (
              <Chip
                key={l.id}
                active={Boolean(filters.licence?.includes(l.id))}
                onClick={() => set({ licence: toggle(filters.licence, l.id) })}
              >
                {l.id} <Count n={n(l.n)} />
              </Chip>
            ))}
        </div>
      )}

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {active.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.clear}
              aria-label={t.removeFilter(a.label)}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] pr-1.5 pl-3 text-sm text-text"
            >
              {a.label}
              <Icon path={mdiClose} size={16} />
            </button>
          ))}
          <button
            type="button"
            className="text-sm text-primary"
            onClick={() =>
              set({
                collection: undefined,
                century: undefined,
                artist: undefined,
                color: undefined,
                orient: undefined,
                uhd: undefined,
                ai: undefined,
                licence: undefined,
                cat: undefined,
              })
            }
          >
            {t.clearAll}
          </button>
        </div>
      )}
    </div>
  )
}

function Count({ n }: { n: string }) {
  return <span className="text-xs text-text2">{n}</span>
}

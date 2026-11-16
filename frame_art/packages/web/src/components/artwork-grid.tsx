import { mdiCheck, mdiHeart, mdiMonitorArrowDown, mdiPlaylistPlus, mdiPlaylistStar, mdiRobotOutline } from "@mdi/js"
import { Link } from "@tanstack/react-router"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Chip, cn, Icon, Spinner } from "@/components/ha"
import { useSeriesList, useSeriesMutations, useShow, useThumb, useTvs, type ArtworkDTO } from "@/lib/api"
import { useT } from "@/lib/i18n"

function columnsFor(width: number) {
  return width >= 1500 ? 5 : width >= 1100 ? 4 : width >= 720 ? 3 : 2
}

function useColumns(ref: React.RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(3)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setCols(columnsFor(e!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return cols
}

const quickBtn =
  "inline-flex size-9 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-card)_88%,transparent)] text-text shadow-[0_1px_4px_rgb(0_0_0/0.25)] hover:text-primary"

const stop = (e: React.SyntheticEvent) => {
  e.preventDefault()
  e.stopPropagation()
}

/** On a card: show on the first TV, add to a series, or start a new one, without leaving the grid. */
function QuickActions({ art }: { art: ArtworkDTO }) {
  const t = useT()
  const tvs = useTvs()
  const show = useShow()
  const series = useSeriesList()
  const ops = useSeriesMutations()
  const [panel, setPanel] = useState<"add" | "new" | null>(null)
  const [name, setName] = useState("")
  const [done, setDone] = useState<string | null>(null)
  const tv = tvs.data?.find((x) => x.paired)
  return (
    <>
      <div
        className="absolute top-2 right-2 flex gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        role="group"
        aria-label={t.quickActions}
      >
        {tv && (
          <button
            type="button"
            className={quickBtn}
            title={t.quickShow(tv.name)}
            aria-label={`${t.quickShow(tv.name)}: ${art.title}`}
            onClick={(e) => {
              stop(e)
              show.mutate({ tv: tv.id, artworkId: art.id }, { onSuccess: () => setDone(t.jobBusy(tv.name)) })
            }}
          >
            {show.isPending ? <Spinner size={16} /> : <Icon path={mdiMonitorArrowDown} size={18} />}
          </button>
        )}
        <button
          type="button"
          className={quickBtn}
          title={t.addToSeries}
          aria-label={`${t.addToSeries}: ${art.title}`}
          aria-expanded={panel === "add"}
          onClick={(e) => {
            stop(e)
            setPanel((p) => (p === "add" ? null : "add"))
          }}
        >
          <Icon path={mdiPlaylistStar} size={18} />
        </button>
        <button
          type="button"
          className={quickBtn}
          title={t.newSeries}
          aria-label={`${t.newSeries}: ${art.title}`}
          aria-expanded={panel === "new"}
          onClick={(e) => {
            stop(e)
            setPanel((p) => (p === "new" ? null : "new"))
          }}
        >
          <Icon path={mdiPlaylistPlus} size={18} />
        </button>
      </div>
      {(panel || done) && (
        // Inside the card, over the image: no dialog, the grid stays where it is.
        <div
          className="absolute inset-x-2 top-13 z-10 space-y-1.5 rounded-lg bg-card p-2 shadow-[0_2px_10px_rgb(0_0_0/0.3)]"
          onClick={(e) => e.stopPropagation()}
        >
          {done && !panel && (
            <p role="status" className="flex items-center gap-1 text-xs text-success">
              <Icon path={mdiCheck} size={14} />
              {done}
            </p>
          )}
          {panel === "add" && (
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {series.data?.length ? (
                series.data.map((s) => (
                  <Chip
                    key={s.id}
                    active={false}
                    onClick={() =>
                      ops.toggleItem.mutate(
                        { id: s.id, artworkId: art.id, on: true },
                        {
                          onSuccess: () => {
                            setPanel(null)
                            setDone(t.addedTo(s.name))
                          },
                        },
                      )
                    }
                  >
                    {s.name}
                  </Chip>
                ))
              ) : (
                <p className="text-xs text-text2">{t.noSeries}</p>
              )}
            </div>
          )}
          {panel === "new" && (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                stop(e)
                if (!name.trim()) return
                ops.create.mutate(
                  { name: name.trim(), from: { artworkIds: [art.id] } },
                  {
                    onSuccess: (s) => {
                      setPanel(null)
                      setName("")
                      setDone(t.addedTo(s.name))
                    },
                  },
                )
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.seriesName}
                aria-label={t.seriesName}
                className="h-8 min-w-0 flex-1 rounded-md border border-solid border-[var(--color-divider)] bg-card px-2 text-sm text-text outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="h-8 rounded-md bg-primary px-2 text-sm text-[var(--text-primary-color,#fff)]"
              >
                {t.create}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  )
}

export function ArtworkCard({ art, quick = true }: { art: ArtworkDTO; quick?: boolean }) {
  const src = useThumb(art)
  const [loaded, setLoaded] = useState(false)
  const t = useT()
  return (
    <div className="card group relative flex flex-col overflow-hidden transition-shadow hover:shadow-[0_2px_8px_rgb(0_0_0/0.15)]">
      <Link
        to="/art/$id"
        params={{ id: art.id }}
        data-card
        className="flex flex-col outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-bg2">
          {src && (
            <img
              src={src}
              alt={art.title}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              className={cn(
                "absolute inset-0 size-full object-cover transition-opacity duration-300",
                loaded ? "opacity-100" : "opacity-0",
              )}
            />
          )}
          <span className="absolute bottom-2 left-2 flex gap-1">
            {art.favourite && (
              <Icon path={mdiHeart} size={18} className="text-[var(--state-icon-active-color,#e91e63)] drop-shadow" />
            )}
            {art.ai && (
              <span title={t.aiMade} className="rounded-full bg-card p-0.5 text-text">
                <Icon path={mdiRobotOutline} size={14} />
              </span>
            )}
          </span>
        </div>
        <div className="min-w-0 px-3 py-2">
          <p className="truncate text-sm font-medium">{art.title}</p>
          <p className="truncate text-xs text-text2">{[art.artist, art.date].filter(Boolean).join(" · ") || " "}</p>
        </div>
      </Link>
      {quick && <QuickActions art={art} />}
    </div>
  )
}

/** Arrow keys move between cards, row by row; Enter opens one. */
function moveFocus(e: React.KeyboardEvent<HTMLDivElement>, cols: number) {
  const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } as Record<string, number>)[e.key]
  if (!step) return
  const cards = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-card]")]
  const at = cards.indexOf(e.target as HTMLAnchorElement)
  const next = at < 0 ? undefined : cards[at + step]
  if (!next) return
  e.preventDefault()
  next.focus()
  next.scrollIntoView({ block: "nearest" })
}

/** Virtualised by row: thousands of works stay smooth on a phone. */
export function ArtworkGrid({
  items,
  hasMore,
  loadMore,
  loading,
  quick = true,
}: {
  items: ArtworkDTO[]
  hasMore: boolean
  loadMore: () => void
  loading: boolean
  quick?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const cols = useColumns(ref)
  const [offset, setOffset] = useState(0)
  useLayoutEffect(() => setOffset(ref.current ? ref.current.getBoundingClientRect().top + window.scrollY : 0), [])
  const rows = useMemo(() => {
    const out: ArtworkDTO[][] = []
    for (let i = 0; i < items.length; i += cols) out.push(items.slice(i, i + cols))
    return out
  }, [items, cols])

  const virtualizer = useWindowVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    estimateSize: () => ((ref.current?.clientWidth ?? 900) / cols) * 0.75 + 64,
    overscan: 4,
    scrollMargin: offset,
  })
  const virtual = virtualizer.getVirtualItems()
  const last = virtual.at(-1)

  useEffect(() => {
    if (last && last.index >= rows.length - 1 && hasMore && !loading) loadMore()
  }, [last, rows.length, hasMore, loading, loadMore])

  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
      onKeyDown={(e) => moveFocus(e, cols)}
    >
      {virtual.map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute top-0 left-0 grid w-full gap-3 pb-3"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
          }}
        >
          {row.index < rows.length
            ? rows[row.index]!.map((art) => <ArtworkCard key={art.id} art={art} quick={quick} />)
            : Array.from({ length: cols }, (_, i) => <div key={i} className="card aspect-[4/3] animate-pulse" />)}
        </div>
      ))}
    </div>
  )
}

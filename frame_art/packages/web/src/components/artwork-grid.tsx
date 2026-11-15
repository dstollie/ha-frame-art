import { mdiHeart } from "@mdi/js"
import { Link } from "@tanstack/react-router"
import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { cn, Icon } from "@/components/ha"
import { useThumb, type ArtworkDTO } from "@/lib/api"

function columnsFor(width: number) {
  return width >= 1400 ? 6 : width >= 1100 ? 5 : width >= 820 ? 4 : width >= 560 ? 3 : 2
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

export function ArtworkCard({ art }: { art: ArtworkDTO }) {
  const src = useThumb(art)
  const [loaded, setLoaded] = useState(false)
  return (
    <Link
      to="/art/$id"
      params={{ id: art.id }}
      className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-[0_2px_8px_rgb(0_0_0/0.15)]"
    >
      <div className="relative flex aspect-[4/3] items-center justify-center bg-bg2 p-3">
        {src && (
          <img
            src={src}
            alt={art.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            className={cn(
              "max-h-full max-w-full object-contain shadow-[0_2px_6px_rgb(0_0_0/0.25)] transition-opacity duration-300",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        )}
        {art.favourite && (
          <Icon
            path={mdiHeart}
            size={18}
            className="absolute top-2 right-2 text-[var(--state-icon-active-color,#e91e63)]"
          />
        )}
      </div>
      <div className="min-w-0 px-3 py-2">
        <p className="truncate text-sm font-medium">{art.title}</p>
        <p className="truncate text-xs text-text2">{[art.artist, art.date].filter(Boolean).join(" · ") || " "}</p>
      </div>
    </Link>
  )
}

/** Virtualised by row: thousands of works stay smooth on a phone. */
export function ArtworkGrid({
  items,
  hasMore,
  loadMore,
  loading,
}: {
  items: ArtworkDTO[]
  hasMore: boolean
  loadMore: () => void
  loading: boolean
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
    <div ref={ref} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
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
            ? rows[row.index]!.map((art) => <ArtworkCard key={art.id} art={art} />)
            : Array.from({ length: cols }, (_, i) => <div key={i} className="card aspect-[4/3] animate-pulse" />)}
        </div>
      ))}
    </div>
  )
}

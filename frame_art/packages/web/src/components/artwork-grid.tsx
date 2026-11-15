import { useWindowVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { ArtworkCard } from "@/components/artwork-card"
import { Skeleton } from "@/components/ui/skeleton"
import type { ArtworkDTO } from "@/lib/api"

function columnsFor(width: number) {
  return width >= 1536 ? 5 : width >= 1180 ? 4 : width >= 760 ? 3 : 2
}

function useColumns() {
  const [cols, setCols] = useState(() => columnsFor(window.innerWidth))
  useEffect(() => {
    const on = () => setCols(columnsFor(window.innerWidth))
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  return cols
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
  const cols = useColumns()
  const parentRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  useLayoutEffect(() => setOffset(parentRef.current?.offsetTop ?? 0), [])
  const rows = useMemo(() => {
    const out: ArtworkDTO[][] = []
    for (let i = 0; i < items.length; i += cols) out.push(items.slice(i, i + cols))
    return out
  }, [items, cols])

  const virtualizer = useWindowVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    estimateSize: () => (window.innerWidth / cols) * 0.75 + 70,
    overscan: 4,
    scrollMargin: offset,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const last = virtualRows.at(-1)

  useEffect(() => {
    if (last && last.index >= rows.length - 1 && hasMore && !loading) loadMore()
  }, [last, rows.length, hasMore, loading, loadMore])

  if (loading && items.length === 0) {
    return (
      <div className="grid gap-3 sm:gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols * 3 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="aspect-[4/3] w-full rounded-xl" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={parentRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualRows.map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute top-0 left-0 grid w-full gap-3 pb-3 sm:gap-4 sm:pb-4"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
          }}
        >
          {row.index < rows.length
            ? rows[row.index]!.map((art) => <ArtworkCard key={art.id} art={art} />)
            : Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />)}
        </div>
      ))}
    </div>
  )
}

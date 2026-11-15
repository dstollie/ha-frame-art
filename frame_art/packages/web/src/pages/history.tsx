import { Link } from "@tanstack/react-router"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { MODE_LABEL, gridThumb, useConfig, useHistory, type HistoryItem } from "@/lib/api"

function dayLabel(ts: number) {
  const d = new Date(ts * 1000)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return "Vandaag"
  if (d.toDateString() === yesterday.toDateString()) return "Gisteren"
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })
}

export function HistoryPage() {
  const history = useHistory()
  const config = useConfig()
  const tvName = (id: string) => config.data?.tvs.find((t) => t.id === id)?.name ?? id
  const groups = new Map<string, HistoryItem[]>()
  for (const h of history.data ?? []) {
    const k = dayLabel(h.shownAt)
    groups.set(k, [...(groups.get(k) ?? []), h])
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-light tracking-tight sm:text-[2.6rem]">Geschiedenis</h1>
        <p className="mt-1 text-sm text-muted-foreground">Wat er wanneer aan de muur hing.</p>
      </header>
      {history.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
      {history.data?.length === 0 && <p className="text-muted-foreground">Nog niets getoond.</p>}
      {[...groups].map(([day, items]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase first-letter:uppercase">
            {day}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40">
            {items.map((h) => (
              <li key={h.id}>
                <Link
                  to="/werk/$id"
                  params={{ id: h.artwork.id }}
                  search={{ mode: h.mode }}
                  className="flex items-center gap-4 p-3 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/30">
                    <img
                      src={gridThumb(h.artwork)}
                      alt=""
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display">{h.artwork.title}</p>
                    <p className="truncate text-sm text-muted-foreground">{h.artwork.artist}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="secondary" className="rounded-full font-normal">
                      {tvName(h.tv)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.shownAt * 1000).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                      {MODE_LABEL[h.mode].toLowerCase()}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

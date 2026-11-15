import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { Alert, Card } from "@/components/ha"
import { useConfig, useHistory, useThumb, type HistoryItem } from "@/lib/api"
import { useLocale, useT } from "@/lib/i18n"

function Row({ h }: { h: HistoryItem }) {
  const locale = useLocale()
  const config = useConfig()
  const src = useThumb(h.artwork)
  const tv = config.data?.tvs.find((x) => x.id === h.tv)?.name ?? h.tv
  return (
    <li>
      <Link
        to="/art/$id"
        params={{ id: h.artwork.id }}
        search={{ mode: h.mode }}
        className="flex items-center gap-3 px-4 py-2 hover:bg-bg2"
      >
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded bg-bg2">
          {src && (
            <img
              src={src}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{h.artwork.title}</p>
          <p className="truncate text-sm text-text2">{h.artwork.artist}</p>
        </div>
        <div className="shrink-0 text-right text-sm text-text2">
          <p>{tv}</p>
          <p>{new Date(h.shownAt * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      </Link>
    </li>
  )
}

export function HistoryPage() {
  const t = useT()
  const locale = useLocale()
  const history = useHistory()
  const [now] = useState(() => Date.now())
  const label = (ts: number) => {
    const d = new Date(ts * 1000)
    if (d.toDateString() === new Date(now).toDateString()) return t.today
    if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return t.yesterday
    return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })
  }
  const groups = new Map<string, HistoryItem[]>()
  for (const h of history.data ?? []) groups.set(label(h.shownAt), [...(groups.get(label(h.shownAt)) ?? []), h])

  if (history.data && !history.data.length) return <Alert type="info">{t.emptyHistory}</Alert>
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {[...groups].map(([day, items]) => (
        <Card key={day} header={<span className="first-letter:uppercase">{day}</span>}>
          <ul className="divide-y divide-divider pb-2">
            {items.map((h) => (
              <Row key={h.id} h={h} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

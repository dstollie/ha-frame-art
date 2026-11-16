import { mdiCheck, mdiGithub, mdiMagnify, mdiTrayArrowDown } from "@mdi/js"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { Alert, Button, Card, Icon, Spinner } from "@/components/ha"
import { useLive, useSaveLive, type LiveGroup } from "@/lib/api"
import { useT } from "@/lib/i18n"

type Result = LiveGroup["results"][number]

function LiveCard({ r, museum }: { r: Result; museum: string }) {
  const t = useT()
  const save = useSaveLive()
  const a = r.artwork
  const saved = r.saved || save.isSuccess
  return (
    <li className="space-y-1.5" aria-label={a.title}>
      {a.thumb ? (
        <img
          src={a.thumb}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="aspect-[4/3] w-full rounded object-cover"
        />
      ) : (
        <div className="aspect-[4/3] rounded bg-bg2" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{a.title}</p>
        <p className="truncate text-xs text-text2">
          {[a.artist, a.date].filter(Boolean).join(" · ")} · {museum}
        </p>
      </div>
      {r.inCatalogue ? (
        <Link
          to="/art/$id"
          params={{ id: r.inCatalogue }}
          className="inline-flex items-center gap-1 text-xs text-success"
        >
          <Icon path={mdiCheck} size={14} />
          {t.alreadyInCatalogue}
        </Link>
      ) : (
        <div className="flex flex-wrap gap-1">
          {saved ? (
            <Link to="/art/$id" params={{ id: a.id }} className="inline-flex items-center gap-1 text-xs text-success">
              <Icon path={mdiCheck} size={14} />
              {t.savedToCollection}
            </Link>
          ) : (
            <Button appearance="plain" disabled={save.isPending} onClick={() => save.mutate(a.id)}>
              <Icon path={mdiTrayArrowDown} size={16} />
              {t.saveToCollection}
            </Button>
          )}
          {r.proposeUrl && (
            <a
              href={r.proposeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm text-primary hover:bg-bg2"
            >
              <Icon path={mdiGithub} size={16} />
              {t.propose}
            </a>
          )}
        </div>
      )}
    </li>
  )
}

/** Live search in the museums, on request: their APIs are slow and we don't want to hit them per keystroke. */
export function LiveResults({ q }: { q: string }) {
  const t = useT()
  const [asked, setAsked] = useState<string | null>(null)
  const live = useLive(asked === q ? q : null)
  return (
    <Card className="space-y-3 p-4" label={t.liveTitle(q)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">{t.liveTitle(q)}</h2>
          <p className="text-sm text-text2">{t.liveHelp}</p>
        </div>
        {asked !== q && (
          <Button appearance="filled" onClick={() => setAsked(q)}>
            <Icon path={mdiMagnify} size={18} />
            {t.liveSearch}
          </Button>
        )}
      </div>
      {live.isFetching && <Spinner />}
      {live.error && <Alert type="error">{live.error.message}</Alert>}
      {live.data?.map((g) => (
        <section key={g.id} aria-label={g.name} className="space-y-2">
          <h3 className="text-sm font-medium text-text2">{g.name}</h3>
          {g.error && <p className="text-xs text-error">{g.error}</p>}
          {!g.error && g.results.length === 0 && <p className="text-xs text-text2">{t.liveNone}</p>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {g.results.map((r) => (
              <LiveCard key={r.artwork.id} r={r} museum={g.name} />
            ))}
          </ul>
        </section>
      ))}
    </Card>
  )
}

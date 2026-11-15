import { mdiPlaylistPlay } from "@mdi/js"
import { Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { Button, Card, cn, Icon, TextField } from "@/components/ha"
import { PlaybackPanel } from "@/components/series"
import { useSeriesList, useSeriesMutations, useThumb, useTvs, type SeriesSummary } from "@/lib/api"
import { useT } from "@/lib/i18n"

function SeriesCard({ s }: { s: SeriesSummary }) {
  const t = useT()
  const src = useThumb(s.cover)
  const tvs = useTvs()
  const playing = s.playingOn.map((id) => tvs.data?.find((tv) => tv.id === id)?.name ?? id)
  return (
    <Link to="/series/$id" params={{ id: s.id }} className="block">
      <Card className="h-full transition-shadow hover:shadow-md">
        {src ? (
          <img src={src} alt="" className="aspect-video w-full object-cover" />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-bg2 text-text2">
            <Icon path={mdiPlaylistPlay} size={36} />
          </div>
        )}
        <div className="space-y-0.5 p-3">
          <p className="truncate font-medium">{s.name}</p>
          <p className="text-sm text-text2">
            {t.worksCount(s.count)} · {t.each(t.duration(s.duration))}
          </p>
          <p className="text-xs text-text2">{t.total(t.duration(s.totalDuration))}</p>
          {playing.length > 0 && (
            <p className="flex items-center gap-1.5 pt-1 text-xs text-success">
              <span className="size-2 rounded-full bg-success" />
              {playing.map((n) => t.playingOn(n)).join(", ")}
            </p>
          )}
        </div>
      </Card>
    </Link>
  )
}

export function SeriesPage() {
  const t = useT()
  const list = useSeriesList()
  const tvs = useTvs()
  const ops = useSeriesMutations()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const create = () => {
    if (!name.trim()) return
    ops.create.mutate(
      { name: name.trim() },
      { onSuccess: (s) => void navigate({ to: "/series/$id", params: { id: s.id } }) },
    )
  }
  const playing = tvs.data?.filter((tv) => tv.playback) ?? []

  return (
    <div className="space-y-5">
      {playing.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {playing.map((tv) => (
            <PlaybackPanel key={tv.id} tvId={tv.id} tv={tv.name} playback={tv.playback!} showSeries />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text2">{t.seriesHelp}</p>
        <Button appearance={adding ? "filled" : "outlined"} onClick={() => setAdding((a) => !a)}>
          {t.newSeries}
        </Button>
      </div>
      {adding && (
        <div className="flex max-w-lg gap-2">
          <TextField label={t.seriesName} value={name} onChange={setName} onEnter={create} className="flex-1" />
          <Button appearance="accent" onClick={create} disabled={!name.trim()}>
            {t.create}
          </Button>
        </div>
      )}

      {list.data && list.data.length === 0 && <p className="text-sm text-text2">{t.noSeries}</p>}
      <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
        {list.data?.map((s) => (
          <SeriesCard key={s.id} s={s} />
        ))}
      </div>
    </div>
  )
}

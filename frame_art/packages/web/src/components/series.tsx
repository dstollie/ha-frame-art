import { mdiPause, mdiPlay, mdiPlaylistPlus, mdiPlaylistStar, mdiSkipNext, mdiStop } from "@mdi/js"
import { Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { Alert, Button, Chip, cn, Icon, Spinner, TextField } from "@/components/ha"
import {
  usePlaybackControl,
  useSeriesList,
  useSeriesMutations,
  useThumb,
  type ArtworkDTO,
  type Playback,
  type SeriesSource,
} from "@/lib/api"
import { useLocale, useT } from "@/lib/i18n"

/** On a work: add it to a series, or start a new series with it. Inline, no dialog. */
export function SeriesActions({ artworkId, inSeries }: { artworkId: string; inSeries: string[] }) {
  const t = useT()
  const [open, setOpen] = useState<"add" | "new" | null>(null)
  const [name, setName] = useState("")
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)
  const list = useSeriesList()
  const ops = useSeriesMutations()
  const toggle = (which: "add" | "new") => {
    setCreated(null)
    setOpen((o) => (o === which ? null : which))
  }
  const create = () => {
    if (!name.trim()) return
    ops.create.mutate(
      { name: name.trim(), from: { artworkIds: [artworkId] } },
      {
        onSuccess: (s) => {
          setCreated({ id: s.id, name: s.name })
          setName("")
          setOpen(null)
        },
      },
    )
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button appearance={open === "add" ? "filled" : "outlined"} onClick={() => toggle("add")}>
          <Icon path={mdiPlaylistStar} size={18} />
          {t.addToSeries}
        </Button>
        <Button appearance={open === "new" ? "filled" : "outlined"} onClick={() => toggle("new")}>
          <Icon path={mdiPlaylistPlus} size={18} />
          {t.newSeries}
        </Button>
      </div>
      {open === "add" && (
        <div className="rounded-lg border border-divider p-3">
          {list.data?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {list.data.map((s) => {
                const on = inSeries.includes(s.id)
                return (
                  <Chip key={s.id} active={on} onClick={() => ops.toggleItem.mutate({ id: s.id, artworkId, on: !on })}>
                    {s.name}
                  </Chip>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-text2">{t.noSeries}</p>
          )}
        </div>
      )}
      {open === "new" && (
        <div className="flex gap-2 rounded-lg border border-divider p-3">
          <TextField label={t.seriesName} value={name} onChange={setName} onEnter={create} className="flex-1" />
          <Button appearance="accent" onClick={create} disabled={!name.trim() || ops.create.isPending}>
            {t.create}
          </Button>
        </div>
      )}
      {created && (
        <Alert type="success">
          {t.addedTo(created.name)}{" "}
          <Link to="/series/$id" params={{ id: created.id }} className="font-medium text-primary underline">
            {t.openSeries}
          </Link>
        </Alert>
      )}
      {(ops.create.error ?? ops.toggleItem.error) && (
        <Alert type="error">{(ops.create.error ?? ops.toggleItem.error)!.message}</Alert>
      )}
    </div>
  )
}

/** "Series from these results" / "from this album": makes it and opens it. */
export function CreateSeriesButton({ label, name, from }: { label: string; name: string; from: SeriesSource }) {
  const ops = useSeriesMutations()
  const navigate = useNavigate()
  return (
    <Button
      appearance="plain"
      disabled={ops.create.isPending}
      onClick={() =>
        ops.create.mutate(
          { name, from },
          { onSuccess: (s) => void navigate({ to: "/series/$id", params: { id: s.id } }) },
        )
      }
    >
      {ops.create.isPending ? <Spinner size={18} /> : <Icon path={mdiPlaylistPlus} size={18} />}
      {label}
    </Button>
  )
}

function Thumb({ art, className }: { art: ArtworkDTO | null; className?: string }) {
  const src = useThumb(art)
  return src ? (
    <img src={src} alt="" className={cn("rounded object-cover", className)} />
  ) : (
    <div className={cn("rounded bg-bg2", className)} />
  )
}

/** What a series is doing on one TV: now, next, and pause / next / stop. */
export function PlaybackPanel({
  tvId,
  tv,
  playback,
  showSeries,
}: {
  tvId: string
  tv: string
  playback: Playback
  showSeries?: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const control = usePlaybackControl()
  const paused = playback.status === "paused"
  const at = playback.nextAt
    ? new Date(playback.nextAt * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : null
  const act = (action: "pause" | "resume" | "next" | "stop") => control.mutate({ tv: tvId, action })
  return (
    <section aria-label={t.playingOn(tv)} className="flex gap-3 rounded-lg border border-divider p-3">
      <Thumb art={playback.current} className="aspect-video w-28 shrink-0 sm:w-36" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-2 text-xs text-text2">
          <span className={cn("size-2 rounded-full", paused ? "bg-disabled" : "bg-success")} />
          {t.playingOn(tv)}
          {showSeries && (
            <>
              {" · "}
              <Link to="/series/$id" params={{ id: playback.seriesId }} className="text-primary">
                {playback.seriesName}
              </Link>
            </>
          )}
          {playback.position && ` · ${playback.position}/${playback.total}`}
        </p>
        <p className="truncate font-medium">{playback.current?.title ?? "—"}</p>
        <p className="truncate text-sm text-text2">
          {paused
            ? t.paused
            : playback.next
              ? `${t.nextUp(playback.next.title)}${at ? ` ${t.nextAt(at)}` : ""}`
              : t.playing}
        </p>
        {playback.error && <p className="text-xs text-warning">{t.tvOffWaiting}</p>}
        <div className="flex flex-wrap gap-1 pt-1">
          <Button appearance="plain" onClick={() => act(paused ? "resume" : "pause")} disabled={control.isPending}>
            <Icon path={paused ? mdiPlay : mdiPause} size={18} />
            {paused ? t.resume : t.pause}
          </Button>
          <Button appearance="plain" onClick={() => act("next")} disabled={control.isPending}>
            <Icon path={mdiSkipNext} size={18} />
            {t.nextWork}
          </Button>
          <Button appearance="plain" variant="neutral" onClick={() => act("stop")} disabled={control.isPending}>
            <Icon path={mdiStop} size={18} />
            {t.stop}
          </Button>
        </div>
      </div>
    </section>
  )
}

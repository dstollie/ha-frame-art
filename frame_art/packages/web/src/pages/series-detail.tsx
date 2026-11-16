import {
  mdiArrowLeft,
  mdiShareVariant,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiDelete,
  mdiDragVertical,
  mdiPencil,
  mdiPlay,
} from "@mdi/js"
import { Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { Alert, Button, Card, cn, Icon, IconButton, Select, Spinner, Switch, TextField } from "@/components/ha"
import { PlaybackPanel } from "@/components/series"
import { DURATIONS, useSeries, useSeriesMutations, useThumb, useTvs, type SeriesDetail } from "@/lib/api"
import { useT } from "@/lib/i18n"

type Item = SeriesDetail["items"][number]

function ItemRow({
  item,
  index,
  count,
  seriesDuration,
  onMove,
  onDrop,
  onRemove,
  onDuration,
}: {
  item: Item
  index: number
  count: number
  seriesDuration: number
  onMove: (to: number) => void
  onDrop: (from: string) => void
  onRemove: () => void
  onDuration: (d: number | null) => void
}) {
  const t = useT()
  const src = useThumb(item.artwork)
  const [over, setOver] = useState(false)
  const a = item.artwork
  return (
    <li
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const from = e.dataTransfer.getData("text/plain")
        if (from && from !== a.id) onDrop(from)
      }}
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-divider px-2 py-2 last:border-b-0 sm:flex-nowrap",
        over && "bg-bg2 shadow-[inset_0_2px_0_var(--color-primary)]",
      )}
    >
      <span
        draggable
        data-testid="drag-handle"
        title={t.dragHint}
        aria-hidden
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", a.id)
          e.dataTransfer.effectAllowed = "move"
        }}
        className="hidden cursor-grab text-text2 sm:block"
      >
        <Icon path={mdiDragVertical} size={20} />
      </span>
      <Link to="/art/$id" params={{ id: a.id }} className="shrink-0">
        {src ? (
          <img src={src} alt="" className="aspect-video w-20 rounded object-cover sm:w-24" />
        ) : (
          <div className="aspect-video w-20 rounded bg-bg2 sm:w-24" />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{a.title}</p>
        <p className="truncate text-xs text-text2">{a.artist}</p>
      </div>
      <div className="ml-auto flex w-full items-center justify-end gap-1 sm:w-auto">
        <Select
          label={t.durationOf(a.title)}
          value={item.duration === null ? "" : String(item.duration)}
          onChange={(v) => onDuration(v ? Number(v) : null)}
          options={[
            { value: "", label: t.seriesDefault(t.duration(seriesDuration)) },
            ...DURATIONS.map((d) => ({ value: String(d), label: t.duration(d) })),
          ]}
          className="w-40 shrink-0"
        />
        <div className="flex shrink-0 sm:flex-col">
          <IconButton path={mdiChevronUp} label={t.moveUp} disabled={index === 0} onClick={() => onMove(index - 1)} />
          <IconButton
            path={mdiChevronDown}
            label={t.moveDown}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          />
        </div>
        <IconButton path={mdiClose} label={t.remove(a.title)} onClick={onRemove} />
      </div>
    </li>
  )
}

export function SeriesDetailPage({ id }: { id: string }) {
  const t = useT()
  const s = useSeries(id)
  const tvs = useTvs()
  const ops = useSeriesMutations()
  const navigate = useNavigate()
  const [name, setName] = useState<string | null>(null)

  if (s.isLoading) return <Spinner />
  if (!s.data) return <Alert type="error">{s.error?.message ?? t.errorGeneric}</Alert>
  const d = s.data
  const ids = d.items.map((i) => i.artwork.id)
  const move = (from: string, to: number) => {
    const next = ids.filter((x) => x !== from)
    next.splice(to, 0, from)
    ops.reorder.mutate({ id, artworkIds: next })
  }
  const saveName = () => {
    if (name !== null && name.trim() && name.trim() !== d.name) ops.update.mutate({ id, name: name.trim() })
    setName(null)
  }
  const error = ops.play.error ?? ops.update.error ?? ops.reorder.error

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link to="/series" className="inline-flex items-center gap-1 text-sm text-primary">
        <Icon path={mdiArrowLeft} size={18} />
        {t.series}
      </Link>
      <div className="space-y-1">
        {name === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-normal">{d.name}</h2>
            <Button appearance="plain" onClick={() => setName(d.name)}>
              <Icon path={mdiPencil} size={18} />
              {t.rename}
            </Button>
          </div>
        ) : (
          <div className="flex max-w-lg gap-2">
            <TextField label={t.seriesName} value={name} onChange={setName} onEnter={saveName} className="flex-1" />
            <Button appearance="accent" onClick={saveName}>
              {t.save}
            </Button>
          </div>
        )}
        <p className="text-sm text-text2">
          {t.worksCount(d.count)} · {t.each(t.duration(d.duration))} · {t.total(t.duration(d.totalDuration))}
        </p>
      </div>

      {error && <Alert type="error">{error.message}</Alert>}

      <Card className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {tvs.data?.map((tv) => (
            <Button
              key={tv.id}
              appearance="accent"
              disabled={!tv.paired || d.count === 0 || ops.play.isPending}
              onClick={() => ops.play.mutate({ id, tvs: [tv.id] })}
            >
              <Icon path={mdiPlay} size={18} />
              {t.playOn(tv.name)}
            </Button>
          ))}
        </div>
        {tvs.data
          ?.filter((tv) => tv.playback?.seriesId === id)
          .map((tv) => (
            <PlaybackPanel key={tv.id} tvId={tv.id} tv={tv.name} playback={tv.playback!} />
          ))}
        <div className="flex flex-wrap items-center gap-4 border-t border-divider pt-3">
          <div className="flex items-center gap-2 text-sm">
            <span aria-hidden>{t.eachWork}</span>
            <Select
              label={t.eachWork}
              value={String(d.duration)}
              onChange={(v) => ops.update.mutate({ id, duration: Number(v) })}
              options={DURATIONS.map((x) => ({ value: String(x), label: t.duration(x) }))}
              className="w-36"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch label={t.shuffle} checked={d.shuffle} onChange={(on) => ops.update.mutate({ id, shuffle: on })} />
            <span aria-hidden>{t.shuffle}</span>
          </div>
        </div>
      </Card>

      <Card>
        {d.items.length === 0 ? (
          <p className="p-4 text-sm text-text2">{t.emptySeries}</p>
        ) : (
          <ol aria-label={d.name}>
            {d.items.map((item, i) => (
              <ItemRow
                key={item.artwork.id}
                item={item}
                index={i}
                count={d.items.length}
                seriesDuration={d.duration}
                onMove={(to) => move(item.artwork.id, to)}
                onDrop={(from) => move(from, i)}
                onRemove={() => ops.toggleItem.mutate({ id, artworkId: item.artwork.id, on: false })}
                onDuration={(duration) => ops.itemDuration.mutate({ id, artworkId: item.artwork.id, duration })}
              />
            ))}
          </ol>
        )}
      </Card>

      <Link
        to="/share"
        search={{ series: id }}
        className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-primary hover:bg-bg2"
      >
        <Icon path={mdiShareVariant} size={18} />
        {t.shareCollection}
      </Link>
      <Button
        appearance="plain"
        variant="danger"
        onClick={() => {
          if (confirm(t.deleteSeriesConfirm))
            ops.remove.mutate(id, { onSuccess: () => void navigate({ to: "/series" }) })
        }}
      >
        <Icon path={mdiDelete} size={18} />
        {t.deleteSeries}
      </Button>
    </div>
  )
}

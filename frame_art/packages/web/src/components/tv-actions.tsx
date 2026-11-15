import { mdiAlertCircle, mdiCheck, mdiMinus, mdiMonitorArrowDown, mdiShuffleVariant } from "@mdi/js"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { FramePreview } from "@/components/frame-preview"
import { Alert, Button, Card, cn, Icon, Spinner } from "@/components/ha"
import { useJob, useNext, useShow, useThumb, useTvs, type JobDTO, type Mode, type TvState } from "@/lib/api"
import { useT } from "@/lib/i18n"

export function JobProgress({ job, tvName }: { job: JobDTO; tvName: string }) {
  const t = useT()
  const done = job.status === "done"
  const failed = job.status === "error"
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-divider p-3">
      <p className={cn("mb-2 text-sm font-medium", done && "text-success", failed && "text-error")}>
        {done ? t.jobDone(tvName) : failed ? t.jobFailed : t.jobBusy(tvName)}
      </p>
      <ol className="space-y-1">
        {job.steps.map((s) => (
          <li
            key={s.id}
            className={cn(
              "flex items-center gap-2 text-sm",
              ["todo", "skipped"].includes(s.state) ? "text-text2" : "text-text",
            )}
          >
            <span className="flex size-5 items-center justify-center">
              {s.state === "busy" && <Spinner size={16} />}
              {s.state === "done" && <Icon path={mdiCheck} size={18} className="text-success" />}
              {s.state === "skipped" && <Icon path={mdiMinus} size={18} />}
              {s.state === "error" && <Icon path={mdiAlertCircle} size={18} className="text-error" />}
              {s.state === "todo" && <span className="size-1.5 rounded-full bg-disabled" />}
            </span>
            {t.steps[s.id] ?? s.label}
          </li>
        ))}
      </ol>
      {failed && job.error && <p className="mt-2 text-sm text-error">{job.error}</p>}
    </div>
  )
}

function ShowButton({
  tv,
  artworkId,
  mode,
  primary,
}: {
  tv: TvState
  artworkId: string
  mode?: Mode | undefined
  primary: boolean
}) {
  const t = useT()
  const show = useShow()
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId)
  const busy = show.isPending || job.data?.status === "queued" || job.data?.status === "running"
  if (!tv.paired) {
    return (
      <Alert type="info">
        {t.notPaired(tv.name)}{" "}
        <Link to="/settings" className="font-medium text-primary underline">
          {t.pair}
        </Link>
      </Alert>
    )
  }
  return (
    <div className="space-y-2">
      <Button
        appearance={primary ? "accent" : "filled"}
        disabled={busy}
        className="w-full"
        onClick={() => {
          setJobId(null)
          show.mutate({ tv: tv.id, artworkId, mode }, { onSuccess: (j) => setJobId(j.id) })
        }}
      >
        {busy ? <Spinner size={18} /> : <Icon path={mdiMonitorArrowDown} size={18} />}
        {t.showOn(tv.name)}
        <span className="text-xs opacity-75">· {tv.on ? t.tvOn : t.tvOff}</span>
      </Button>
      {show.error && <Alert type="error">{show.error.message}</Alert>}
      {job.data && <JobProgress job={job.data} tvName={tv.name} />}
    </div>
  )
}

export function ShowButtons({ artworkId, mode }: { artworkId: string; mode?: Mode | undefined }) {
  const tvs = useTvs()
  if (tvs.isLoading) return <div className="h-10 animate-pulse rounded-full bg-bg2" />
  return (
    <div className="space-y-3">
      {tvs.data?.map((tv, i) => (
        <ShowButton key={tv.id} tv={tv} artworkId={artworkId} mode={mode} primary={i === 0} />
      ))}
    </div>
  )
}

function NowCard({ tv }: { tv: TvState }) {
  const t = useT()
  const next = useNext()
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId)
  const cur = tv.current?.artwork
  const src = useThumb(cur)
  const busy = next.isPending || Boolean(tv.job) || job.data?.status === "running" || job.data?.status === "queued"
  return (
    <Card className="min-w-[78%] snap-start sm:min-w-0">
      {cur && src ? (
        <Link to="/art/$id" params={{ id: cur.id }} className="block p-3 pb-0">
          <FramePreview src={src} aspect={cur.aspect} mode={tv.current!.mode} alt={cur.title} />
        </Link>
      ) : (
        <div className="m-3 mb-0 flex aspect-video items-center justify-center rounded bg-bg2 text-sm text-text2">
          {t.nothingYet}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-text2">
            <span className={cn("size-2 rounded-full", tv.on ? "bg-success" : "bg-disabled")} />
            {tv.name}
          </p>
          <p className="truncate font-medium">{cur?.title ?? "—"}</p>
          {cur && <p className="truncate text-sm text-text2">{cur.artist}</p>}
        </div>
        <Button
          appearance="plain"
          disabled={!tv.paired || busy}
          onClick={() => next.mutate(tv.id, { onSuccess: (j) => setJobId(j.id) })}
          title={t.newArt}
        >
          {busy ? <Spinner size={18} /> : <Icon path={mdiShuffleVariant} size={18} />}
          {t.newArt}
        </Button>
      </div>
      {job.data?.status === "error" && <p className="px-3 pb-3 text-sm text-error">{job.data.error}</p>}
    </Card>
  )
}

export function NowShowing() {
  const t = useT()
  const tvs = useTvs()
  if (!tvs.data?.length) return null
  return (
    <section aria-label={t.nowShowing} className="space-y-2">
      <h2 className="text-sm font-medium text-text2">{t.nowShowing}</h2>
      <div className="-mx-3 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 pb-1 scrollbar-none sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
        {tvs.data.map((tv) => (
          <NowCard key={tv.id} tv={tv} />
        ))}
      </div>
    </section>
  )
}

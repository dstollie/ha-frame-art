import { Link } from "@tanstack/react-router"
import { Check, CircleAlert, Loader2, Minus, MonitorUp, Tv } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useJob, useShow, useTvs, type JobDTO, type Mode } from "@/lib/api"
import { cn } from "@/lib/utils"

const stepIcon: Record<JobDTO["steps"][number]["state"], React.ReactNode> = {
  todo: <span className="size-1.5 rounded-full bg-muted-foreground/40" />,
  busy: <Loader2 className="size-3.5 animate-spin text-primary" />,
  done: <Check className="size-3.5 text-emerald-400" />,
  skipped: <Minus className="size-3.5 text-muted-foreground/60" />,
  error: <CircleAlert className="size-3.5 text-destructive" />,
}

export function JobProgress({ job, tvName }: { job: JobDTO; tvName: string }) {
  const done = job.status === "done"
  const failed = job.status === "error"
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        done
          ? "border-emerald-400/25 bg-emerald-400/[0.06]"
          : failed
            ? "border-destructive/30 bg-destructive/[0.06]"
            : "border-border bg-card/60",
      )}
      role="status"
      aria-live="polite"
    >
      <p className="mb-3 text-sm font-medium">
        {done
          ? `Hangt nu in de ${tvName.toLowerCase()}`
          : failed
            ? "Dat lukte niet"
            : `Onderweg naar de ${tvName.toLowerCase()}…`}
      </p>
      <ol className="space-y-1.5">
        {job.steps.map((s) => (
          <li
            key={s.id}
            className={cn(
              "flex items-center gap-2.5 text-sm",
              s.state === "todo" || s.state === "skipped" ? "text-muted-foreground" : "text-foreground/90",
            )}
          >
            <span className="flex size-4 items-center justify-center">{stepIcon[s.state]}</span>
            {s.label}
          </li>
        ))}
      </ol>
      {failed && job.error && <p className="mt-3 text-sm text-destructive">{job.error}</p>}
    </div>
  )
}

function TvButton({
  tv,
  artworkId,
  mode,
  primary,
}: {
  tv: { id: string; name: string; paired: boolean; on: boolean }
  artworkId: string
  mode: Mode
  primary: boolean
}) {
  const show = useShow()
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId)
  const busy = show.isPending || job.data?.status === "queued" || job.data?.status === "running"

  if (!tv.paired) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{tv.name}</span> is nog niet gekoppeld.{" "}
        <Link to="/instellingen" className="text-primary underline-offset-4 hover:underline">
          Koppelen
        </Link>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <Button
        size="lg"
        variant={primary ? "default" : "secondary"}
        disabled={busy}
        onClick={() => {
          setJobId(null)
          show.mutate({ tv: tv.id, artworkId, mode }, { onSuccess: (j) => setJobId(j.id) })
        }}
        className={cn(
          "h-14 w-full justify-between rounded-xl px-5 text-base font-semibold",
          primary && "shadow-[0_10px_30px_-12px_var(--primary)]",
        )}
      >
        <span className="flex items-center gap-3">
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : primary ? (
            <MonitorUp className="size-5" />
          ) : (
            <Tv className="size-5" />
          )}
          Zet op {tv.name.toLowerCase()}
        </span>
        <span className={cn("text-xs font-normal", primary ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {tv.on ? "aan" : "uit · wordt aangezet"}
        </span>
      </Button>
      {show.error && <p className="text-sm text-destructive">{show.error.message}</p>}
      {job.data && <JobProgress job={job.data} tvName={tv.name} />}
    </div>
  )
}

export function SendPanel({ artworkId, mode }: { artworkId: string; mode: Mode }) {
  const tvs = useTvs()
  if (tvs.isLoading) return <div className="h-14 animate-pulse rounded-xl bg-card" />
  if (!tvs.data?.length)
    return <p className="text-sm text-muted-foreground">Nog geen TV's ingesteld in de add-on-opties.</p>
  return (
    <div className="space-y-3">
      {tvs.data.map((tv, i) => (
        <TvButton key={tv.id} tv={tv} artworkId={artworkId} mode={mode} primary={i === 0} />
      ))}
    </div>
  )
}

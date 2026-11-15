import { Link } from "@tanstack/react-router"
import { Loader2, Shuffle } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { FramePreview } from "@/components/frame-preview"
import { Button } from "@/components/ui/button"
import { useJob, useNext, useTvs, type TvState } from "@/lib/api"
import { cn } from "@/lib/utils"

function WallCard({ tv }: { tv: TvState }) {
  const next = useNext()
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId)
  const busy = next.isPending || Boolean(tv.job) || job.data?.status === "running" || job.data?.status === "queued"
  const cur = tv.current?.artwork

  return (
    <div className="group flex min-w-[78%] snap-start flex-col gap-3 sm:min-w-0">
      {cur ? (
        <Link
          to="/werk/$id"
          params={{ id: cur.id }}
          className="block rounded-[0.6rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FramePreview src={cur.thumb} aspect={cur.aspect} mode={tv.current!.mode} alt={cur.title} />
        </Link>
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-[0.6rem] bg-gradient-to-b from-[#1d1b19] to-[#121110] p-[1.1cqw] text-sm text-muted-foreground ring-1 ring-white/[0.05] [container-type:inline-size]">
          <span className="font-display italic">Nog niets opgehangen</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs tracking-[0.14em] text-muted-foreground uppercase">
            <span
              className={cn(
                "size-1.5 rounded-full",
                tv.on ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" : "bg-muted-foreground/40",
              )}
            />
            {tv.name}
          </p>
          <p className="mt-1 truncate font-display text-lg leading-tight">{cur?.title ?? "—"}</p>
          {cur && <p className="truncate text-sm text-muted-foreground">{cur.artist}</p>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!tv.paired || busy}
          className="shrink-0 rounded-full"
          onClick={() =>
            next.mutate(tv.id, {
              onSuccess: (j) => setJobId(j.id),
              onError: (e) => toast.error(e.message),
            })
          }
          title={tv.paired ? "Nieuw schilderij uit de rotatie" : "Eerst koppelen"}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Shuffle />}
          Nieuw
        </Button>
      </div>
      {job.data?.status === "error" && <p className="text-sm text-destructive">{job.data.error}</p>}
    </div>
  )
}

export function OnTheWall() {
  const tvs = useTvs()
  if (!tvs.data?.length) return null
  return (
    <section aria-label="Nu aan de muur" className="space-y-4">
      <h2 className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">Nu aan de muur</h2>
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:grid sm:max-w-[1080px] sm:grid-cols-2 sm:gap-8 sm:overflow-visible sm:px-0">
        {tvs.data.map((tv) => (
          <WallCard key={tv.id} tv={tv} />
        ))}
      </div>
    </section>
  )
}

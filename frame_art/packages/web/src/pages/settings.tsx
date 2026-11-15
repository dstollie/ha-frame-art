import { Check, Link2, Loader2, RefreshCw, TriangleAlert } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useConfig, usePair, useSetCategory, useStartSync, useSync, useTvs, type TvState } from "@/lib/api"
import { cn } from "@/lib/utils"

function PairBlock({ tv }: { tv: TvState }) {
  const pair = usePair()
  const [open, setOpen] = useState(false)
  if (tv.paired && !open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-emerald-400">
          <Check className="size-4" /> Gekoppeld
        </span>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
          Opnieuw koppelen
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/[0.05] p-4">
      <p className="text-sm leading-relaxed">
        Zet de {tv.name.toLowerCase()} aan en sta erbij. Na <em>Koppelen</em> vraagt de TV of <strong>FrameArt</strong>{" "}
        verbinding mag maken: kies <strong>Toestaan</strong>. Je hebt een minuut.
      </p>
      {!tv.on && (
        <p className="flex items-center gap-2 text-sm text-amber-300">
          <TriangleAlert className="size-4" /> De TV lijkt uit te staan.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => pair.mutate(tv.id, { onSuccess: () => setOpen(false) })}
          disabled={pair.isPending}
          className="rounded-full"
        >
          {pair.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
          {pair.isPending ? "Wacht op Toestaan…" : "Koppelen"}
        </Button>
        {tv.paired && (
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Annuleren
          </Button>
        )}
      </div>
      {pair.error && <p className="text-sm text-destructive">{pair.error.message}</p>}
    </div>
  )
}

export function SettingsPage() {
  const tvs = useTvs()
  const config = useConfig()
  const sync = useSync()
  const startSync = useStartSync()
  const setCategory = useSetCategory()
  const s = sync.data

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="font-display text-3xl font-light tracking-tight sm:text-[2.6rem]">Instellingen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          TV-adressen en standaardstijl staan in de add-on-opties in Home Assistant.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">TV's</h2>
        {tvs.data?.map((tv) => (
          <section
            key={tv.id}
            aria-label={`TV ${tv.name}`}
            className="space-y-4 rounded-2xl border border-border bg-card/50 p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-display text-xl">{tv.name}</p>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", tv.on ? "bg-emerald-400" : "bg-muted-foreground/40")} />
                  {tv.on ? "Aan" : "Uit of standby"}
                  {!tv.canWake && " · kan niet op afstand aan (geen wake_entity)"}
                </p>
              </div>
            </div>
            <PairBlock tv={tv} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div>
                <p className="text-sm">Rotatie</p>
                <p className="text-xs text-muted-foreground">
                  Waar “Nieuw schilderij” (dashboard, Node-RED) uit kiest.
                </p>
              </div>
              <Select value={tv.category} onValueChange={(category) => setCategory.mutate({ tv: tv.id, category })}>
                <SelectTrigger className="w-52 rounded-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.data?.rotation.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Catalogus</h2>
        <div className="space-y-4 rounded-2xl border border-border bg-card/50 p-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Werken" value={s ? s.total.toLocaleString("nl-NL") : "…"} />
            <Stat label="Met kleur" value={s ? s.withColor.toLocaleString("nl-NL") : "…"} />
            <Stat label="Cache" value={s ? `${Math.round(s.cacheBytes / 1_048_576)} MB` : "…"} />
            <Stat
              label="Laatst ververst"
              value={
                s?.lastRun
                  ? new Date(s.lastRun).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })
                  : "nog niet"
              }
            />
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {s?.state === "running"
                ? `Bezig met ${s.source ?? "…"} · ${s.added} nieuw`
                : "Ververst elke nacht automatisch."}
              {s?.error && <span className="block text-destructive">{s.error}</span>}
            </p>
            <Button
              variant="secondary"
              className="rounded-full"
              disabled={s?.state === "running" || startSync.isPending}
              onClick={() => startSync.mutate()}
            >
              <RefreshCw className={cn(s?.state === "running" && "animate-spin")} />
              Nu verversen
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-display text-2xl font-light">{value}</dd>
    </div>
  )
}

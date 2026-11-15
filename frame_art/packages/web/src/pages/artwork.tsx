import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { ArrowLeft, EyeOff, ExternalLink, Heart, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { FramePreview } from "@/components/frame-preview"
import { SendPanel } from "@/components/send-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  MODE_LABEL,
  SOURCE_LABEL,
  randomArtwork,
  useArtwork,
  useConfig,
  useFavourite,
  useHide,
  type Mode,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const MODES: Mode[] = ["light", "dark", "blur", "fill"]

export function ArtworkPage({ id, mode: wanted }: { id: string; mode: Mode | undefined }) {
  const art = useArtwork(id)
  const config = useConfig()
  const fav = useFavourite()
  const hide = useHide()
  const navigate = useNavigate()
  const router = useRouter()
  const mode: Mode = wanted ?? config.data?.defaultMode ?? "light"
  const label = (c: string) => config.data?.categories.find((x) => x.id === c)?.label ?? c

  if (art.isError) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        Dit werk bestaat niet (meer).{" "}
        <Link to="/" className="text-primary">
          Terug naar ontdekken
        </Link>
      </div>
    )
  }
  const a = art.data
  const setMode = (m: Mode) =>
    void navigate({ to: "/werk/$id", params: { id }, search: { mode: m }, replace: true, resetScroll: false })

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="space-y-4">
        <button
          onClick={() => (router.history.length > 1 ? router.history.back() : void navigate({ to: "/" }))}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Terug
        </button>
        <div className="lg:sticky lg:top-24">
          {a ? (
            <FramePreview src={a.thumb} aspect={a.aspect} mode={mode} alt={a.title} />
          ) : (
            <Skeleton className="aspect-video w-full rounded-lg" />
          )}
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Zo komt hij op de Frame · 3840 × 2160 ·{" "}
            {MODE_LABEL[a?.fillAllowed || mode !== "fill" ? mode : "light"].toLowerCase()}
          </p>
        </div>
      </div>

      <aside className="space-y-7">
        {a ? (
          <header className="space-y-2">
            <h1 className="font-display text-[1.9rem] leading-[1.1] font-light tracking-tight text-balance sm:text-4xl">
              {a.title}
            </h1>
            <p className="text-lg text-foreground/80">{a.artist || "Onbekende maker"}</p>
            <p className="text-sm text-muted-foreground">{[a.date, a.medium].filter(Boolean).join(" · ")}</p>
            <div className="flex flex-wrap gap-1.5 pt-2">
              {a.categories.map((c) => (
                <Link key={c} to="/" search={{ cat: c }}>
                  <Badge variant="secondary" className="rounded-full px-3 font-normal hover:bg-accent">
                    {label(c)}
                  </Badge>
                </Link>
              ))}
            </div>
          </header>
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-9 w-4/5" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        )}

        <div className="space-y-2.5">
          <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Passe-partout</p>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as Mode)}
            className="grid w-full grid-cols-4 gap-1 rounded-xl bg-white/[0.04] p-1"
            aria-label="Passe-partout"
          >
            {MODES.map((m) => (
              <ToggleGroupItem
                key={m}
                value={m}
                disabled={m === "fill" && a ? !a.fillAllowed : false}
                className="h-9 rounded-lg text-sm data-[state=on]:bg-white/[0.1] data-[state=on]:text-foreground"
                title={m === "fill" && a && !a.fillAllowed ? "Alleen voor werken die bijna 16:9 zijn" : undefined}
              >
                <span
                  className={cn(
                    "mr-1.5 inline-block size-2.5 rounded-full ring-1 ring-white/20",
                    m === "light" && "bg-[#ECE8E1]",
                    m === "dark" && "bg-[#1C1B19]",
                    m === "blur" && "bg-gradient-to-br from-emerald-700 to-sky-800",
                    m === "fill" && "bg-gradient-to-br from-amber-600 to-rose-800",
                  )}
                />
                {MODE_LABEL[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {a && <SendPanel artworkId={a.id} mode={mode} />}

        {a && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
            <Button
              variant={a.favourite ? "secondary" : "ghost"}
              className="rounded-full"
              onClick={() => fav.mutate({ id: a.id, on: !a.favourite })}
            >
              <Heart className={cn(a.favourite && "fill-primary text-primary")} />
              {a.favourite ? "Favoriet" : "Bewaar als favoriet"}
            </Button>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={async () => {
                const next = await randomArtwork({ cat: a.categories[0] }).catch(() => null)
                if (next) void navigate({ to: "/werk/$id", params: { id: next.id } })
              }}
            >
              <Sparkles /> Iets anders
            </Button>
            <Button variant="ghost" className="rounded-full" asChild>
              <a href={a.page} target="_blank" rel="noreferrer">
                <ExternalLink /> {SOURCE_LABEL[a.source]}
              </a>
            </Button>
            <Button
              variant="ghost"
              className="ml-auto rounded-full text-muted-foreground"
              onClick={() =>
                hide.mutate(a.id, {
                  onSuccess: () => {
                    toast("Verborgen; komt niet meer voorbij")
                    void navigate({ to: "/" })
                  },
                })
              }
            >
              <EyeOff /> Verberg
            </Button>
          </div>
        )}
        {a && a.shown.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Eerder getoond:{" "}
            {a.shown
              .slice(0, 3)
              .map(
                (s) =>
                  `${config.data?.tvs.find((t) => t.id === s.tv)?.name ?? s.tv} ${new Date(s.shownAt * 1000).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`,
              )
              .join(", ")}
          </p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground/70">
          Publiek domein (CC0) via {a ? SOURCE_LABEL[a.source] : "het museum"}. Het werk wordt op de Pi klaargemaakt en
          daarna rechtstreeks naar de Frame gestuurd.
        </p>
      </aside>
    </div>
  )
}

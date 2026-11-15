import { Link } from "@tanstack/react-router"
import { Heart } from "lucide-react"
import { useState } from "react"

import { gridThumb, type ArtworkDTO } from "@/lib/api"
import { cn } from "@/lib/utils"

export function ArtworkCard({ art, className }: { art: ArtworkDTO; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <Link
      to="/werk/$id"
      params={{ id: art.id }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl bg-card/60 ring-1 ring-white/[0.04] outline-none transition-all duration-300",
        "hover:-translate-y-0.5 hover:bg-card hover:ring-white/10 hover:shadow-[0_18px_40px_-18px_rgb(0_0_0/0.8)] focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden p-4 sm:p-5"
        style={{ backgroundColor: art.color ? `color-mix(in oklab, ${art.color} 14%, #121110)` : "#151413" }}
      >
        <img
          src={gridThumb(art)}
          alt={art.title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          className={cn(
            "max-h-full max-w-full object-contain shadow-[0_10px_24px_-8px_rgb(0_0_0/0.75)] transition-all duration-700 ease-out group-hover:scale-[1.025]",
            loaded ? "opacity-100 blur-0" : "opacity-0 blur-sm",
          )}
        />
        {!loaded && <div className="absolute inset-6 animate-pulse rounded bg-white/[0.03]" />}
        {art.favourite && (
          <Heart
            className="absolute top-3 right-3 size-4 fill-primary text-primary drop-shadow"
            aria-label="Favoriet"
          />
        )}
      </div>
      <div className="space-y-0.5 px-3.5 pt-2.5 pb-3">
        <p className="truncate font-display text-[0.95rem] leading-snug text-foreground/95">{art.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {art.artist || "Onbekend"}
          {art.date && <span className="text-muted-foreground/60"> · {art.date}</span>}
        </p>
      </div>
    </Link>
  )
}

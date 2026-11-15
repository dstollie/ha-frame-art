import { H, LAYOUT, W, artBox, bevelWidth } from "@frame-art/server/geometry"
import { useState } from "react"

import type { Mode } from "@/lib/api"
import { cn } from "@/lib/utils"

const pct = (v: number, of: number) => `${(v / of) * 100}%`
const cq = (px: number) => `${(px / W) * 100}cqw`

/**
 * A true-to-life Frame: the same geometry as the 3840x2160 render on the TV (shared module),
 * drawn in CSS with container-query units so it scales to any width.
 */
export function FramePreview({
  src,
  aspect,
  mode,
  className,
  bezel = true,
  alt,
}: {
  src: string
  aspect: number | null
  mode: Mode
  className?: string
  bezel?: boolean
  alt: string
}) {
  const [natural, setNatural] = useState<number | null>(null)
  const ratio = natural ?? aspect ?? 1.4
  const effective: Mode = mode === "fill" && !(ratio >= 1.5 && ratio <= 2.1) ? "light" : mode
  // Use a large virtual source so the upscale limit never kicks in for the preview.
  const box = artBox(Math.round(ratio * 10_000), 10_000, effective === "fill" ? "light" : effective)
  const bevel = bevelWidth(W)
  const s = LAYOUT[effective]

  return (
    <div
      className={cn(
        "relative w-full [container-type:inline-size]",
        bezel &&
          "rounded-[0.6cqw] bg-gradient-to-b from-[#2a2724] to-[#141210] p-[1.1cqw] shadow-[0_2.5cqw_6cqw_-1.5cqw_rgb(0_0_0/0.7),inset_0_0_0_1px_rgb(255_255_255/0.06)]",
        className,
      )}
    >
      <div
        className="relative aspect-video w-full overflow-hidden transition-[background-color] duration-500"
        style={{ backgroundColor: s.matte ?? "#0f0e0d" }}
      >
        {effective === "blur" && (
          <img
            src={src}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full scale-110 object-cover"
            style={{ filter: `blur(${cq(110)}) brightness(0.55) saturate(1.1)` }}
          />
        )}
        {effective === "fill" ? (
          <img
            src={src}
            alt={alt}
            className="art-in absolute inset-0 size-full object-cover"
            onLoad={(e) => setNatural(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          />
        ) : (
          <img
            key={effective}
            src={src}
            alt={alt}
            onLoad={(e) => setNatural(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
            className="art-in absolute object-fill transition-all duration-500 ease-out"
            style={{
              left: pct(box.x, W),
              top: pct(box.y, H),
              width: pct(box.w, W),
              height: pct(box.h, H),
              boxShadow: [
                s.bevel ? `0 0 0 ${cq(bevel)} ${s.bevel}` : null,
                s.shadow ? `0 ${cq(40)} ${cq(120)} ${cq(10)} rgb(0 0 0 / ${s.shadow})` : null,
              ]
                .filter(Boolean)
                .join(", "),
            }}
          />
        )}
        {/* A whisper of glass, like the Frame's matte panel. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.035] via-transparent to-black/[0.06]" />
      </div>
    </div>
  )
}

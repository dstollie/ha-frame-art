import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { Clock, Compass, Heart, Settings2 } from "lucide-react"

import { cn } from "@/lib/utils"

const NAV = [
  { to: "/", label: "Ontdek", icon: Compass },
  { to: "/favorieten", label: "Favorieten", icon: Heart },
  { to: "/geschiedenis", label: "Geschiedenis", icon: Clock },
  { to: "/instellingen", label: "Instellingen", icon: Settings2 },
] as const

function Wordmark() {
  return (
    <Link to="/" className="group flex items-baseline gap-2 outline-none">
      <span className="font-display text-[1.45rem] leading-none font-medium tracking-tight italic">Frame</span>
      <span className="text-[0.7rem] font-semibold tracking-[0.32em] text-primary uppercase">Art</span>
    </Link>
  )
}

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const active = (to: string) => (to === "/" ? path === "/" || path.startsWith("/werk") : path.startsWith(to))

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-white/[0.04] bg-background/70 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between px-4 sm:h-16 sm:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Hoofdmenu">
            {NAV.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm transition-colors",
                  active(to) ? "bg-white/[0.07] text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 pt-5 pb-28 sm:px-8 sm:pt-8 sm:pb-16">
        <Outlet />
      </main>

      <nav
        aria-label="Hoofdmenu"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.05] bg-background/85 pb-safe backdrop-blur-xl sm:hidden"
      >
        <div className="grid grid-cols-4">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-col items-center gap-1 pt-2.5 text-[0.68rem] transition-colors",
                active(to) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" strokeWidth={active(to) ? 2.2 : 1.7} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}

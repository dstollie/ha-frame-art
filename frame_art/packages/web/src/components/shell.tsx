import { mdiMenu } from "@mdi/js"
import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { useRef } from "react"

import { cn, Icon } from "@/components/ha"
import { getEnv } from "@/lib/env"
import { useT } from "@/lib/i18n"
import { useNarrow } from "@/lib/narrow"

/** HA's panel layout: a toolbar with the menu button on phones, tabs underneath, content below. */
export function Shell() {
  const t = useT()
  const narrow = useNarrow()
  const ref = useRef<HTMLDivElement>(null)
  const path = useRouterState({ select: (s) => s.location.pathname })
  const tabs = [
    { to: "/", label: t.tabExplore, active: path === "/" || path.startsWith("/art") },
    { to: "/collection", label: t.tabCollection, active: path.startsWith("/collection") },
    { to: "/history", label: t.tabHistory, active: path.startsWith("/history") },
    { to: "/settings", label: t.tabSettings, active: path.startsWith("/settings") },
  ] as const

  const toggleMenu = () =>
    ref.current?.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }))

  return (
    <div ref={ref} className="min-h-dvh bg-bg text-text">
      <header className="sticky top-0 z-20 bg-header text-on-header shadow-[0_1px_0_var(--color-divider)]">
        <div className="flex h-14 items-center gap-1 px-1 sm:px-4">
          {narrow && getEnv().mode === "panel" && (
            <button
              type="button"
              onClick={toggleMenu}
              aria-label="Menu"
              className="inline-flex size-12 items-center justify-center rounded-full"
            >
              <Icon path={mdiMenu} />
            </button>
          )}
          <h1
            className={cn("text-xl font-normal tracking-normal", !narrow && "pl-0", narrow ? "pl-1" : "pl-2 sm:pl-0")}
          >
            {t.appTitle}
          </h1>
        </div>
        <nav className="flex overflow-x-auto px-1 scrollbar-none sm:px-4" aria-label={t.appTitle}>
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "relative inline-flex h-12 shrink-0 items-center px-4 text-sm font-medium transition-colors",
                tab.active ? "text-primary" : "text-text2 hover:text-text",
              )}
            >
              {tab.label}
              {tab.active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1440px] px-3 py-4 sm:px-6 sm:py-6">
        <Outlet />
      </main>
    </div>
  )
}

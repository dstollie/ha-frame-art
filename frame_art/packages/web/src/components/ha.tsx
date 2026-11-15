/**
 * Home Assistant's own elements where they're available (they're defined by HA's frontend, so
 * only inside HA), with a fallback that uses the same theme variables everywhere else (ingress
 * page, tests). HA's element APIs change between releases, so every wrapper keeps a fallback.
 */
import { clsx } from "clsx"
import { createElement, useCallback, useEffect, useState, type ReactNode } from "react"

export const cn = clsx

/** True once the custom element `tag` is defined; re-renders when HA lazy-loads it. */
export function useDefined(tag: string): boolean {
  const [defined, setDefined] = useState(() => Boolean(customElements.get(tag)))
  useEffect(() => {
    if (defined) return
    let alive = true
    void customElements.whenDefined(tag).then(() => alive && setDefined(true))
    return () => {
      alive = false
    }
  }, [tag, defined])
  return defined
}

// ---------------------------------------------------------------- icons (MDI paths, like ha-svg-icon)

export function Icon({ path, size = 24, className }: { path: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0 fill-current", className)} aria-hidden>
      <path d={path} />
    </svg>
  )
}

// ---------------------------------------------------------------- card

export function Card({
  children,
  className,
  header,
  label,
}: {
  children: ReactNode
  className?: string
  header?: ReactNode
  /** Accessible name; makes the card a landmark region. */
  label?: string
}) {
  const a11y = label ? { role: "region", "aria-label": label } : {}
  const ha = useDefined("ha-card")
  const body = (
    <>
      {header && <h2 className="px-4 pt-4 pb-1 text-base font-medium text-text">{header}</h2>}
      {children}
    </>
  )
  if (ha) return createElement("ha-card", { class: cn("block overflow-hidden", className), ...a11y }, body)
  return (
    <div className={cn("card overflow-hidden", className)} {...a11y}>
      {body}
    </div>
  )
}

// ---------------------------------------------------------------- buttons

type Variant = "brand" | "neutral" | "danger"
type Appearance = "accent" | "filled" | "outlined" | "plain"

export function Button({
  children,
  onClick,
  variant = "brand",
  appearance = "accent",
  disabled,
  className,
  type = "button",
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: Variant
  appearance?: Appearance
  disabled?: boolean | undefined
  className?: string
  type?: "button" | "submit"
  title?: string | undefined
}) {
  const ha = useDefined("ha-button")
  const attach = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !onClick) return
      const handler = () => {
        if (!disabled) onClick()
      }
      el.addEventListener("click", handler)
      return () => el.removeEventListener("click", handler)
    },
    [onClick, disabled],
  )
  if (ha && type === "button") {
    return createElement(
      "ha-button",
      { ref: attach, variant, appearance, disabled: disabled || undefined, class: className, title },
      children,
    )
  }
  const colour =
    variant === "danger" ? "var(--color-error)" : variant === "neutral" ? "var(--color-text2)" : "var(--color-primary)"
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ ["--btn" as string]: colour }}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-40",
        appearance === "accent" && "bg-[var(--btn)] text-on-primary hover:brightness-110",
        appearance === "filled" && "bg-[color-mix(in_srgb,var(--btn)_16%,transparent)] text-[var(--btn)]",
        appearance === "outlined" &&
          "border border-divider text-[var(--btn)] hover:bg-[color-mix(in_srgb,var(--btn)_8%,transparent)]",
        appearance === "plain" && "text-[var(--btn)] hover:bg-[color-mix(in_srgb,var(--btn)_8%,transparent)]",
        className,
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({
  path,
  label,
  onClick,
  className,
  disabled,
}: {
  path: string
  label: string
  onClick?: () => void
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-full text-current transition-colors hover:bg-[color-mix(in_srgb,currentColor_10%,transparent)] disabled:opacity-40",
        className,
      )}
    >
      <Icon path={path} />
    </button>
  )
}

// ---------------------------------------------------------------- switch

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  label: string
  disabled?: boolean
}) {
  const ha = useDefined("ha-switch")
  const attach = useCallback(
    (el: (HTMLElement & { checked?: boolean }) | null) => {
      if (!el) return
      el.checked = checked
      const handler = () => onChange(Boolean(el.checked))
      el.addEventListener("change", handler)
      return () => el.removeEventListener("change", handler)
    },
    [checked, onChange],
  )
  if (ha) return createElement("ha-switch", { ref: attach, "aria-label": label, disabled: disabled || undefined })
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-primary" : "bg-[var(--switch-unchecked-track-color,#9e9e9e)]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

// ---------------------------------------------------------------- alert + spinner

export function Alert({
  type = "info",
  children,
  title,
}: {
  type?: "info" | "warning" | "error" | "success"
  children: ReactNode
  title?: string
}) {
  const ha = useDefined("ha-alert")
  if (ha) return createElement("ha-alert", { "alert-type": type, title }, children)
  const colour = {
    info: "var(--info-color,#039be5)",
    warning: "var(--color-warning)",
    error: "var(--color-error)",
    success: "var(--color-success)",
  }[type]
  return (
    <div
      role={type === "error" ? "alert" : "status"}
      className="rounded-lg px-4 py-3 text-sm"
      style={{ background: `color-mix(in srgb, ${colour} 12%, transparent)`, borderLeft: `4px solid ${colour}` }}
    >
      {title && <p className="font-medium">{title}</p>}
      {children}
    </div>
  )
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="animate-spin text-primary" aria-label="…">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------- inputs (HA's look; their element APIs move too fast)

export function TextField({
  value,
  onChange,
  placeholder,
  label,
  type = "text",
  className,
  icon,
  onEnter,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label: string
  type?: "text" | "url" | "password" | "search"
  className?: string
  icon?: string
  onEnter?: () => void
}) {
  return (
    <label className={cn("relative flex h-10 items-center", className)}>
      <span className="sr-only">{label}</span>
      {icon && <Icon path={icon} size={20} className="pointer-events-none absolute left-3 text-text2" />}
      <input
        type={type}
        value={value}
        placeholder={placeholder ?? label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        className={cn(
          "h-10 w-full appearance-none rounded-lg border border-solid border-[var(--color-divider)] bg-card px-3 text-sm text-text outline-none placeholder:text-text2 focus:border-primary",
          icon && "pl-10",
        )}
      />
    </label>
  )
}

export function Select({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
  className?: string
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 rounded-lg border border-solid border-[var(--color-divider)] bg-card px-3 pr-8 text-sm text-text outline-none focus:border-primary",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------- chips + segmented (HA filter-chip look)

export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors",
        active ? "primary-soft border-transparent text-primary" : "border-divider text-text hover:bg-bg2",
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-full border border-divider p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 flex-1 rounded-full px-3 text-sm whitespace-nowrap transition-colors",
            value === o.value ? "bg-primary text-on-primary" : "text-text hover:bg-bg2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

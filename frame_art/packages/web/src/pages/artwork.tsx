import {
  mdiArrowLeft,
  mdiDelete,
  mdiDiceMultipleOutline,
  mdiEyeOff,
  mdiHeart,
  mdiHeartOutline,
  mdiOpenInNew,
  mdiPencil,
} from "@mdi/js"
import { Link, useNavigate, useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { FramePreview } from "@/components/frame-preview"
import { Alert, Button, Card, Chip, Icon, IconButton, Segmented, TextField } from "@/components/ha"
import { ShowButtons } from "@/components/tv-actions"
import {
  randomArtwork,
  useAlbumMutations,
  useAlbums,
  useArtwork,
  useConfig,
  useCrop,
  useDeleteArtwork,
  useFavourite,
  useHide,
  useRenameArtwork,
  useThumb,
  useTvs,
  type Mode,
} from "@/lib/api"
import { useLanguage } from "@/lib/hass"
import { useLocale, useT } from "@/lib/i18n"

export function ArtworkPage({ id, mode: wanted }: { id: string; mode: Mode | undefined }) {
  const t = useT()
  const lang = useLanguage()
  const locale = useLocale()
  const art = useArtwork(id)
  const config = useConfig()
  const tvs = useTvs()
  const albums = useAlbums()
  const albumOps = useAlbumMutations()
  const fav = useFavourite()
  const hide = useHide()
  const del = useDeleteArtwork()
  const rename = useRenameArtwork()
  const navigate = useNavigate()
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const a = art.data
  const src = useThumb(a)

  const first = tvs.data?.[0]
  const tvDefault: Mode | undefined = first ? (first.display === "fill" ? "fill" : first.matteStyle) : undefined
  const mode: Mode = wanted ?? tvDefault ?? "fill"
  const display = mode === "fill" ? "fill" : "matte"
  const crop = useCrop(id, mode === "fill")
  const setMode = (m: Mode) =>
    void navigate({ to: "/art/$id", params: { id }, search: { mode: m }, replace: true, resetScroll: false })
  const label = (c: string) => config.data?.categories.find((x) => x.id === c)?.label[lang] ?? c
  const tvName = (tv: string) => config.data?.tvs.find((x) => x.id === tv)?.name ?? tv

  if (art.isError) {
    return (
      <Alert type="warning">
        {art.error.message}{" "}
        <Link to="/" className="text-primary underline">
          {t.back}
        </Link>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => (router.history.length > 1 ? router.history.back() : void navigate({ to: "/" }))}
        className="inline-flex items-center gap-1 text-sm text-text2 hover:text-text"
      >
        <Icon path={mdiArrowLeft} size={18} /> {t.back}
      </button>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card className="self-start p-4 lg:sticky lg:top-32">
          {src && a ? (
            <FramePreview src={src} aspect={a.aspect} mode={mode} alt={a.title} crop={crop.data} />
          ) : (
            <div className="aspect-video animate-pulse rounded bg-bg2" />
          )}
          <p className="mt-3 text-center text-xs text-text2">
            {t.previewNote}
            {wanted && tvDefault && wanted !== tvDefault ? ` · ${t.onlyThisTime}` : ""}
          </p>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            {a ? (
              <div className="space-y-1">
                {editing !== null ? (
                  <div className="flex gap-2">
                    <TextField value={editing} onChange={setEditing} label={t.rename} className="flex-1" />
                    <Button
                      onClick={() => rename.mutate({ id, title: editing }, { onSuccess: () => setEditing(null) })}
                    >
                      {t.save}
                    </Button>
                  </div>
                ) : (
                  <h2 className="flex items-start gap-1 text-2xl leading-tight font-normal">
                    <span className="flex-1">{a.title}</span>
                    {a.own && <IconButton path={mdiPencil} label={t.rename} onClick={() => setEditing(a.title)} />}
                  </h2>
                )}
                <p className="text-text">{a.artist}</p>
                <p className="text-sm text-text2">{[a.date, a.medium].filter(Boolean).join(" · ")}</p>
                <p className="text-sm text-text2">
                  {a.department}
                  {a.licence ? ` · ${a.licence}` : ""}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {a.categories.map((c) => (
                    <Link key={c} to="/" search={{ cat: c }}>
                      <Chip active={false} onClick={() => undefined}>
                        {label(c)}
                      </Chip>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-24 animate-pulse rounded bg-bg2" />
            )}
          </Card>

          <Card className="space-y-3 p-4" header={t.display}>
            <Segmented
              label={t.display}
              value={display}
              onChange={(d) => setMode(d === "fill" ? "fill" : (first?.matteStyle ?? "light"))}
              options={[
                { value: "fill", label: t.fill },
                { value: "matte", label: t.matte },
              ]}
            />
            {display === "matte" && (
              <Segmented
                label={t.matte}
                value={mode as "light" | "dark" | "blur"}
                onChange={setMode}
                options={[
                  { value: "light", label: t.matteLight },
                  { value: "dark", label: t.matteDark },
                  { value: "blur", label: t.matteBlur },
                ]}
              />
            )}
            {a && <ShowButtons artworkId={a.id} mode={wanted} />}
          </Card>

          {a && (
            <Card className="p-2">
              <div className="flex flex-wrap items-center gap-1">
                <Button appearance="plain" onClick={() => fav.mutate({ id: a.id, on: !a.favourite })}>
                  <Icon path={a.favourite ? mdiHeart : mdiHeartOutline} size={18} />
                  {a.favourite ? t.favourite : t.addFavourite}
                </Button>
                <Button
                  appearance="plain"
                  onClick={async () => {
                    const next = await randomArtwork({ cat: a.categories[0] }).catch(() => null)
                    if (next) void navigate({ to: "/art/$id", params: { id: next.id } })
                  }}
                >
                  <Icon path={mdiDiceMultipleOutline} size={18} />
                  {t.surprise}
                </Button>
                {a.page && (
                  <a
                    href={a.page}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-primary hover:bg-bg2"
                  >
                    <Icon path={mdiOpenInNew} size={18} />
                    {a.department || t.source}
                  </a>
                )}
                {a.own ? (
                  <Button
                    appearance="plain"
                    variant="danger"
                    onClick={() => {
                      if (confirm(t.deleteConfirm))
                        del.mutate(a.id, { onSuccess: () => void navigate({ to: "/collection" }) })
                    }}
                  >
                    <Icon path={mdiDelete} size={18} />
                    {t.delete}
                  </Button>
                ) : (
                  <Button
                    appearance="plain"
                    variant="neutral"
                    onClick={() => hide.mutate(a.id, { onSuccess: () => void navigate({ to: "/" }) })}
                  >
                    <Icon path={mdiEyeOff} size={18} />
                    {t.hide}
                  </Button>
                )}
              </div>
              {Boolean(albums.data?.length) && (
                <div className="space-y-1.5 border-t border-divider p-2">
                  <p className="text-xs text-text2">{t.albums}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {albums.data!.map((al) => {
                      const inAlbum = a.albums.includes(al.id)
                      return (
                        <Chip
                          key={al.id}
                          active={inAlbum}
                          onClick={() => albumOps.toggle.mutate({ album: al.id, artworkId: a.id, on: !inAlbum })}
                        >
                          {al.name}
                        </Chip>
                      )
                    })}
                  </div>
                </div>
              )}
              {a.shown.length > 0 && (
                <p className="border-t border-divider p-2 text-xs text-text2">
                  {t.shownBefore}:{" "}
                  {a.shown
                    .slice(0, 3)
                    .map(
                      (s) =>
                        `${tvName(s.tv)} ${new Date(s.shownAt * 1000).toLocaleDateString(locale, { day: "numeric", month: "short" })}`,
                    )
                    .join(", ")}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

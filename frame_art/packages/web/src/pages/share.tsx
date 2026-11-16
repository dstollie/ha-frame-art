import { mdiDownload, mdiGithub } from "@mdi/js"
import { useState } from "react"

import { Alert, Button, Card, Icon, TextField } from "@/components/ha"
import { useAlbums, useArtworks, useSeries, useShare } from "@/lib/api"
import { useHass } from "@/lib/hass"
import { useT } from "@/lib/i18n"

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)

function FromSeries({ id }: { id: string }) {
  const s = useSeries(id)
  return <ShareForm sourceName={s.data?.name} ids={s.data?.items.map((i) => i.artwork.id) ?? []} />
}

function FromAlbum({ id }: { id: string }) {
  const albums = useAlbums()
  const works = useArtworks({ album: id, all: true })
  return (
    <ShareForm
      sourceName={albums.data?.find((a) => a.id === id)?.name}
      ids={works.data?.pages.flatMap((p) => p.items.map((a) => a.id)) ?? []}
    />
  )
}

/** Share a series or an album as a community collection: JSON, or a pre-filled GitHub issue. */
export function SharePage({ series, album }: { series?: string | undefined; album?: string | undefined }) {
  const t = useT()
  if (series) return <FromSeries id={series} />
  if (album) return <FromAlbum id={album} />
  return <Alert type="info">{t.shareHelp}</Alert>
}

function ShareForm({ sourceName, ids }: { sourceName: string | undefined; ids: string[] }) {
  const t = useT()
  const user = useHass((h) => h?.user?.name ?? "")
  const share = useShare()

  const [form, setForm] = useState<{
    title?: string
    id?: string
    description: string
    tags: string
    curator?: string
    github: string
  }>({
    description: "",
    tags: "",
    github: "",
  })
  const title = form.title ?? sourceName ?? ""
  const id = form.id ?? slugify(title)
  const curator = form.curator ?? user
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const tags = form.tags
    .split(",")
    .map((x) => slugify(x))
    .filter(Boolean)

  const r = share.data
  const download = () => {
    if (!r) return
    const blob = new Blob([JSON.stringify(r.manifest, null, 2) + "\n"], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${r.manifest.id}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-2xl font-normal">{t.shareCollection}</h2>
      <p className="text-sm text-text2">{t.shareHelp}</p>
      <Card className="space-y-3 p-4">
        <p className="text-sm">
          {sourceName} · {t.worksCount(ids.length)}
        </p>
        <TextField label={t.shareTitle} value={title} onChange={set("title")} />
        <TextField label={t.shareId} value={id} onChange={set("id")} />
        <label className="block">
          <span className="sr-only">{t.shareDescription}</span>
          <textarea
            value={form.description}
            placeholder={t.shareDescription}
            onChange={(e) => set("description")(e.target.value)}
            rows={3}
            className="w-full appearance-none rounded-lg border border-solid border-[var(--color-divider)] bg-card p-3 text-sm text-text outline-none placeholder:text-text2 focus:border-primary"
          />
        </label>
        <TextField label={t.shareTags} value={form.tags} onChange={set("tags")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t.shareCurator} value={curator} onChange={set("curator")} />
          <TextField label={t.shareGithub} value={form.github} onChange={set("github")} />
        </div>
        <Button
          appearance="accent"
          disabled={!ids.length || share.isPending}
          onClick={() =>
            share.mutate({
              id,
              title,
              description: form.description,
              tags,
              curator: { name: curator, ...(form.github ? { github: form.github } : {}) },
              artworkIds: ids,
            })
          }
        >
          {t.prepare}
        </Button>
        {share.error && <Alert type="error">{share.error.message}</Alert>}
      </Card>

      {r && (
        <Card className="space-y-3 p-4">
          <p className="text-sm">{t.shareReady(r.manifest.items.length)}</p>
          {r.excluded.length > 0 && <Alert type="info">{t.shareExcluded(r.excluded.length)}</Alert>}
          {r.notForIssue.length > 0 && <Alert type="info">{t.shareNotForIssue(r.notForIssue.length)}</Alert>}
          {r.issueLeftOut > 0 && <Alert type="warning">{t.shareLeftOut(r.issueLeftOut)}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button appearance="filled" onClick={download}>
              <Icon path={mdiDownload} size={18} />
              {t.downloadJson}
            </Button>
            {r.works.length > 0 && (
              <a
                href={r.issueUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-[var(--text-primary-color,#fff)]"
              >
                <Icon path={mdiGithub} size={18} />
                {t.openIssue}
              </a>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

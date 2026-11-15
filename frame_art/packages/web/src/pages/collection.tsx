import { mdiDelete, mdiImagePlus, mdiPencil, mdiPlus } from "@mdi/js"
import { useNavigate } from "@tanstack/react-router"
import { useRef, useState } from "react"

import { ArtworkGrid } from "@/components/artwork-grid"
import { Alert, Button, Card, Chip, cn, Icon, IconButton, Spinner, TextField } from "@/components/ha"
import { useAlbumMutations, useAlbums, useArtworks, useUpload } from "@/lib/api"
import { useT } from "@/lib/i18n"

export function CollectionPage({ album }: { album: string | undefined }) {
  const t = useT()
  const navigate = useNavigate({ from: "/collection" })
  const albums = useAlbums()
  const ops = useAlbumMutations()
  const upload = useUpload()
  const works = useArtworks(album ? { album } : { source: "mine" })
  const items = works.data?.pages.flatMap((p) => p.items) ?? []
  const fileInput = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState("")
  const [drag, setDrag] = useState(false)
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null)
  const current = albums.data?.find((a) => a.id === album)

  const send = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"))
    if (images.length) upload.mutate({ files: images, albumId: album ?? null })
  }

  return (
    <div className="space-y-4">
      <Card className="p-4" header={t.upload}>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            send([...e.dataTransfer.files])
          }}
          className={cn(
            "mt-2 flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            drag ? "border-primary primary-soft" : "border-divider",
          )}
        >
          <Icon path={mdiImagePlus} size={36} className="text-text2" />
          <p className="max-w-md text-sm text-text2">{t.uploadHint}</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              send([...(e.target.files ?? [])])
              e.target.value = ""
            }}
          />
          <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Spinner size={18} /> : <Icon path={mdiPlus} size={18} />}
            {t.chooseFiles}
          </Button>
        </div>
        <div className="mt-3 flex gap-2">
          <TextField
            value={url}
            onChange={setUrl}
            type="url"
            label={t.fromUrl}
            placeholder="https://…"
            className="flex-1"
            onEnter={() => url && upload.mutate({ url, albumId: album ?? null }, { onSuccess: () => setUrl("") })}
          />
          <Button
            appearance="filled"
            disabled={!url || upload.isPending}
            onClick={() => upload.mutate({ url, albumId: album ?? null }, { onSuccess: () => setUrl("") })}
          >
            {t.add}
          </Button>
        </div>
        {upload.error && (
          <div className="mt-3">
            <Alert type="error">{upload.error.message}</Alert>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={!album} onClick={() => void navigate({ search: {} })}>
          {t.all}
        </Chip>
        {albums.data?.map((a) => (
          <Chip key={a.id} active={album === a.id} onClick={() => void navigate({ search: { album: a.id } })}>
            {a.name} <span className="text-xs text-text2">{a.count}</span>
          </Chip>
        ))}
        {naming ? (
          <div className="flex items-center gap-2">
            <TextField value={naming.name} onChange={(name) => setNaming({ ...naming, name })} label={t.albumName} />
            <Button
              onClick={() => {
                if (!naming.name.trim()) return
                if (naming.id)
                  ops.rename.mutate({ id: naming.id, name: naming.name }, { onSuccess: () => setNaming(null) })
                else
                  ops.create.mutate(naming.name, {
                    onSuccess: (a) => (setNaming(null), void navigate({ search: { album: a.id } })),
                  })
              }}
            >
              {t.save}
            </Button>
            <Button appearance="plain" variant="neutral" onClick={() => setNaming(null)}>
              {t.cancel}
            </Button>
          </div>
        ) : (
          <Button appearance="plain" onClick={() => setNaming({ id: null, name: "" })}>
            <Icon path={mdiPlus} size={18} />
            {t.newAlbum}
          </Button>
        )}
        {current && !naming && (
          <span className="ml-auto flex">
            <IconButton
              path={mdiPencil}
              label={t.rename}
              onClick={() => setNaming({ id: current.id, name: current.name })}
            />
            <IconButton
              path={mdiDelete}
              label={t.delete}
              onClick={() => {
                if (confirm(`${t.delete}: ${current.name}?`))
                  ops.remove.mutate(current.id, { onSuccess: () => void navigate({ search: {} }) })
              }}
            />
          </span>
        )}
      </div>

      {!works.isLoading && !items.length ? (
        <Alert type="info">{t.emptyCollection}</Alert>
      ) : (
        <ArtworkGrid
          items={items}
          hasMore={Boolean(works.hasNextPage)}
          loading={works.isLoading || works.isFetchingNextPage}
          loadMore={() => void works.fetchNextPage()}
        />
      )}
    </div>
  )
}

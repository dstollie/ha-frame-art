import { Link } from "@tanstack/react-router"
import { Heart } from "lucide-react"

import { ArtworkGrid } from "@/components/artwork-grid"
import { useArtworks } from "@/lib/api"

export function FavouritesPage() {
  const works = useArtworks({ favourites: true })
  const items = works.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-light tracking-tight sm:text-[2.6rem]">Favorieten</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kies “Favorieten” als rotatie in Instellingen om deze af te wisselen.
        </p>
      </header>
      {!works.isLoading && items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <Heart className="size-6" />
          Nog geen favorieten.{" "}
          <Link to="/" className="text-primary">
            Ga ontdekken
          </Link>
        </div>
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

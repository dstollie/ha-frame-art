/** "My collection": the user's own uploads, stored under /data/collection. Not harvested. */
import type { ArtProvider } from "./types.js"

export const MINE = "mine"

export const provider: ArtProvider = {
  id: MINE,
  name: "My collection",
  description: "Your own uploads, organised in albums.",
  homepage: "",
  licence: "Yours",
  defaultEnabled: true,
  thumbnails: "proxy",
  downloadUrl: (art) => art.imageUrl,
}

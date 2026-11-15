import * as aic from "./aic.js"
import * as cleveland from "./cleveland.js"
import * as europeana from "./europeana.js"
import * as met from "./met.js"
import * as mine from "./mine.js"
import * as rijks from "./rijks.js"
import * as smithsonian from "./smithsonian.js"
import * as smk from "./smk.js"
import type { ArtProvider } from "./types.js"
import * as wikimedia from "./wikimedia.js"

/** Every provider the add-on knows, in the order Settings shows them. Add new ones here. */
export const PROVIDERS: ArtProvider[] = [
  mine.provider,
  met.provider,
  aic.provider,
  rijks.provider,
  cleveland.provider,
  smk.provider,
  wikimedia.provider,
  europeana.provider,
  smithsonian.provider,
]

export const providerById = (id: string, list: ArtProvider[] = PROVIDERS) => list.find((p) => p.id === id)

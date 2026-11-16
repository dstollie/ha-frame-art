/** Which art providers are on, and their API keys. Settings live in SQLite, edited in the panel. */
import type { Store } from "./db.js"
import { PROVIDERS } from "./providers/registry.js"
import type { ArtProvider } from "./providers/types.js"

export interface SourceState {
  provider: ArtProvider
  enabled: boolean
  apiKey: string | null
}

export class Sources {
  constructor(
    private readonly store: Store,
    readonly providers: ArtProvider[] = PROVIDERS,
  ) {}

  get(id: string): ArtProvider | undefined {
    return this.providers.find((p) => p.id === id)
  }

  list(): SourceState[] {
    const saved = this.store.sourceSettings()
    return this.providers.map((provider) => {
      const s = saved.get(provider.id)
      const apiKey = s?.apiKey ?? null
      const wanted = s ? s.enabled : provider.defaultEnabled
      // A provider that needs a key is never on without one.
      const enabled = wanted && !(provider.apiKey?.required && !apiKey)
      return { provider, enabled, apiKey }
    })
  }

  enabledIds(): string[] {
    return this.list()
      .filter((s) => s.enabled)
      .map((s) => s.provider.id)
  }

  set(id: string, value: { enabled: boolean; apiKey?: string | null }) {
    if (!this.get(id)) throw new Error(`Unknown source ${id}`)
    const apiKey = value.apiKey === undefined ? undefined : value.apiKey?.trim() || null
    this.store.setSourceSetting(id, { enabled: value.enabled, ...(apiKey === undefined ? {} : { apiKey }) })
  }

  /** For the panel: never the key itself, only whether one is set. */
  toDTO() {
    const counts = this.store.sourceCounts()
    return this.list().map(({ provider: p, enabled, apiKey }) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      homepage: p.homepage,
      licence: p.licence,
      enabled,
      local: !p.search,
      apiKey: p.apiKey ? { required: p.apiKey.required, helpUrl: p.apiKey.helpUrl, set: Boolean(apiKey) } : null,
      count: counts[p.id] ?? 0,
    }))
  }
}

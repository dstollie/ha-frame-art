import { mdiCheck, mdiContentCopy, mdiEye, mdiEyeOff, mdiLinkVariant, mdiOpenInNew, mdiRefresh } from "@mdi/js"
import { useState } from "react"

import { Alert, Button, Card, Icon, IconButton, Select, Spinner, Switch, TextField } from "@/components/ha"
import {
  useConfig,
  useHaUrls,
  useMcp,
  usePair,
  useRotateMcp,
  useSetCategory,
  useSetDisplay,
  useSetSource,
  useCollections,
  useSetCollection,
  useSources,
  useStartSync,
  useSync,
  useTvs,
  type SourceSetting,
  type TvState,
} from "@/lib/api"
import { useLanguage } from "@/lib/hass"
import { useLocale, useT } from "@/lib/i18n"
import { claudeCommand, mcpEndpoints, type McpEndpoint } from "@/lib/mcp"

function Row({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{title}</p>
        {help && <p className="text-xs text-text2">{help}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function TvCard({ tv }: { tv: TvState }) {
  const t = useT()
  const lang = useLanguage()
  const config = useConfig()
  const pair = usePair()
  const setDisplay = useSetDisplay()
  const setCategory = useSetCategory()
  const [repair, setRepair] = useState(false)
  const rotation = config.data?.rotation ?? []
  const catLabel = (id: string, fallback: string) =>
    config.data?.categories.find((c) => c.id === id)?.label[lang] ?? fallback

  return (
    <Card
      label={`TV ${tv.name}`}
      header={
        <span className="flex items-center gap-2">
          {tv.name}
          <span className="text-xs font-normal text-text2">
            {tv.on ? t.tvOn : t.tvOff.split(" ·")[0]}
            {!tv.canWake && ` · ${t.noWake}`}
          </span>
        </span>
      }
    >
      <div className="px-4 pb-3">
        {tv.paired && !repair ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-sm text-success">
              <Icon path={mdiCheck} size={18} /> {t.paired}
            </span>
            <Button appearance="plain" variant="neutral" onClick={() => setRepair(true)}>
              {t.repair}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Alert type="info">{t.pairHelp(tv.name)}</Alert>
            {!tv.on && <Alert type="warning">{t.tvLooksOff}</Alert>}
            <div className="flex gap-2">
              <Button
                disabled={pair.isPending}
                onClick={() => pair.mutate(tv.id, { onSuccess: () => setRepair(false) })}
              >
                {pair.isPending ? <Spinner size={18} /> : <Icon path={mdiLinkVariant} size={18} />}
                {pair.isPending ? t.waitingAllow : t.pair}
              </Button>
              {tv.paired && (
                <Button appearance="plain" variant="neutral" onClick={() => setRepair(false)}>
                  {t.cancel}
                </Button>
              )}
            </div>
            {pair.error && <Alert type="error">{pair.error.message}</Alert>}
          </div>
        )}
      </div>
      <Row title={t.display} help={t.displayHelp}>
        <Select
          label={`${t.display} ${tv.name}`}
          value={tv.display}
          onChange={(d) => setDisplay.mutate({ tv: tv.id, display: d as "fill" | "matte", matteStyle: tv.matteStyle })}
          options={[
            { value: "fill", label: t.fill },
            { value: "matte", label: t.matte },
          ]}
        />
        {tv.display === "matte" && (
          <Select
            label={`${t.matte} ${tv.name}`}
            value={tv.matteStyle}
            onChange={(s) =>
              setDisplay.mutate({ tv: tv.id, display: "matte", matteStyle: s as "light" | "dark" | "blur" })
            }
            options={[
              { value: "light", label: t.matteLight },
              { value: "dark", label: t.matteDark },
              { value: "blur", label: t.matteBlur },
            ]}
          />
        )}
      </Row>
      <Row title={t.rotation} help={t.rotationHelp}>
        <Select
          label={`${t.rotation} ${tv.name}`}
          value={tv.category}
          onChange={(category) => setCategory.mutate({ tv: tv.id, category })}
          options={rotation.map((r) => ({
            value: r.id,
            label:
              r.id === "all"
                ? t.all
                : r.id === "favourites"
                  ? t.favourite
                  : r.id === "collection"
                    ? t.tabCollection
                    : catLabel(r.id, r.label),
          }))}
        />
      </Row>
    </Card>
  )
}

/** The catalogue's collections from frame-art-collections, each on or off. */
function CollectionsCard() {
  const t = useT()
  const cols = useCollections()
  const set = useSetCollection()
  return (
    <Card header={t.collectionsLabel}>
      <p className="px-4 pb-2 text-sm text-text2">{t.collectionsHelp}</p>
      {cols.error && (
        <div className="px-4 pb-3">
          <Alert type="error" title={t.loadFailed}>
            {cols.error.message}
          </Alert>
        </div>
      )}
      {cols.isLoading && <div className="mx-4 mb-3 h-10 animate-pulse rounded bg-bg2" />}
      {cols.data?.map((c) => (
        <div key={c.id} className="flex items-center gap-3 border-t border-divider px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{c.title}</p>
            <p className="text-xs text-text2">
              {t.worksCount(c.count)}
              {c.aiCount > 0 ? ` · ${t.aiCount(c.aiCount)}` : ""} · {t.curatedBy(c.curator)}
            </p>
          </div>
          <Switch label={c.title} checked={c.enabled} onChange={(enabled) => set.mutate({ id: c.id, enabled })} />
        </div>
      ))}
    </Card>
  )
}

function SourceRow({ s }: { s: SourceSetting }) {
  const t = useT()
  const set = useSetSource()
  const [key, setKey] = useState("")
  return (
    <div className="border-t border-divider px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            {s.name}
            <span className="text-xs text-text2">
              {s.licence}
              {s.count ? ` · ${s.count.toLocaleString()}` : ""}
            </span>
            {s.homepage && (
              <a
                href={s.homepage}
                target="_blank"
                rel="noreferrer"
                className="text-text2 hover:text-primary"
                aria-label={s.homepage}
              >
                <Icon path={mdiOpenInNew} size={14} />
              </a>
            )}
          </p>
          <p className="text-xs text-text2">{s.description}</p>
        </div>
        <Switch
          checked={s.enabled}
          disabled={set.isPending || (Boolean(s.apiKey?.required) && !s.apiKey?.set && !key)}
          onChange={(on) => set.mutate({ id: s.id, enabled: on, ...(key ? { apiKey: key } : {}) })}
          label={s.name}
        />
      </div>
      {s.apiKey && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TextField
            value={key}
            onChange={setKey}
            type="password"
            label={t.apiKey}
            placeholder={s.apiKey.set ? `${t.apiKeySet} ••••` : s.apiKey.required ? t.needsKey : t.apiKey}
            className="min-w-[220px] flex-1"
          />
          <Button
            appearance="filled"
            disabled={!key || set.isPending}
            onClick={() => set.mutate({ id: s.id, enabled: true, apiKey: key }, { onSuccess: () => setKey("") })}
          >
            {t.save}
          </Button>
          <a href={s.apiKey.helpUrl} target="_blank" rel="noreferrer" className="text-sm text-primary">
            {t.getKey}
          </a>
        </div>
      )}
    </div>
  )
}

function McpCard() {
  const t = useT()
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const mcp = useMcp(true)
  const urls = useHaUrls()
  const rotate = useRotateMcp()
  const endpoints = mcpEndpoints(urls.data, location.origin, mcp.data?.path)
  const [picked, setPicked] = useState<string | null>(null)
  const endpoint = endpoints.find((e) => e.url === picked)?.url ?? endpoints[0]?.url ?? ""
  const token = mcp.data?.token ?? ""
  const copy = async (what: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(what)
    setTimeout(() => setCopied(null), 1500)
  }
  const label = (e: McpEndpoint) =>
    e.label === "remote"
      ? e.cloud
        ? t.endpointCloud
        : t.endpointRemote
      : e.label === "local"
        ? t.endpointLocal
        : t.endpointBrowser
  const command = claudeCommand(endpoint, visible && token ? token : null)

  return (
    <Card header={t.mcp} label={t.mcp}>
      <p className="px-4 text-sm text-text2">{t.mcpHelp}</p>
      <Row title={t.endpoint}>
        {endpoints.length > 1 && (
          <Select
            label={t.endpoint}
            value={endpoint}
            onChange={setPicked}
            options={endpoints.map((e) => ({ value: e.url, label: label(e) }))}
          />
        )}
        <code className="rounded bg-bg2 px-2 py-1 text-xs break-all" data-testid="mcp-endpoint">
          {endpoint}
        </code>
        <IconButton
          path={copied === "endpoint" ? mdiCheck : mdiContentCopy}
          label={t.copy}
          onClick={() => void copy("endpoint", endpoint)}
        />
      </Row>
      <Row title={t.token}>
        <code className="rounded bg-bg2 px-2 py-1 text-xs break-all">{visible ? token : "••••••••••••••••"}</code>
        <IconButton path={visible ? mdiEyeOff : mdiEye} label={t.show} onClick={() => setVisible(!visible)} />
        <IconButton
          path={copied === "token" ? mdiCheck : mdiContentCopy}
          label={t.copy}
          onClick={() => void copy("token", token)}
        />
        <Button appearance="plain" variant="danger" onClick={() => confirm(t.rotateConfirm) && rotate.mutate()}>
          <Icon path={mdiRefresh} size={18} />
          {t.rotate}
        </Button>
      </Row>
      <div className="flex items-start gap-2 border-t border-divider px-4 py-3">
        <pre className="flex-1 overflow-x-auto rounded bg-bg2 p-3 text-xs" data-testid="mcp-command">
          {command}
        </pre>
        <IconButton
          path={copied === "command" ? mdiCheck : mdiContentCopy}
          label={t.copy}
          onClick={() => void copy("command", command)}
        />
      </div>
      {!visible && <p className="px-4 pb-3 text-xs text-text2">{t.commandTokenHint}</p>}
    </Card>
  )
}

export function SettingsPage() {
  const t = useT()
  const locale = useLocale()
  const tvs = useTvs()
  const sources = useSources()
  const sync = useSync()
  const startSync = useStartSync()
  const s = sync.data

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h2 className="text-sm font-medium text-text2">{t.tvs}</h2>
      {tvs.data?.map((tv) => (
        <TvCard key={tv.id} tv={tv} />
      ))}

      <CollectionsCard />

      <Card header={t.liveSources}>
        <p className="px-4 pb-2 text-sm text-text2">{t.liveSourcesHelp}</p>
        {sources.error && (
          <div className="px-4 pb-3">
            <Alert type="error" title={t.loadFailed}>
              {sources.error.message}
            </Alert>
          </div>
        )}
        {sources.isLoading && <div className="mx-4 mb-3 h-10 animate-pulse rounded bg-bg2" />}
        {sources.data
          ?.filter((src) => !src.local)
          .map((src) => (
            <SourceRow key={src.id} s={src} />
          ))}
      </Card>

      <McpCard />

      <Card header={t.catalogue}>
        <dl className="grid grid-cols-2 gap-4 px-4 pb-3 sm:grid-cols-4">
          {[
            [t.catalogueWorks, s ? s.total.toLocaleString(locale) : "…"],
            [t.catalogueColours, s ? s.withColor.toLocaleString(locale) : "…"],
            [t.cache, s ? `${Math.round(s.cacheBytes / 1_048_576)} MB` : "…"],
            [
              t.lastSync,
              s?.lastRun ? new Date(s.lastRun).toLocaleDateString(locale, { day: "numeric", month: "short" }) : t.never,
            ],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-text2">{k}</dt>
              <dd className="text-xl">{v}</dd>
            </div>
          ))}
        </dl>
        <Row title={s?.state === "running" ? t.syncing(s.source ?? "…", s.added) : t.nightly}>
          <Button
            appearance="filled"
            disabled={s?.state === "running" || startSync.isPending}
            onClick={() => startSync.mutate()}
          >
            {s?.state === "running" ? <Spinner size={18} /> : <Icon path={mdiRefresh} size={18} />}
            {t.syncNow}
          </Button>
        </Row>
        {s?.error && (
          <div className="px-4 pb-3">
            <Alert type="warning">{s.error}</Alert>
          </div>
        )}
        {(sync.error ?? startSync.error) && (
          <div className="px-4 pb-3">
            <Alert type="error" title={t.loadFailed}>
              {(sync.error ?? startSync.error)!.message}
            </Alert>
          </div>
        )}
        {startSync.isSuccess && s?.state !== "running" && (
          <p role="status" className="px-4 pb-3 text-sm text-text2">
            {startSync.data.started ? t.syncStarted : t.syncAlreadyRunning}
          </p>
        )}
      </Card>
    </div>
  )
}

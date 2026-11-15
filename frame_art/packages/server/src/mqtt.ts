/**
 * MQTT discovery: per TV a button (new painting), a select (rotation), a sensor and an image entity;
 * per TV a series select with next / pause / stop buttons; per series a sensor.
 */
import mqtt, { type MqttClient } from "mqtt"

import { CATEGORIES } from "./categorize.js"
import type { TVConfig } from "./config.js"
import type { MqttConn } from "./ha.js"
import type { Artwork } from "./models.js"

export const PREFIX = "frame_art"
export const DISCOVERY = "homeassistant"
export const AVAILABILITY = `${PREFIX}/status`

export const ROTATION_OPTIONS: readonly (readonly [string, string])[] = [
  ["all", "All"],
  ["favourites", "Favourites"],
  ["collection", "My collection"],
  ...CATEGORIES.map((c) => [c.id, c.en] as const),
]
export const LABEL_TO_ID: Record<string, string> = Object.fromEntries(
  ROTATION_OPTIONS.map(([id, label]) => [label, id]),
)
export const ID_TO_LABEL: Record<string, string> = Object.fromEntries(ROTATION_OPTIONS)

export const NO_SERIES = "—"

export interface SeriesInfo {
  id: string
  name: string
  count: number
  duration: number
  totalDuration: number
  shuffle: boolean
  playingOn: string[]
}
/** What HA gets per series: a summary with a cover. */
export type SeriesEntity = SeriesInfo & { coverTitle: string | null; coverId: string | null }

/** Select labels per series id; equal names get " (2)", " (3)". */
export function seriesLabels(list: { id: string; name: string }[]): Map<string, string> {
  const seen = new Map<string, number>()
  return new Map(
    list.map((s) => {
      const n = (seen.get(s.name) ?? 0) + 1
      seen.set(s.name, n)
      return [s.id, n === 1 ? s.name : `${s.name} (${n})`]
    }),
  )
}

const device = (tv: TVConfig) => ({
  identifiers: [`frame_art_${tv.id}`],
  name: `Frame Art ${tv.name}`,
  manufacturer: "Frame Art",
  model: "Samsung The Frame",
})

export function seriesDiscovery(tvs: TVConfig[], list: SeriesEntity[]): [string, Record<string, unknown>][] {
  const labels = seriesLabels(list)
  const msgs: [string, Record<string, unknown>][] = []
  for (const tv of tvs) {
    const base = `${PREFIX}/${tv.id}`
    const common = { availability_topic: AVAILABILITY, device: device(tv) }
    msgs.push([
      `${DISCOVERY}/select/frame_art_${tv.id}/series/config`,
      {
        ...common,
        name: "Serie",
        unique_id: `frame_art_${tv.id}_series`,
        default_entity_id: `select.frame_art_${tv.id}_serie`,
        command_topic: `${base}/series/set`,
        state_topic: `${base}/series`,
        json_attributes_topic: `${base}/series/attributes`,
        options: [NO_SERIES, ...labels.values()],
        icon: "mdi:playlist-play",
      },
    ])
    for (const [key, name, icon] of [
      ["series_next", "Serie volgende", "mdi:skip-next"],
      ["series_pause", "Serie pauze/hervat", "mdi:play-pause"],
      ["series_stop", "Serie stop", "mdi:stop"],
    ] as const) {
      msgs.push([
        `${DISCOVERY}/button/frame_art_${tv.id}/${key}/config`,
        {
          ...common,
          name,
          unique_id: `frame_art_${tv.id}_${key}`,
          default_entity_id: `button.frame_art_${tv.id}_${key}`,
          command_topic: `${base}/${key}/set`,
          icon,
        },
      ])
    }
  }
  for (const s of list) {
    msgs.push([
      `${DISCOVERY}/sensor/frame_art_series_${s.id}/state/config`,
      {
        availability_topic: AVAILABILITY,
        device: {
          identifiers: ["frame_art_series"],
          name: "Frame Art Series",
          manufacturer: "Frame Art",
          model: "Series",
        },
        name: labels.get(s.id) ?? s.name,
        unique_id: `frame_art_series_${s.id}`,
        state_topic: `${PREFIX}/series/${s.id}`,
        json_attributes_topic: `${PREFIX}/series/${s.id}/attributes`,
        unit_of_measurement: "works",
        icon: "mdi:playlist-star",
      },
    ])
  }
  return msgs
}

export function seriesPayloads(list: SeriesEntity[]): [string, string][] {
  return list.flatMap((s) => [
    [`${PREFIX}/series/${s.id}`, String(s.count)],
    [
      `${PREFIX}/series/${s.id}/attributes`,
      JSON.stringify({
        series_id: s.id,
        duration_minutes: Math.round(s.duration / 60),
        total_minutes: Math.round(s.totalDuration / 60),
        shuffle: s.shuffle,
        playing_on: s.playingOn,
        cover_title: s.coverTitle,
        cover_artwork_id: s.coverId,
      }),
    ],
  ])
}

export function discoveryMessages(tv: TVConfig): [string, Record<string, unknown>][] {
  const base = `${PREFIX}/${tv.id}`
  const common = {
    availability_topic: AVAILABILITY,
    device: {
      identifiers: [`frame_art_${tv.id}`],
      name: `Frame Art ${tv.name}`,
      manufacturer: "Frame Art",
      model: "Samsung The Frame",
    },
  }
  return [
    [
      `${DISCOVERY}/button/frame_art_${tv.id}/new/config`,
      {
        ...common,
        name: "Nieuw schilderij",
        unique_id: `frame_art_${tv.id}_new`,
        default_entity_id: `button.frame_art_${tv.id}_nieuw`,
        command_topic: `${base}/new/set`,
        icon: "mdi:image-refresh",
      },
    ],
    [
      `${DISCOVERY}/select/frame_art_${tv.id}/category/config`,
      {
        ...common,
        name: "Rotatie",
        unique_id: `frame_art_${tv.id}_category`,
        default_entity_id: `select.frame_art_${tv.id}_rotatie`,
        command_topic: `${base}/category/set`,
        state_topic: `${base}/category`,
        options: ROTATION_OPTIONS.map(([, l]) => l),
        icon: "mdi:palette",
      },
    ],
    [
      `${DISCOVERY}/sensor/frame_art_${tv.id}/current/config`,
      {
        ...common,
        name: "Schilderij",
        unique_id: `frame_art_${tv.id}_current`,
        default_entity_id: `sensor.frame_art_${tv.id}_schilderij`,
        state_topic: `${base}/current`,
        json_attributes_topic: `${base}/current/attributes`,
        icon: "mdi:image-frame",
      },
    ],
    [
      `${DISCOVERY}/image/frame_art_${tv.id}/current/config`,
      {
        ...common,
        name: "Schilderij",
        unique_id: `frame_art_${tv.id}_image`,
        default_entity_id: `image.frame_art_${tv.id}_schilderij`,
        image_topic: `${base}/current/image`,
        content_type: "image/jpeg",
      },
    ],
  ]
}

export function currentPayloads(tvId: string, art: Artwork): [string, string][] {
  const base = `${PREFIX}/${tvId}`
  return [
    [`${base}/current`, art.title.slice(0, 250)],
    [
      `${base}/current/attributes`,
      JSON.stringify({
        artist: art.artist,
        date: art.dateText,
        source: art.source,
        artwork_id: art.id,
        page: art.pageUrl,
        categories: art.categories,
      }),
    ],
  ]
}

export interface MqttHandlers {
  onNew(tv: string): Promise<void>
  onCategory(tv: string, category: string): Promise<void>
  categoryOf(tv: string): string
  onSeries?(tv: string, label: string): Promise<void>
  onPlayback?(tv: string, action: "toggle" | "next" | "stop"): Promise<unknown>
}

export interface PlaybackInfo {
  seriesId: string
  status: string
  current: { title: string } | null
  next: { title: string } | null
  nextAt: number | null
}

export class MqttBridge {
  private client: MqttClient | null = null
  private lastSeries: Parameters<MqttBridge["publishSeries"]> | null = null

  constructor(
    private readonly tvs: TVConfig[],
    private readonly conn: MqttConn,
    private readonly handlers: MqttHandlers,
  ) {}

  start(): void {
    const client = mqtt.connect({
      host: this.conn.host,
      port: Number(this.conn.port ?? 1883),
      protocol: this.conn.ssl ? "mqtts" : "mqtt",
      ...(this.conn.username ? { username: this.conn.username } : {}),
      ...(this.conn.password ? { password: this.conn.password } : {}),
      clientId: "frame_art",
      reconnectPeriod: 15_000,
      will: { topic: AVAILABILITY, payload: Buffer.from("offline"), retain: true, qos: 1 },
    })
    this.client = client
    client.on("connect", () => {
      for (const tv of this.tvs) {
        for (const [topic, payload] of discoveryMessages(tv))
          client.publish(topic, JSON.stringify(payload), { retain: true })
        client.publish(`${PREFIX}/${tv.id}/category`, ID_TO_LABEL[this.handlers.categoryOf(tv.id)] ?? "Alles", {
          retain: true,
        })
        client.subscribe(`${PREFIX}/${tv.id}/+/set`)
      }
      if (this.lastSeries) this.publishSeries(...this.lastSeries)
      client.publish(AVAILABILITY, "online", { retain: true })
    })
    client.on("message", (topic, payload) => void this.onMessage(topic, payload.toString()))
    client.on("error", () => undefined) // reconnects on its own
  }

  async onMessage(topic: string, payload: string): Promise<void> {
    const [, tvId, what, set] = topic.split("/")
    if (!tvId || set !== "set" || !this.tvs.some((t) => t.id === tvId)) return
    if (what === "new") await this.handlers.onNew(tvId)
    if (what === "series") await this.handlers.onSeries?.(tvId, payload)
    if (what === "series_next") await this.handlers.onPlayback?.(tvId, "next")
    if (what === "series_pause") await this.handlers.onPlayback?.(tvId, "toggle")
    if (what === "series_stop") await this.handlers.onPlayback?.(tvId, "stop")
    if (what === "category") {
      const id = LABEL_TO_ID[payload] ?? payload
      await this.handlers.onCategory(tvId, id)
      this.publish(`${PREFIX}/${tvId}/category`, ID_TO_LABEL[id] ?? payload)
    }
  }

  publish(topic: string, payload: string | Buffer, retain = true) {
    this.client?.publish(topic, payload, { retain })
  }

  publishCurrent(tvId: string, art: Artwork, thumb: Buffer) {
    for (const [topic, payload] of currentPayloads(tvId, art)) this.publish(topic, payload)
    this.publish(`${PREFIX}/${tvId}/current/image`, thumb)
  }

  publishSeries(
    list: (SeriesInfo & { cover: { id: string; title: string } | null })[],
    states: { tv: string; playback: PlaybackInfo | null }[],
  ) {
    const entities: SeriesEntity[] = list.map(({ cover, ...s }) => ({
      ...s,
      coverTitle: cover?.title ?? null,
      coverId: cover?.id ?? null,
    }))
    for (const [topic, payload] of seriesDiscovery(this.tvs, entities)) this.publish(topic, JSON.stringify(payload))
    for (const [topic, payload] of seriesPayloads(entities)) this.publish(topic, payload)
    const labels = seriesLabels(list)
    for (const { tv, playback: p } of states) {
      this.publish(`${PREFIX}/${tv}/series`, p ? (labels.get(p.seriesId) ?? NO_SERIES) : NO_SERIES)
      this.publish(
        `${PREFIX}/${tv}/series/attributes`,
        JSON.stringify({
          status: p?.status ?? "stopped",
          current: p?.current?.title ?? null,
          next: p?.next?.title ?? null,
          next_at: p?.nextAt ? new Date(p.nextAt * 1000).toISOString() : null,
        }),
      )
    }
    this.lastSeries = [list, states]
  }

  /** A deleted series: its sensor disappears from HA. */
  removeSeries(id: string) {
    this.publish(`${DISCOVERY}/sensor/frame_art_series_${id}/state/config`, "")
  }

  stop() {
    this.client?.publish(AVAILABILITY, "offline", { retain: true })
    this.client?.end()
  }
}

/** MQTT discovery: per TV a button (new painting), a select (rotation), a sensor and an image entity. */
import mqtt, { type MqttClient } from "mqtt"

import { CATEGORIES } from "./categorize.js"
import type { TVConfig } from "./config.js"
import type { MqttConn } from "./ha.js"
import type { Artwork } from "./models.js"

export const PREFIX = "frame_art"
export const DISCOVERY = "homeassistant"
export const AVAILABILITY = `${PREFIX}/status`

export const ROTATION_OPTIONS = [["alles", "Alles"], ["favorieten", "Favorieten"], ...CATEGORIES] as const
export const LABEL_TO_ID: Record<string, string> = Object.fromEntries(
  ROTATION_OPTIONS.map(([id, label]) => [label, id]),
)
export const ID_TO_LABEL: Record<string, string> = Object.fromEntries(ROTATION_OPTIONS)

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
}

export class MqttBridge {
  private client: MqttClient | null = null

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
      client.publish(AVAILABILITY, "online", { retain: true })
    })
    client.on("message", (topic, payload) => void this.onMessage(topic, payload.toString()))
    client.on("error", () => undefined) // reconnects on its own
  }

  async onMessage(topic: string, payload: string): Promise<void> {
    const [, tvId, what, set] = topic.split("/")
    if (!tvId || set !== "set" || !this.tvs.some((t) => t.id === tvId)) return
    if (what === "new") await this.handlers.onNew(tvId)
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

  stop() {
    this.client?.publish(AVAILABILITY, "offline", { retain: true })
    this.client?.end()
  }
}

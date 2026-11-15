import { hostname } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { serve } from "@hono/node-server"

import { createApp } from "./app.js"
import { loadSettings, paths } from "./config.js"
import { SupervisorHA } from "./ha.js"
import { MqttBridge } from "./mqtt.js"
import { FrameTV, type TV } from "./tv.js"

const settings = loadSettings()
const tvs = new Map<string, TV>(settings.tvs.map((t) => [t.id, new FrameTV(t, paths(settings).tokens)]))
const ha = new SupervisorHA(settings.supervisorToken)
const staticDir =
  process.env.FRAME_ART_STATIC ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")
const { app, svc } = createApp({ settings, tvs, ha, staticDir, auth: "addon" })

const port = Number(process.env.PORT ?? 8099)
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`Frame Art on :${port}, ${settings.tvs.length} TV(s), catalogue ${svc.store.count()} works`)
})

// Supervisor discovery: the Frame Art integration picks this up and sets itself up with the internal token.
void ha
  .discover("frame_art", { host: hostname(), port, token: svc.tokens.internal })
  .then((ok) => console.log(ok ? "Announced to Home Assistant (discovery)" : "Discovery not available"))

void svc.syncer.loop(settings.syncHour, settings.syncOnStart).catch((e) => console.error("sync loop", e))

if (settings.mqtt) {
  const conn = await ha.mqttService()
  if (conn) {
    svc.mqtt = new MqttBridge(settings.tvs, conn, {
      onNew: async (tv) => {
        try {
          svc.next(tv)
        } catch (e) {
          console.warn(`MQTT new on ${tv}:`, e instanceof Error ? e.message : e)
        }
      },
      onCategory: (tv, cat) => svc.setCategory(tv, cat),
      categoryOf: svc.categoryOf,
    })
    svc.mqtt.start()
    console.log("MQTT discovery on")
  } else {
    console.warn("No MQTT service from the Supervisor; HA entities are off")
  }
}

const shutdown = () => {
  svc.syncer.stop()
  svc.mqtt?.stop()
  svc.store.close()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

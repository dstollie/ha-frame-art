import { describe, expect, it } from "vitest"

import { currentPayloads, discoveryMessages } from "../src/mqtt.js"
import { art } from "./helpers.js"

describe("MQTT discovery", () => {
  const tv = { id: "woonkamer", name: "Woonkamer", host: "x", wakeEntity: null }
  it("announces a button, select, sensor and image per TV, all on one device", () => {
    const msgs = Object.fromEntries(discoveryMessages(tv))
    expect(Object.keys(msgs)).toEqual([
      "homeassistant/button/frame_art_woonkamer/new/config",
      "homeassistant/select/frame_art_woonkamer/category/config",
      "homeassistant/sensor/frame_art_woonkamer/current/config",
      "homeassistant/image/frame_art_woonkamer/current/config",
    ])
    expect(msgs["homeassistant/button/frame_art_woonkamer/new/config"]).toMatchObject({
      command_topic: "frame_art/woonkamer/new/set",
      default_entity_id: "button.frame_art_woonkamer_nieuw",
      availability_topic: "frame_art/status",
    })
    expect(
      (msgs["homeassistant/select/frame_art_woonkamer/category/config"] as { options: string[] }).options,
    ).toContain("Gouden Eeuw")
    const ids = Object.values(msgs).map((m) => JSON.stringify((m as { device: unknown }).device))
    expect(new Set(ids).size).toBe(1)
  })
  it("publishes the current work with attributes", () => {
    const [[t1, title], [t2, attrs]] = currentPayloads("woonkamer", art("met:1", { title: "Water Lilies" }))
    expect([t1, title]).toEqual(["frame_art/woonkamer/current", "Water Lilies"])
    expect(t2).toBe("frame_art/woonkamer/current/attributes")
    expect(JSON.parse(attrs!)).toMatchObject({ artwork_id: "met:1", artist: "Claude Monet" })
  })
})

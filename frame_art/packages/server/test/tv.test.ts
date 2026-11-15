import { describe, expect, it } from "vitest"

import { isRoutineEvent } from "../src/tv.js"

describe("art channel log noise", () => {
  it("treats the TV's routine broadcasts as known, and anything else as worth logging", () => {
    for (const event of [
      "send_image",
      "select_image",
      "image_selected",
      "recently_set_updated",
      "art_mode_changed",
      "artmode_status",
      "image_added",
      "go_to_standby",
      "wakeup",
    ])
      expect(isRoutineEvent({ event }), event).toBe(true)
    expect(isRoutineEvent({ event: "error", error_code: "-1" })).toBe(false)
    expect(isRoutineEvent({ event: "something_new" })).toBe(false)
  })
})

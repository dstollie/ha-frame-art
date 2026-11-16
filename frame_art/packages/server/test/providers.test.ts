import path from "node:path"

import { describe, expect, it } from "vitest"

import { Store } from "../src/db.js"
import * as aic from "../src/providers/aic.js"
import * as europeana from "../src/providers/europeana.js"
import { PROVIDERS } from "../src/providers/registry.js"
import * as smithsonian from "../src/providers/smithsonian.js"
import * as smk from "../src/providers/smk.js"
import * as wikimedia from "../src/providers/wikimedia.js"
import { Sources } from "../src/sources.js"
import { fixture, tempSettings } from "./helpers.js"

describe("registry", () => {
  it("has unique ids and every provider can produce a download URL", () => {
    const ids = PROVIDERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(
      expect.arrayContaining([
        "mine",
        "met",
        "aic",
        "rijks",
        "cleveland",
        "smk",
        "wikimedia",
        "europeana",
        "smithsonian",
      ]),
    )
    for (const p of PROVIDERS) expect(p.downloadUrl({ imageUrl: "https://x/y.jpg" } as never)).toBeTruthy()
  })
})

describe("Art Institute of Chicago", () => {
  it("parses public-domain paintings with IIIF and needs the AIC user agent for images", () => {
    const items = fixture("aic_page.json").data.map(aic.parseItem)
    const bedroom = items.find((a: { title: string } | null) => a?.title === "The Bedroom")
    expect(bedroom).toMatchObject({ source: "aic", licence: "CC0", artist: "Vincent van Gogh" })
    expect(bedroom.imageUrl).toMatch(/\/full\/!3000,3000\/0\/default\.jpg$/)
    expect(bedroom.aspect).toBeCloseTo(12614 / 9875, 3)
    expect(aic.provider.thumbnails).toBe("proxy")
    expect(aic.provider.imageHeaders).toHaveProperty("AIC-User-Agent")
  })
  it("searches public-domain works with an image", () => {
    const body = aic.searchBody("bedroom", 12)
    expect(body).toMatchObject({ q: "bedroom", limit: 12 })
    expect(JSON.stringify(body.query)).toContain("is_public_domain")
  })
})

describe("SMK", () => {
  it("parses public-domain paintings with IIIF and maps Danish nationality", () => {
    const art = smk.parseItem(fixture("smk_page.json").items[0])!
    expect(art).toMatchObject({
      id: "smk:KMS8914",
      source: "smk",
      artist: "Mogens Ballin",
      nationality: "Danish",
      year: 1891,
    })
    expect(art.imageUrl).toBe("https://iip.smk.dk/iiif/jp2/gf06g715p_kms8914.tif.jp2/full/!4096,4096/0/default.jpg")
    expect(smk.searchUrl("ballin", 12)).toContain("keys=ballin")
  })
})

describe("Wikimedia Commons", () => {
  it("splits artist and title from the file name and keeps public domain only", () => {
    expect(wikimedia.splitFileTitle("File:Jan Gossaert - Portrait of a Man - Google Art Project.jpg")).toEqual([
      "Jan Gossaert",
      "Portrait of a Man",
    ])
    const pages = fixture("wikimedia_page.json").query.pages
    const arts = pages.map(wikimedia.parsePage).filter(Boolean)
    expect(arts.length).toBeGreaterThan(0)
    for (const a of arts) expect(a.licence).toBe("Public domain")
    const big = arts.find((a: { maxPx: number | null }) => (a.maxPx ?? 0) >= 3840)
    if (big) expect(big.imageUrl).toContain("Special:FilePath")
    expect(
      wikimedia.parsePage({
        ...pages[0],
        imageinfo: [{ ...pages[0].imageinfo[0], extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } } }],
      }),
    ).toBeNull()
  })
})

describe("Europeana", () => {
  it("keeps open-licence images and skips icons", () => {
    const items = fixture("europeana_page.json").items
    const arts = items.map(europeana.parseItem)
    for (const a of arts.filter(Boolean)) expect(["CC0", "Public domain"]).toContain(a.licence)
    expect(europeana.parseItem({ ...items[0], edmIsShownBy: ["https://x/icoon.ico?file=1"] })).toBeNull()
    expect(europeana.parseItem({ ...items[0], rights: ["http://creativecommons.org/licenses/by-sa/4.0/"] })).toBeNull()
    expect(europeana.searchUrl("k", "vermeer", 12)).toContain("RIGHTS%3A*publicdomain*")
  })
})

describe("Smithsonian", () => {
  it("keeps CC0 images and asks for a 3840 px rendition", () => {
    const rows = fixture("smithsonian_page.json").response.rows
    const arts = rows.map(smithsonian.parseRow).filter(Boolean)
    expect(arts.length).toBeGreaterThan(0)
    expect(arts[0].imageUrl).toContain("max=3840")
    expect(arts[0].licence).toBe("CC0")
  })
  it("doesn't search without a key", async () => {
    expect(await smithsonian.provider.search!("hopper", { fetch: fetch, apiKey: null, limit: 5 })).toEqual([])
  })
})

describe("source settings", () => {
  const sources = () => new Sources(new Store(path.join(tempSettings().dataDir, "s.sqlite")))

  it("starts with the default selection, never enables a key-only source without a key", () => {
    const s = sources()
    expect(s.enabledIds()).toEqual(["mine", "met", "aic", "rijks", "cleveland", "smk", "wikimedia"])
    s.set("smithsonian", { enabled: true })
    expect(s.enabledIds()).not.toContain("smithsonian")
    s.set("smithsonian", { enabled: true, apiKey: "  abc  " })
    expect(s.enabledIds()).toContain("smithsonian")
  })

  it("never exposes a key, only whether it is set, and keeps it when only toggling", () => {
    const s = sources()
    s.set("europeana", { enabled: true, apiKey: "secret-key" })
    s.set("europeana", { enabled: false })
    s.set("europeana", { enabled: true })
    const dto = s.toDTO().find((x) => x.id === "europeana")!
    expect(dto.apiKey).toEqual({ required: false, helpUrl: expect.any(String), set: true })
    expect(JSON.stringify(s.toDTO())).not.toContain("secret-key")
  })

  it("turns a source off", () => {
    const s = sources()
    s.set("met", { enabled: false })
    expect(s.enabledIds()).not.toContain("met")
  })
})

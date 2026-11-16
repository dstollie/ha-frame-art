import { describe, expect, it } from "vitest"

import * as cleveland from "../src/providers/cleveland.js"
import * as met from "../src/providers/met.js"
import * as rijks from "../src/providers/rijks.js"
import { fixture } from "./helpers.js"

describe("Met", () => {
  it("parses a public-domain painting", () => {
    const a = met.parseObject(fixture("met_object.json"))!
    expect(a).toMatchObject({
      id: "met:436965",
      artist: "Edouard Manet",
      year: 1874,
      aspect: Math.round((99.7 / 61) * 10_000) / 10_000, // "Overall", not "Framed"
    })
    expect(a.imageUrl).toMatch(/\/original\/DP-25465-001\.jpg$/)
    expect(a.thumbUrl).toMatch(/\/web-large\//)
    expect(a.tags).toContain("Gardens")
  })
  it("skips works that are not public domain", () => {
    expect(met.parseObject({ ...fixture("met_object.json"), isPublicDomain: false })).toBeNull()
  })
  it("searches through v1.1 (the retired /v1/search is never called) and fetches the objects", async () => {
    const calls: string[] = []
    const obj = fixture("met_object.json")
    const fake = (async (url: string) => {
      calls.push(url)
      if (url.includes("/v1.1/search")) return Response.json({ total: 2, objectIDs: [436965, 1] })
      return Response.json(url.endsWith("/436965") ? obj : { ...obj, objectID: 1, isPublicDomain: false })
    }) as typeof fetch
    const got = await met.search("cypresses", { fetch: fake, apiKey: null, limit: 5 })
    expect(got.map((a) => a.id)).toEqual(["met:436965"])
    expect(calls[0]).toContain("q=cypresses")
    expect(calls.some((c) => c.includes("/v1/search"))).toBe(false)
  })
})

describe("Rijksmuseum", () => {
  it("parses title, artist, date, aspect and IIIF", () => {
    const a = rijks.parseObject(fixture("rk_object.json"))!
    expect(a).toMatchObject({
      id: "rijks:200108369",
      sourceId: "SK-A-2344",
      title: "Het melkmeisje",
      artist: "Johannes Vermeer",
      year: 1660,
      dateText: "ca. 1660",
      aspect: Math.round((41 / 45.5) * 10_000) / 10_000,
      imageUrl: "https://iiif.micr.io/QkOGy/full/max/0/default.jpg",
      thumbUrl: "https://iiif.micr.io/QkOGy/full/!800,800/0/default.jpg",
    })
  })
  it("reads ids and the next page from a search page", () => {
    const { ids, next } = rijks.parseSearch(fixture("rk_search.json"))
    expect(ids).toHaveLength(100)
    expect(next).toContain("pageToken=")
  })
})

describe("Cleveland", () => {
  it("parses items with pixel aspect and nationality", () => {
    const arts = fixture("cma_page.json").data.map(cleveland.parseItem)
    const eakins = arts.find((a: any) => a.title.includes("Biglin"))
    expect(eakins).toMatchObject({ artist: "Thomas Eakins", nationality: "American", maxPx: 3400 })
    expect(eakins.aspect).toBeGreaterThan(1.5)
    expect(eakins.imageUrl).toMatch(/_print\.jpg$/)
  })
  it("skips non-CC0", () => {
    expect(cleveland.parseItem({ ...fixture("cma_page.json").data[0], share_license_status: "Copyrighted" })).toBeNull()
  })
})

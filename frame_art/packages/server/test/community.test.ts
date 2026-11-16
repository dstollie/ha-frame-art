/**
 * The catalogue comes from frame-art-collections: sync, collections on/off, search and facets,
 * live museum search with "already in the catalogue", the move from the old museum catalogue,
 * and sharing a selection as a collection.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import addFormats from "ajv-formats"
import { Ajv2020 } from "ajv/dist/2020.js"
import { testClient } from "hono/testing"
import sharp from "sharp"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { createApi, createServices, type Services } from "../src/app.js"
import { COMMUNITY_BASE, downloadUrlOf, issueUrl, itemToArtwork, parseManifest } from "../src/community.js"
import type { HomeAssistant } from "../src/ha.js"
import type { Artwork } from "../src/models.js"
import type { ArtProvider } from "../src/providers/types.js"
import { art, jpeg, tempSettings } from "./helpers.js"

const dir = path.join(import.meta.dirname, "fixtures", "community")
const read = (f: string) => readFileSync(path.join(dir, f), "utf8")

let svc: Services
let api: ReturnType<typeof testClient<ReturnType<typeof createApi>>>
let img: { a: Buffer; b: Buffer; c: Buffer; plain: Buffer }

const ha: HomeAssistant = {
  available: false,
  async callService() {
    return false
  },
  async mqttService() {
    return null
  },
  async discover() {
    return true
  },
}

beforeAll(async () => {
  // Structurally different images (dHash looks at structure, not colour).
  const a = await jpeg(960, 640, [40, 90, 50])
  img = {
    a,
    b: await sharp(a).rotate(90).resize(960, 640, { fit: "fill" }).jpeg().toBuffer(),
    c: await sharp(a).flop().flip().blur(30).jpeg().toBuffer(),
    plain: await jpeg(960, 640, [200, 200, 200]),
  }
})

/** A museum for live search that returns whatever the test puts in it. */
const museum = (id: string, results: Artwork[]): ArtProvider => ({
  id,
  name: `Museum ${id}`,
  description: "test",
  homepage: "https://example.org",
  licence: "CC0",
  defaultEnabled: true,
  thumbnails: "direct",
  search: async () => results,
  downloadUrl: (a) => a.imageUrl,
})

async function boot(opts: { live?: ArtProvider[]; before?: (s: Services) => void; sync?: boolean } = {}) {
  const fetchFn = (async (url: string | URL) => {
    const u = String(url)
    const json = (f: string) => new Response(read(f), { headers: { "content-type": "application/json" } })
    if (u === `${COMMUNITY_BASE}/index.json`) return json("index.json")
    const m = /collections\/([a-z-]+)\.json$/.exec(u)
    if (m) return json(`${m[1]}.json`)
    // The Met's Poppies looks like the community's Commons copy; the two Haystacks are different paintings.
    const image =
      u.includes("Poppies") || u.includes("met-2-thumb")
        ? img.a
        : u.includes("met-3-thumb")
          ? img.b
          : u.includes("Haystacks")
            ? img.c
            : img.plain
    return new Response(new Uint8Array(image), { headers: { "content-type": "image/jpeg" } })
  }) as typeof fetch
  svc = createServices({
    settings: tempSettings(),
    tvs: new Map(),
    ha,
    fetchFn,
    ...(opts.live ? { providers: opts.live } : {}),
  })
  opts.before?.(svc)
  api = testClient(createApi(svc))
  if (opts.sync !== false) await svc.syncer.syncAll()
}

afterEach(() => svc?.store.close())

const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id)

describe("manifest parsing", () => {
  it("maps an item to a catalogue work: best download, attribution, AI tag, aspect", () => {
    const m = parseManifest(JSON.parse(read("impressionism-test.json")))
    const ai = itemToArtwork(m.items.find((i) => i.id === "commons-abc123def456")!)
    expect(ai).toMatchObject({
      id: "community:commons-abc123def456",
      source: "community",
      licence: "CC-BY-SA-4.0",
      attribution: "Someone, CC BY-SA 4.0, via Wikimedia Commons",
      aspect: 1.7778,
      maxPx: 4000,
    })
    expect(ai.tags).toContain("ai-generated")
    const byId = (id: string) => m.items.find((i) => i.id === id)!
    expect(downloadUrlOf(byId("wikidata-Q1"))).toContain("/3840px-")
    expect(downloadUrlOf(byId("smk-KMS9"))).toBe("https://iip.smk.dk/iiif/jp2/kms9/full/!3840,2160/0/default.jpg")
    const b = parseManifest(JSON.parse(read("moods-test.json")))
    expect(downloadUrlOf(b.items.find((i) => i.id === "wikidata-Q4")!)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/e/ef/Blue_hour.jpg",
    )
  })

  it("rejects a manifest that isn't schema v1", () => {
    expect(() => parseManifest({ schema_version: 2, items: [] })).toThrow()
    expect(() => parseManifest({ ...JSON.parse(read("moods-test.json")), items: [{ id: "x" }] })).toThrow()
  })
})

describe("catalogue from the collections", () => {
  it("syncs every collection and stores a work once however many collections hold it", async () => {
    await boot()
    // 6 + 3 items, of which 2 are in both collections.
    expect(svc.store.count()).toBe(7)
    const all = await (await api.artworks.$get({ query: { orient: "all", limit: "50" } })).json()
    expect(all.total).toBe(7)
    expect(new Set(ids(all)).size).toBe(7)
    const detail = await (await api.artworks[":id"].$get({ param: { id: "community:wikidata-Q1" } })).json()
    expect("collections" in detail && detail.collections.toSorted()).toEqual(["impressionism-test", "moods-test"])
  })

  it("turns a collection off: its works leave Explore unless another collection has them", async () => {
    await boot()
    await api.settings.collections[":id"].$put({ param: { id: "impressionism-test" }, json: { enabled: false } })
    const r = await (await api.artworks.$get({ query: { orient: "all", limit: "50" } })).json()
    expect(ids(r).toSorted()).toEqual(["community:smk-KMS9", "community:wikidata-Q1", "community:wikidata-Q4"])
    const cols = await (await api.collections.$get()).json()
    expect(cols.map((c) => [c.id, c.enabled])).toEqual([
      ["impressionism-test", false],
      ["moods-test", true],
    ])
  })

  it("finds works by title, artist, tag and collection, tolerates typos, and counts facets", async () => {
    await boot()
    const q = async (text: string, extra: Record<string, string> = {}) =>
      (await api.artworks.$get({ query: { q: text, orient: "all", ...extra } })).json()
    expect(ids(await q("haystacks"))).toEqual(["community:wikidata-Q3"])
    expect((await q("monet")).total).toBe(3)
    expect(ids(await q("lundbye winter"))).toEqual(["community:smk-KMS9"])
    expect((await q("moods")).total).toBe(3) // collection name
    const typo = await q("hyastacks")
    expect(typo.fuzzy).toBe(true)
    expect(ids(typo)[0]).toBe("community:wikidata-Q3")

    const f = await (await api.facets.$get({ query: { q: "monet", orient: "all" } })).json()
    expect(f.collections).toEqual([
      { id: "impressionism-test", title: "Impressionism test", n: 3 },
      { id: "moods-test", title: "Moods test", n: 1 },
    ])
    expect(f.centuries).toEqual([
      { id: 1800, n: 2 },
      { id: 1900, n: 1 },
    ])
    expect(f.artists).toEqual([{ id: "Claude Monet", n: 3 }])
    // A facet counts as if its own filter weren't set, so you can switch between values.
    const filtered = await (await api.facets.$get({ query: { q: "monet", century: "1900", orient: "all" } })).json()
    expect(filtered.centuries.map((c) => c.id)).toEqual([1800, 1900])
    expect(filtered.artists).toEqual([{ id: "Claude Monet", n: 1 }])

    // Every facet with every filter set (joins collections, so columns must be qualified).
    const everything = await api.facets.$get({
      query: {
        q: "mist",
        ai: "yes",
        uhd: "1",
        century: "2000",
        collection: "impressionism-test",
        licence: "CC-BY-SA-4.0",
        orient: "landscape",
      },
    })
    expect(everything.status).toBe(200)
    expect((await everything.json()).collections).toEqual([
      { id: "impressionism-test", title: "Impressionism test", n: 1 },
    ])

    const ai = await (await api.artworks.$get({ query: { ai: "yes", orient: "all" } })).json()
    expect(ids(ai)).toEqual(["community:commons-abc123def456"])
    const uhd = await (await api.artworks.$get({ query: { uhd: "1", orient: "all", limit: "50" } })).json()
    expect(uhd.total).toBe(6) // Blue hour is 3000 px
  })

  it("serves a landing: rows per collection in their order, and the newest works", async () => {
    await boot()
    const l = await (await api.landing.$get()).json()
    expect(l.collections.map((c) => [c.id, c.items.length])).toEqual([
      ["impressionism-test", 6],
      ["moods-test", 3],
    ])
    expect(l.collections[0]!.items[0]!.id).toBe("community:wikidata-Q1")
    expect(l.newest.length).toBe(7)
    expect(l.popular).toEqual([])
  })
})

describe("live search in the museums", () => {
  it("marks results the catalogue already has: same id, same Commons file, or a look-alike", async () => {
    const results = [
      art("smk:KMS1", { title: "Danish Coast", artist: "C.W. Eckersberg", year: 1830 }),
      art("wikimedia:111", {
        title: "Water Lilies",
        artist: "Claude Monet",
        imageUrl:
          "https://commons.wikimedia.org/wiki/Special:FilePath/Claude%20Monet%20-%20Water%20Lilies.jpg?width=3840",
        pageUrl: "https://commons.wikimedia.org/wiki/File:Claude_Monet_-_Water_Lilies.jpg",
      }),
      art("met:2", {
        title: "Field of Poppies",
        artist: "Claude Monet",
        year: 1873,
        thumbUrl: "https://img.test/met-2-thumb.jpg",
      }),
      art("met:3", {
        title: "Haystacks",
        artist: "Claude Monet",
        year: 1891,
        thumbUrl: "https://img.test/met-3-thumb.jpg",
      }),
      art("met:4", { title: "Something else", artist: "Nobody" }),
    ]
    await boot({ live: [museum("met", results)] })
    const groups = await (await api.live.$get({ query: { q: "monet" } })).json()
    const r = Object.fromEntries(groups[0]!.results.map((x) => [x.artwork.id, x.inCatalogue]))
    expect(r).toEqual({
      "smk:KMS1": "community:smk-KMS1",
      "wikimedia:111": "community:wikidata-Q1",
      "met:2": "community:wikidata-Q2",
      "met:3": null, // same title and artist, but a different painting
      "met:4": null,
    })
    // Nothing from live search is stored until you save it.
    expect(svc.store.get("met:4")).toBeNull()
  })

  it("saves a result to My collection and takes it out again", async () => {
    await boot({ live: [museum("met", [art("met:4", { title: "Something else", artist: "Nobody", maxPx: 3000 })])] })
    const groups = await (await api.live.$get({ query: { q: "something" } })).json()
    expect(groups[0]!.results[0]!.proposeUrl).toContain(
      "works=https%3A%2F%2Fwww.metmuseum.org%2Fart%2Fcollection%2Fsearch%2F4",
    )
    expect((await api.live.save.$post({ json: { id: "met:4" } })).status).toBe(200)
    const mine = await (await api.artworks.$get({ query: { source: "mine" } })).json()
    expect(ids(mine)).toEqual(["met:4"])
    const explore = await (await api.artworks.$get({ query: { q: "something", orient: "all" } })).json()
    expect(explore.total).toBe(0) // saved works aren't part of the catalogue
    await api.saved[":id"].$delete({ param: { id: "met:4" } })
    expect((await (await api.artworks.$get({ query: { source: "mine" } })).json()).total).toBe(0)
  })
})

describe("moving from the old museum catalogue", () => {
  it("maps old works onto the collections and keeps what series, favourites and the TV use", async () => {
    await boot({
      sync: false,
      before: (s) => {
        s.store.upsertArtworks([
          art("smk:KMS1", { title: "Danish Coast", artist: "C.W. Eckersberg", year: 1830 }),
          art("met:2", {
            title: "Field of Poppies",
            artist: "Claude Monet",
            year: 1873,
            thumbUrl: "https://img.test/met-2-thumb.jpg",
          }),
          art("wikimedia:111", {
            title: "Water Lilies",
            artist: "Claude Monet",
            pageUrl: "https://commons.wikimedia.org/wiki/File:Claude_Monet_-_Water_Lilies.jpg",
          }),
          art("cleveland:5", { title: "View of the Sea", artist: "Unknown" }),
          art("rijks:9", { title: "Not used anywhere", artist: "Nobody" }),
          art("mine:abc", { title: "Holiday" }),
        ])
        s.store.setFavourite("smk:KMS1", true)
        const series = s.series.create("Avond", { artworkIds: ["met:2", "cleveland:5", "mine:abc"] })
        s.store.recordUpload("woonkamer", "MY_F0001", "wikimedia:111", "fill")
        s.store.addHistory("woonkamer", "wikimedia:111", "fill")
        s.store.setMeta(
          "playback:woonkamer",
          JSON.stringify({
            seriesId: series.id,
            order: ["met:2", "cleveland:5"],
            current: "met:2",
            index: 0,
            status: "playing",
            nextAt: 0,
            remaining: null,
            error: null,
          }),
        )
      },
    })
    const report = await svc.syncer.syncAll()
    expect(report?.migrated).toEqual({
      mapped: 3,
      kept: 1,
      removed: 1,
      methods: { "same-id": 1, "commons-file": 1, "look-alike": 1 },
    })
    expect(svc.store.favouriteIds()).toEqual(new Set(["community:smk-KMS1"]))
    const s = svc.series.list()[0]!
    expect(svc.series.itemIds(s.id)).toEqual(["community:wikidata-Q2", "cleveland:5", "mine:abc"])
    expect(svc.store.findUpload("woonkamer", "community:wikidata-Q1", "fill")).toBe("MY_F0001")
    expect(svc.store.history(1, "woonkamer")[0]!.artworkId).toBe("community:wikidata-Q1")
    expect(JSON.parse(svc.store.getMeta("playback:woonkamer")!).current).toBe("community:wikidata-Q2")
    expect(svc.store.get("rijks:9")).toBeNull()
    expect(svc.store.get("cleveland:5")).not.toBeNull() // in a series, no match: kept
    expect(svc.store.get("mine:abc")).not.toBeNull()
    // It runs once.
    expect((await svc.syncer.syncAll())?.migrated).toBeUndefined()
  })
})

describe("share a selection as a collection", () => {
  const meta = {
    id: "misty-mornings",
    title: "Misty mornings",
    description: "Quiet, misty landscapes for the morning wall.",
    tags: ["mist", "landscape"],
    curator: { name: "Dennis", github: "dstollie" },
  }

  it("exports a manifest that validates against collection.v1, and leaves out own uploads", async () => {
    await boot()
    svc.store.upsertArtworks([
      art("met:2", {
        title: "Field of Poppies",
        artist: "Claude Monet",
        year: 1873,
        maxPx: 4000,
        aspect: 1.5,
        licence: "CC0",
        pageUrl: "https://www.metmuseum.org/art/collection/search/2",
      }),
      art("mine:abc", { title: "Holiday" }),
      art("cleveland:5", {
        title: "Sea",
        maxPx: 3000,
        aspect: 1.6,
        licence: "CC0",
        pageUrl: "https://clevelandart.org/art/5",
      }),
    ])
    const r = await api.share.$post({
      json: {
        ...meta,
        artworkIds: ["community:commons-abc123def456", "met:2", "mine:abc", "cleveland:5", "community:smk-KMS9"],
      },
    })
    expect(r.status).toBe(200)
    const out = await r.json()
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats.default(ajv)
    const validate = ajv.compile(JSON.parse(read("collection.v1.schema.json")))
    expect(validate(out.manifest), JSON.stringify(validate.errors)).toBe(true)
    expect(out.manifest.items.map((i: { id: string }) => i.id)).toEqual([
      "commons-abc123def456",
      "met-2",
      "cleveland-5",
      "smk-KMS9",
    ])
    expect(out.manifest.items[0]).toEqual(
      parseManifest(JSON.parse(read("impressionism-test.json"))).items.find((i) => i.id === "commons-abc123def456"),
    )
    expect(out.excluded).toEqual([{ id: "mine:abc", reason: "own" }])
    expect(out.works).toEqual([
      "https://commons.wikimedia.org/wiki/File:Misty_valley.png",
      "https://www.metmuseum.org/art/collection/search/2",
      "https://open.smk.dk/artwork/image/KMS9",
    ])
    expect(out.notForIssue).toEqual(["cleveland:5"])
  })

  it("prefills the GitHub issue form through its field ids", () => {
    const url = new URL(issueUrl({ ...meta, works: ["Q12418", "https://open.smk.dk/artwork/image/KMS3352"] }).url)
    expect(url.origin + url.pathname).toBe("https://github.com/dstollie/frame-art-collections/issues/new")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: "new-collection.yml",
      title: "New collection: Misty mornings",
      collection_id: "misty-mornings",
      collection_title: "Misty mornings",
      description: "Quiet, misty landscapes for the morning wall.",
      tags: "mist, landscape",
      curator: "Dennis",
      works: "Q12418\nhttps://open.smk.dk/artwork/image/KMS3352",
    })
  })

  it("keeps the issue URL within GitHub's limit and says how many works didn't fit", () => {
    const works = Array.from(
      { length: 400 },
      (_, i) => `https://commons.wikimedia.org/wiki/File:Painting_number_${i}.jpg`,
    )
    const r = issueUrl({ ...meta, works })
    expect(r.url.length).toBeLessThanOrEqual(8000)
    expect(r.left).toBeGreaterThan(0)
    expect(new URL(r.url).searchParams.get("works")!.split("\n").length + r.left).toBe(400)
  })
})

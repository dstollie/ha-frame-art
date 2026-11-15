import path from "node:path"

import { describe, expect, it } from "vitest"

import { Store } from "../src/db.js"
import { art, tempSettings } from "./helpers.js"

function seeded() {
  const s = new Store(path.join(tempSettings().dataDir, "t.sqlite"))
  s.upsertArtworks([
    art("met:1", { title: "Water Lilies", aspect: 1.9 }),
    art("met:2", { title: "Bridge over a Pond", aspect: 1.0 }),
    art("rijks:3", { title: "Het melkmeisje", artist: "Johannes Vermeer", year: 1660, aspect: 0.9 }),
    art("cleveland:4", { title: "Café-concert", artist: "Édouard Manet", aspect: 1.4 }),
    art("cleveland:6", { title: "Handscroll", artist: "Anon", aspect: 5.2, hidden: true }),
  ])
  return s
}
const ids = (s: Store, q: Parameters<Store["query"]>[0]) => new Set(s.query(q).items.map((a) => a.id))

describe("store", () => {
  it("categorises on upsert and is idempotent", () => {
    const s = seeded()
    expect(s.count()).toBe(4)
    expect(s.get("met:1")!.categories).toContain("impressionism")
    expect(s.get("rijks:3")!.categories).toContain("old-masters")
    s.upsertArtworks([art("met:1", { title: "Water Lilies (Nymphéas)", aspect: null })])
    expect(s.count()).toBe(4)
    expect(s.get("met:1")!.title).toBe("Water Lilies (Nymphéas)")
    expect(s.get("met:1")!.aspect).toBe(1.9) // a missing aspect never wipes a known one
  })

  it("filters", () => {
    const s = seeded()
    s.setHidden("cleveland:6", false)
    expect(ids(s, { landscape: true })).toEqual(new Set(["met:1", "cleveland:4"])) // 5:1 scroll is not "liggend"
    s.setHidden("cleveland:6", true)
    expect(ids(s, { landscape: true })).toEqual(new Set(["met:1", "cleveland:4"]))
    expect(ids(s, { category: "old-masters" })).toEqual(new Set(["rijks:3"]))
    expect(ids(s, { q: "manet cafe" })).toEqual(new Set(["cleveland:4"]))
    expect(ids(s, { source: "met" })).toEqual(new Set(["met:1", "met:2"]))
    s.setColor("met:2", "#3050a0", "blue")
    expect(ids(s, { color: "blue" })).toEqual(new Set(["met:2"]))
    s.setHidden("met:2", true)
    expect(ids(s, {})).toEqual(new Set(["met:1", "rijks:3", "cleveland:4"]))
  })

  it("pages stably per seed", () => {
    const s = seeded()
    const a = [...s.query({ seed: 5, limit: 2 }).items, ...s.query({ seed: 5, limit: 2, offset: 2 }).items].map(
      (x) => x.id,
    )
    expect(a.toSorted()).toEqual(["cleveland:4", "met:1", "met:2", "rijks:3"])
    expect(s.query({ limit: 2 }).total).toBe(4)
  })

  it("keeps favourites newest first", async () => {
    const s = seeded()
    s.setFavourite("rijks:3", true)
    await new Promise((r) => setTimeout(r, 5))
    s.setFavourite("met:2", true)
    expect(s.query({ favourites: true }).items.map((a) => a.id)).toEqual(["met:2", "rijks:3"])
    s.setFavourite("met:2", false)
    expect(s.favouriteIds()).toEqual(new Set(["rijks:3"]))
  })

  it("prunes old uploads per TV and keeps favourites longer", () => {
    const s = seeded()
    s.setFavourite("met:1", true)
    for (let i = 0; i < 6; i++) s.recordUpload("woonkamer", `MY_F${i}`, i === 0 ? "met:1" : "met:2")
    s.recordUpload("slaapkamer", "MY_X", "met:2")
    const prune = s.prunableUploads("woonkamer", 3, 10)
    expect(prune).toEqual(["MY_F2", "MY_F1"])
    s.removeUploads("woonkamer", prune)
    expect(s.prunableUploads("woonkamer", 3, 10)).toEqual([])
    expect(s.prunableUploads("slaapkamer", 3, 10)).toEqual([])
  })

  it("random respects exclusions", () => {
    const s = seeded()
    for (let i = 0; i < 10; i++) expect(s.random({ landscape: true }, new Set(["met:1"]))!.id).toBe("cleveland:4")
  })
})

describe("migration from 0.1.x", () => {
  it("recomputes Dutch categories and colours to English ids and maps rotation settings", () => {
    const file = path.join(tempSettings().dataDir, "old.sqlite")
    const old = new Store(file)
    old.upsertArtworks([
      art("rijks:9", { title: "Gezicht op Delft", artist: "Johannes Vermeer", year: 1660, aspect: 1.2 }),
    ])
    old.sqlite
      .prepare(
        "UPDATE artworks SET categories = ',gouden-eeuw,landschap,', color_hex = '#a03020', color_family = 'rood'",
      )
      .run()
    old.setMeta("category:woonkamer", "gouden-eeuw")
    old.setMeta("category:slaapkamer", "favorieten")
    old.sqlite.prepare("DELETE FROM meta WHERE key = 'categorizer_version'").run()
    old.close()

    const s = new Store(file)
    const a = s.get("rijks:9")!
    expect(a.categories).toEqual(expect.arrayContaining(["old-masters", "landscape"]))
    expect(a.categories).not.toContain("gouden-eeuw")
    expect(a.colorFamily).toBe("red")
    expect(s.getMeta("category:woonkamer")).toBe("old-masters")
    expect(s.getMeta("category:slaapkamer")).toBe("favourites")
    expect(a.licence).toBe("")
  })

  it("keeps albums and their items in order", () => {
    const s = seeded()
    s.createAlbum("a1", "Zomer")
    s.setAlbumItem("a1", "met:1", true)
    s.setAlbumItem("a1", "met:2", true)
    expect(s.albums()).toEqual([{ id: "a1", name: "Zomer", count: 2, cover: expect.any(String) }])
    expect(ids(s, { album: "a1" })).toEqual(new Set(["met:1", "met:2"]))
    s.setAlbumItem("a1", "met:1", false)
    expect(s.albumsOf("met:1")).toEqual([])
    s.deleteAlbum("a1")
    expect(s.albums()).toEqual([])
  })
})

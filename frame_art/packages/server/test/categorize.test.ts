import { describe, expect, it } from "vitest"

import { categorize, normalize } from "../src/categorize.js"
import { art } from "./helpers.js"

const cases: [string, Parameters<typeof art>[1] & { id?: string }, string[], string[]][] = [
  ["Monet water lilies", { title: "Water Lilies", year: 1906 }, ["impressionism", "flowers"], ["modern"]],
  [
    "Vermeer at the Rijks",
    { id: "rijks:1", title: "Het melkmeisje", artist: "Johannes Vermeer", year: 1660 },
    ["old-masters"],
    ["impressionism"],
  ],
  [
    "Ruisdael view",
    { title: "View of Haarlem", artist: "Jacob van Ruisdael", nationality: "Dutch", year: 1670 },
    ["old-masters", "landscape"],
    [],
  ],
  [
    "Ruysch flowers",
    { title: "Still Life with Flowers in a Vase", artist: "Rachel Ruysch", nationality: "Dutch", year: 1700 },
    ["old-masters", "still-life", "flowers"],
    [],
  ],
  [
    "Hokusai wave",
    {
      title: "Under the Wave off Kanagawa",
      artist: "Katsushika Hokusai",
      culture: "Japan",
      department: "Asian Art",
      medium: "Polychrome woodblock print",
      year: 1830,
    },
    ["asian", "sea"],
    ["impressionism", "old-masters"],
  ],
  [
    "Hals portrait",
    { title: "Portrait of a Woman", artist: "Frans Hals", nationality: "Dutch", year: 1640 },
    ["old-masters", "portrait"],
    [],
  ],
  ["woman in garden is a scene", { title: "Woman in a Garden", year: 1867 }, ["landscape"], ["portrait"]],
  ["Mondriaan", { title: "Composition", artist: "Piet Mondriaan", year: 1921 }, ["modern"], []],
  ["tags count", { title: "Stormy Sea", artist: "Unknown", year: 1850, tags: ["Seascapes"] }, ["sea"], []],
]

describe("categorize", () => {
  it.each(cases)("%s", (_name, { id, ...extra }, expected, absent) => {
    const cats = categorize(art(id ?? "met:1", extra))
    for (const c of expected) expect(cats).toContain(c)
    for (const c of absent) expect(cats).not.toContain(c)
  })
  it("respects word boundaries", () => {
    expect(categorize(art("met:1", { title: "A seat by the window", artist: "X", year: 1800 }))).not.toContain("sea")
    expect(categorize(art("met:1", { title: "Embossed plate", artist: "X", year: 1800 }))).not.toContain("landscape")
  })
  it("normalizes accents", () => {
    expect(normalize("Édouard Manet — Café")).toBe("edouard manet — cafe")
  })
})

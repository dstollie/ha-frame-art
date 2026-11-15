/** Rule-based categories. None of the museum APIs has a usable style field, so we derive our own. */
import type { Artwork } from "./models.js"

export const CATEGORIES = [
  ["impressionisme", "Impressionisme"],
  ["gouden-eeuw", "Gouden Eeuw"],
  ["landschap", "Landschap"],
  ["zee", "Zee & water"],
  ["stilleven", "Stilleven"],
  ["bloemen", "Bloemen"],
  ["portret", "Portret"],
  ["japans", "Japanse prenten"],
  ["modern", "Modern"],
] as const
export type CategoryId = (typeof CATEGORIES)[number][0]

const IMPRESSIONISTS = [
  "monet",
  "renoir",
  "pissarro",
  "sisley",
  "degas",
  "morisot",
  "cassatt",
  "caillebotte",
  "manet",
  "cezanne",
  "van gogh",
  "gauguin",
  "seurat",
  "signac",
  "toulouse-lautrec",
  "bonnard",
  "vuillard",
  "breitner",
  "israels",
  "hassam",
  "twachtman",
  "guillaumin",
  "cross",
  "rysselberghe",
  "luce",
  "boudin",
  "jongkind",
  "bazille",
  "sargent",
  "robinson",
  "weir",
  "metcalf",
  "liebermann",
  "sorolla",
  "zandomeneghi",
  "forain",
  "gonzales",
  "redon",
]
const MODERNISTS = [
  "kandinsky",
  "mondrian",
  "mondriaan",
  "klee",
  "malevich",
  "kupka",
  "delaunay",
  "marc",
  "matisse",
  "derain",
  "vlaminck",
  "braque",
  "picasso",
  "leger",
  "gris",
  "macke",
  "kirchner",
  "schiele",
  "klimt",
  "modigliani",
  "dove",
  "hartley",
  "o'keeffe",
  "demuth",
  "sheeler",
  "van doesburg",
  "jawlensky",
]
const GOLDEN_AGE_NATIONALITIES = ["dutch", "flemish", "netherlandish", "nederlands"]

const KEYWORDS: Record<"landschap" | "zee" | "stilleven" | "bloemen" | "portret", string[]> = {
  landschap: [
    "landscape",
    "landschap",
    "view of",
    "gezicht op",
    "river",
    "rivier",
    "forest",
    "bos",
    "woods",
    "valley",
    "dal",
    "mountain",
    "mountains",
    "berg",
    "bergen",
    "field",
    "fields",
    "veld",
    "meadow",
    "winter",
    "dunes",
    "duinen",
    "polder",
    "trees",
    "bomen",
    "lake",
    "meer",
    "countryside",
    "hills",
    "sunset",
    "zonsondergang",
    "moonlight",
    "maanlicht",
    "road",
    "weg",
    "village",
    "dorp",
    "farm",
    "garden",
    "tuin",
    "park",
    "canal",
    "gracht",
    "vaart",
    "mill",
    "molen",
    "panorama",
    "vista",
  ],
  zee: [
    "sea",
    "zee",
    "seascape",
    "marine",
    "beach",
    "strand",
    "ship",
    "ships",
    "schip",
    "schepen",
    "harbor",
    "harbour",
    "haven",
    "coast",
    "kust",
    "boat",
    "boats",
    "boot",
    "boten",
    "wave",
    "waves",
    "golven",
    "storm",
    "shipwreck",
    "schipbreuk",
    "fleet",
    "vloot",
    "ocean",
    "estuary",
    "pier",
    "fishing",
    "vissers",
    "zeegezicht",
    "rede",
  ],
  stilleven: ["still life", "stilleven", "nature morte", "vanitas", "breakfast piece", "ontbijtje"],
  bloemen: [
    "flowers",
    "flower",
    "bloemen",
    "bloem",
    "bouquet",
    "boeket",
    "roses",
    "rozen",
    "irises",
    "lilies",
    "sunflowers",
    "zonnebloemen",
    "tulips",
    "tulpen",
    "peonies",
    "chrysanthemums",
    "poppies",
  ],
  portret: [
    "portrait",
    "portret",
    "self-portrait",
    "zelfportret",
    "bildnis",
    "madame",
    "monsieur",
    "mrs.",
    "mr.",
    "lady",
    "girl",
    "meisje",
    "boy",
    "jongen",
    "woman",
    "vrouw",
    "man with",
    "head of",
  ],
}
const TAG_CATEGORIES: Record<string, string> = {
  landscapes: "landschap",
  mountains: "landschap",
  trees: "landschap",
  rivers: "landschap",
  forests: "landschap",
  fields: "landschap",
  gardens: "landschap",
  lakes: "landschap",
  seascapes: "zee",
  boats: "zee",
  ships: "zee",
  seas: "zee",
  beaches: "zee",
  waves: "zee",
  "still life": "stilleven",
  flowers: "bloemen",
  portraits: "portret",
}

export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const patternCache = new Map<string[], RegExp>()
function wordsPattern(words: string[]): RegExp {
  let re = patternCache.get(words)
  if (!re) {
    re = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${words.map(escape).join("|")})(?![\\p{L}\\p{N}_-])`, "u")
    patternCache.set(words, re)
  }
  return re
}
const hasWord = (haystack: string, words: string[]) => wordsPattern(words).test(haystack)

export function categorize(art: Artwork): string[] {
  const title = normalize(art.title)
  const artist = normalize(art.artist)
  const nationality = normalize(art.nationality)
  const culture = normalize(`${art.culture} ${art.department}`)
  const medium = normalize(art.medium)
  const tags = new Set(art.tags.map(normalize))
  const year = art.year
  const cats: string[] = []

  if (
    culture.includes("japan") ||
    (culture.includes("asian art") && (medium.includes("woodblock") || medium.includes("ukiyo")))
  ) {
    cats.push("japans")
  } else if (hasWord(artist, IMPRESSIONISTS) && (year == null || (year >= 1855 && year <= 1925))) {
    cats.push("impressionisme")
  } else if (
    year != null &&
    year >= 1585 &&
    year <= 1710 &&
    (art.source === "rijks" || GOLDEN_AGE_NATIONALITIES.some((n) => nationality.includes(n)))
  ) {
    cats.push("gouden-eeuw")
  } else if (hasWord(artist, MODERNISTS) || (year != null && year >= 1905)) {
    cats.push("modern")
  }

  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (hasWord(title, words) || [...tags].some((t) => TAG_CATEGORIES[t] === cat)) cats.push(cat)
  }
  if (cats.includes("bloemen") && !cats.includes("stilleven") && /\bvase\b|\bvaas\b/.test(title)) cats.push("stilleven")
  if (cats.includes("portret") && (cats.includes("landschap") || cats.includes("zee"))) {
    // "Woman in a garden" is a scene, not a portrait.
    if (!hasWord(title, ["portrait", "portret", "self-portrait", "zelfportret"]))
      cats.splice(cats.indexOf("portret"), 1)
  }
  return [...new Set(cats)]
}

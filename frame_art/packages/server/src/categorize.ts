/**
 * Rule-based categories. No museum API has a usable style field across sources, so we derive
 * our own from artist, year, culture, medium, tags and title words. Ids are English and stable;
 * labels come in every UI language. Keywords cover the languages our providers write titles in.
 */
import type { Artwork } from "./models.js"

export const CATEGORIES = [
  { id: "impressionism", en: "Impressionism", nl: "Impressionisme" },
  { id: "old-masters", en: "Old masters", nl: "Oude meesters" },
  { id: "modern", en: "Modern", nl: "Modern" },
  { id: "asian", en: "Asian art", nl: "Aziatische kunst" },
  { id: "landscape", en: "Landscapes", nl: "Landschappen" },
  { id: "sea", en: "Sea & water", nl: "Zee & water" },
  { id: "city", en: "Cities & buildings", nl: "Steden & gebouwen" },
  { id: "still-life", en: "Still life", nl: "Stilleven" },
  { id: "flowers", en: "Flowers", nl: "Bloemen" },
  { id: "portrait", en: "Portraits", nl: "Portretten" },
  { id: "animals", en: "Animals", nl: "Dieren" },
  { id: "religion", en: "Religion & myth", nl: "Religie & mythologie" },
] as const
export type CategoryId = (typeof CATEGORIES)[number]["id"]

/** Bump when the rules change: stored categories are recomputed at boot. */
export const CATEGORIZER_VERSION = "2"

/** 0.1.x stored Dutch ids; rotation settings are mapped once. */
export const LEGACY_CATEGORY_IDS: Record<string, string> = {
  impressionisme: "impressionism",
  "gouden-eeuw": "old-masters",
  landschap: "landscape",
  zee: "sea",
  stilleven: "still-life",
  bloemen: "flowers",
  portret: "portrait",
  japans: "asian",
  modern: "modern",
  alles: "all",
  favorieten: "favourites",
}

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
  "gogh",
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
  "kroyer",
  "krøyer",
  "ancher",
  "tuxen",
  "zorn",
]
const MODERNISTS = [
  "kandinsky",
  "mondrian",
  "mondriaan",
  "klee",
  "malevich",
  "kupka",
  "delaunay",
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
  "munch",
  "hammershoi",
  "hammershøi",
  "nolde",
  "marc",
]
const ASIAN_CULTURES = ["japan", "china", "chinese", "korea", "india", "persia", "iran", "mughal", "tibet", "nepal"]

type SubjectId = "landscape" | "sea" | "city" | "still-life" | "flowers" | "portrait" | "animals" | "religion"

const KEYWORDS: Record<SubjectId, string[]> = {
  landscape: [
    "landscape",
    "view of",
    "river",
    "forest",
    "woods",
    "valley",
    "mountain",
    "mountains",
    "field",
    "fields",
    "meadow",
    "winter",
    "dunes",
    "trees",
    "lake",
    "countryside",
    "hills",
    "sunset",
    "moonlight",
    "road",
    "village",
    "farm",
    "garden",
    "park",
    "mill",
    "panorama",
    "vista",
    "landschap",
    "gezicht op",
    "rivier",
    "bos",
    "berg",
    "veld",
    "duinen",
    "bomen",
    "tuin",
    "molen",
    "landskab",
    "skov",
    "bakke",
    "paysage",
    "foret",
    "jardin",
    "landschaft",
    "wald",
    "garten",
    "paesaggio",
  ],
  sea: [
    "sea",
    "seascape",
    "marine",
    "beach",
    "ship",
    "ships",
    "harbor",
    "harbour",
    "coast",
    "boat",
    "boats",
    "wave",
    "waves",
    "storm",
    "shipwreck",
    "fleet",
    "ocean",
    "estuary",
    "pier",
    "fishing",
    "zee",
    "strand",
    "schip",
    "schepen",
    "haven",
    "kust",
    "boot",
    "golven",
    "zeegezicht",
    "hav",
    "kyst",
    "skib",
    "havn",
    "mer",
    "plage",
    "bateau",
    "schiff",
    "mare",
  ],
  city: [
    "city",
    "street",
    "town",
    "square",
    "church",
    "cathedral",
    "bridge",
    "canal",
    "palace",
    "venice",
    "paris",
    "london",
    "rome",
    "amsterdam",
    "stad",
    "straat",
    "kerk",
    "brug",
    "gracht",
    "plein",
    "gade",
    "kirke",
    "torv",
    "rue",
    "ville",
    "eglise",
    "pont",
    "stadt",
    "strasse",
    "kirche",
    "citta",
  ],
  "still-life": [
    "still life",
    "stilleven",
    "nature morte",
    "vanitas",
    "breakfast piece",
    "ontbijtje",
    "opstilling",
    "stilleben",
    "natura morta",
    "fruit",
    "fruits",
    "vruchten",
    "frugt",
  ],
  flowers: [
    "flowers",
    "flower",
    "bouquet",
    "roses",
    "irises",
    "lilies",
    "sunflowers",
    "tulips",
    "peonies",
    "chrysanthemums",
    "poppies",
    "bloemen",
    "bloem",
    "boeket",
    "rozen",
    "tulpen",
    "zonnebloemen",
    "blomster",
    "blomst",
    "roser",
    "fleurs",
    "blumen",
    "fiori",
  ],
  portrait: [
    "portrait",
    "self-portrait",
    "madame",
    "monsieur",
    "mrs.",
    "mr.",
    "lady",
    "girl",
    "boy",
    "woman",
    "man with",
    "head of",
    "portret",
    "zelfportret",
    "meisje",
    "jongen",
    "vrouw",
    "portraet",
    "portræt",
    "selvportræt",
    "pige",
    "dreng",
    "kvinde",
    "bildnis",
    "ritratto",
    "jeune fille",
  ],
  animals: [
    "horse",
    "horses",
    "dog",
    "dogs",
    "cat",
    "cats",
    "cow",
    "cows",
    "cattle",
    "sheep",
    "bird",
    "birds",
    "deer",
    "lion",
    "tiger",
    "hare",
    "duck",
    "ducks",
    "hen",
    "rooster",
    "paard",
    "paarden",
    "hond",
    "kat",
    "koe",
    "koeien",
    "schapen",
    "vogel",
    "vogels",
    "hest",
    "heste",
    "hund",
    "koer",
    "fugl",
    "fugle",
    "cheval",
    "chien",
    "pferd",
    "kuh",
  ],
  religion: [
    "madonna",
    "virgin",
    "saint",
    "christ",
    "crucifixion",
    "annunciation",
    "nativity",
    "holy",
    "adoration",
    "resurrection",
    "apostle",
    "angel",
    "angels",
    "venus",
    "jupiter",
    "apollo",
    "diana",
    "bacchus",
    "mythology",
    "heilige",
    "maria",
    "kruisiging",
    "aanbidding",
    "engel",
    "jomfru",
    "kristus",
    "hellige",
    "sainte",
    "vierge",
    "heiliger",
  ],
}
const TAG_CATEGORIES: Record<string, SubjectId> = {
  landscapes: "landscape",
  mountains: "landscape",
  trees: "landscape",
  rivers: "landscape",
  forests: "landscape",
  fields: "landscape",
  gardens: "landscape",
  lakes: "landscape",
  landscape: "landscape",
  seascapes: "sea",
  boats: "sea",
  ships: "sea",
  seas: "sea",
  beaches: "sea",
  waves: "sea",
  cityscapes: "city",
  architecture: "city",
  "city views": "city",
  streets: "city",
  churches: "city",
  "still life": "still-life",
  flowers: "flowers",
  portraits: "portrait",
  portrait: "portrait",
  horses: "animals",
  dogs: "animals",
  cats: "animals",
  animals: "animals",
  birds: "animals",
  cows: "animals",
  "christian iconography": "religion",
  saints: "religion",
  "virgin mary": "religion",
  madonnas: "religion",
  "jesus christ": "religion",
  mythology: "religion",
  "greek and roman mythology": "religion",
}

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/å/g, "a")
    .toLowerCase()
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const patternCache = new Map<string[], RegExp>()
function wordsPattern(words: string[]): RegExp {
  let re = patternCache.get(words)
  if (!re) {
    const alternation = words.map((w) => escape(normalize(w))).join("|")
    re = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${alternation})(?![\\p{L}\\p{N}_-])`, "u")
    patternCache.set(words, re)
  }
  return re
}
const hasWord = (haystack: string, words: string[]) => wordsPattern(words).test(haystack)

export function categorize(art: Artwork): string[] {
  const title = normalize(art.title)
  const artist = normalize(art.artist)
  const culture = normalize(`${art.culture} ${art.department} ${art.nationality}`)
  const medium = normalize(art.medium)
  const tags = new Set(art.tags.map(normalize))
  const year = art.year
  const cats: string[] = []

  if (
    ASIAN_CULTURES.some((c) => culture.includes(c)) ||
    (culture.includes("asian art") && (medium.includes("woodblock") || medium.includes("ukiyo")))
  ) {
    cats.push("asian")
  } else if (hasWord(artist, IMPRESSIONISTS) && (year == null || (year >= 1855 && year <= 1930))) {
    cats.push("impressionism")
  } else if (hasWord(artist, MODERNISTS) || (year != null && year >= 1905)) {
    cats.push("modern")
  } else if (year != null && year >= 1300 && year <= 1800) {
    cats.push("old-masters")
  }

  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (hasWord(title, words) || [...tags].some((t) => TAG_CATEGORIES[t] === cat)) cats.push(cat)
  }
  if (cats.includes("flowers") && !cats.includes("still-life") && /\b(vase|vaas)\b/.test(title)) {
    cats.push("still-life")
  }
  if (cats.includes("portrait") && (cats.includes("landscape") || cats.includes("sea"))) {
    // "Woman in a garden" is a scene, not a portrait.
    if (!hasWord(title, ["portrait", "portret", "self-portrait", "zelfportret", "portraet"])) {
      cats.splice(cats.indexOf("portrait"), 1)
    }
  }
  return [...new Set(cats)]
}

import { expect, test, type Page } from "@playwright/test"

const INGRESS = "/api/hassio_ingress/dev-token-123/"

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/__museum/")) errors.push(`${r.status()} ${r.url()}`)
  })
  return errors
}

async function ensurePaired(page: Page, name: string) {
  await page.goto("/frame-art/settings")
  const card = page.getByRole("region", { name: `TV ${name}` })
  const pair = card.getByRole("button", { name: "Pair", exact: true })
  await expect(pair.or(card.getByText("Paired", { exact: true }))).toBeVisible()
  if (await pair.isVisible()) await pair.click()
  await expect(card.getByText("Paired", { exact: true })).toBeVisible()
}

test("loads as a native HA panel and talks to the integration's API path", async ({ page }) => {
  const errors = watchErrors(page)
  const api: string[] = []
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname
    if (p.includes("/api/")) api.push(p)
  })
  await page.goto("/frame-art/")
  await expect(page.getByRole("link", { name: "Explore" })).toBeVisible()
  await expect(page.locator("a[href*='/frame-art/art/']").first()).toBeVisible()
  expect(api.filter((p) => !p.startsWith("/api/frame_art/") && !p.includes("__museum"))).toEqual([])
  expect(errors).toEqual([])
})

test("follows the HA theme (dark) and language (Dutch)", async ({ page }) => {
  await page.goto("/frame-art/?theme=dark&lang=nl")
  await expect(page.getByRole("link", { name: "Ontdek" })).toBeVisible()
  const bg = await page
    .locator("frame-art-panel")
    .evaluate((el) => getComputedStyle(el.shadowRoot!.querySelector("div > div")!).backgroundColor)
  expect(bg).toBe("rgb(17, 17, 17)")
})

test("works as the ingress page too, with everything under the ingress prefix", async ({ page }) => {
  const errors = watchErrors(page)
  const paths: string[] = []
  page.on("request", (r) => paths.push(new URL(r.url()).pathname))
  await page.goto(INGRESS)
  await expect(page.locator("a[href*='#/art/']").first()).toBeVisible()
  const own = paths.filter((p) => p.includes("/panel/") || p.includes("/api/"))
  expect(own.length).toBeGreaterThan(2)
  for (const p of own) expect(p.startsWith(INGRESS), p).toBe(true)
  expect(errors).toEqual([])
})

test("browse by category and search; a deep link survives a reload", async ({ page }) => {
  await page.goto("/frame-art/")
  await page.getByRole("button", { name: /^Old masters/ }).click()
  await expect(page).toHaveURL(/cat=old-masters/)
  await page.getByPlaceholder("Search title or artist").fill("delft")
  await expect(page).toHaveURL(/q=delft/)
  await page.locator("a[href*='/frame-art/art/']").first().click()
  await expect(page.getByRole("heading", { level: 2 }).first()).toContainText("Gezicht op Delft")
  const url = page.url()
  await page.reload()
  expect(page.url()).toBe(url)
  await expect(page.getByRole("heading", { level: 2 }).first()).toContainText("Gezicht op Delft")
})

test("pair, then fill a work on the woonkamer Frame, then once with a passe-partout", async ({ page }) => {
  await ensurePaired(page, "Woonkamer")
  await page.goto("/frame-art/?cat=landscape")
  await page.locator("a[href*='/frame-art/art/']").first().click()
  await page.getByRole("button", { name: /Show on Woonkamer/ }).click()
  await expect(page.getByText("Now on the Woonkamer TV")).toBeVisible({ timeout: 30_000 })

  await page.getByRole("radio", { name: "Passe-partout" }).click()
  await page.getByRole("radio", { name: "Dark" }).click()
  await expect(page).toHaveURL(/mode=dark/)
  await expect(page.getByText(/this time only/)).toBeVisible()
})

test("a TV in standby is switched on first", async ({ page }) => {
  await ensurePaired(page, "Slaapkamer")
  await page.goto("/frame-art/?cat=sea")
  await page.locator("a[href*='/frame-art/art/']").first().click()
  await page.getByRole("button", { name: /Show on Slaapkamer/ }).click()
  await expect(page.getByText("Now on the Slaapkamer TV")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Switching the TV on")).toBeVisible()
})

test("My collection: upload into a new album, show it, delete it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one upload run is enough")
  await page.goto("/frame-art/collection")
  await page.getByRole("button", { name: "New album" }).click()
  await page.getByPlaceholder("Album name").fill("Vakantie")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page).toHaveURL(/album=/)
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAkCAIAAAB4+M+5AAAAOklEQVR42u3OMQ0AAAgDMOZf9DQgggHRXJl0xlJaAQMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwP/Ywe2AgFT7f9vAAAAAElFTkSuQmCC",
    "base64",
  )
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "zonsondergang.png", mimeType: "image/png", buffer: png })
  const card = page.locator("a[href*='/frame-art/art/mine']").first()
  await expect(card).toContainText("zonsondergang")
  await card.click()
  await expect(page.getByRole("button", { name: "Vakantie" })).toHaveAttribute("aria-pressed", "true")
  page.once("dialog", (d) => void d.accept())
  await page.getByRole("button", { name: "Delete" }).click()
  await expect(page).toHaveURL(/\/collection/)
})

test("Settings: turn a source off and the catalogue follows; MCP endpoint is shown", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "settings run once")
  await page.goto("/frame-art/?source=")
  const before = await page.getByText(/\d+ works/).textContent()
  await page.goto("/frame-art/settings")
  await expect(page.getByText("/api/frame_art/mcp").first()).toBeVisible()
  await page.getByRole("switch", { name: "Rijksmuseum" }).click()
  await page.goto("/frame-art/")
  await expect(page.getByText(/\d+ works/)).not.toHaveText(before!)
  await page.goto("/frame-art/settings")
  await page.getByRole("switch", { name: "Rijksmuseum" }).click()
})

test("phone: HA menu button and tabs", async ({ page }, info) => {
  test.skip(info.project.name !== "phone")
  await page.goto("/frame-art/")
  await expect(page.getByRole("button", { name: "Menu" })).toBeVisible()
  await page.getByRole("link", { name: "History" }).click()
  await expect(page).toHaveURL(/\/frame-art\/history/)
})

test("MCP: absolute endpoints (Nabu Casa first, local selectable) and the token only when revealed", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "settings run once")
  await page.goto("/frame-art/settings")
  const endpoint = page.getByTestId("mcp-endpoint")
  await expect(endpoint).toHaveText("https://example.ui.nabu.casa/api/frame_art/mcp")
  const command = page.getByTestId("mcp-command")
  await expect(command).toContainText("frame-art https://example.ui.nabu.casa/api/frame_art/mcp")
  await expect(command).toContainText("Bearer <token>")

  await page.getByRole("combobox", { name: "Endpoint" }).selectOption({ label: "Local" })
  await expect(endpoint).toHaveText(/^http:\/\/localhost:\d+\/api\/frame_art\/mcp$/)

  const { token } = (await (await page.request.get("/api/frame_art/api/settings/mcp")).json()) as { token: string }
  await page.getByRole("button", { name: "Show" }).click()
  await expect(command).toContainText(`Bearer ${token}`)
})

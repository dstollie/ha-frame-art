import { expect, test, type Page } from "@playwright/test"

const PREFIX = "/api/hassio_ingress/dev-token-123/"

async function ensurePaired(page: Page, name: string) {
  await page.goto("./#/instellingen")
  const tv = page.getByRole("region", { name: `TV ${name}` })
  const pairButton = tv.getByRole("button", { name: "Koppelen", exact: true })
  await expect(pairButton.or(tv.getByText("Gekoppeld"))).toBeVisible()
  if (await pairButton.isVisible()) await pairButton.click()
  await expect(tv.getByText("Gekoppeld")).toBeVisible()
}

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/__museum/")) errors.push(`${r.status()} ${r.url()}`)
  })
  return errors
}

test("loads under the ingress prefix with every asset and API call relative to it", async ({ page }) => {
  const errors = watchErrors(page)
  const requests: string[] = []
  page.on("request", (r) => requests.push(new URL(r.url()).pathname))
  await page.goto("./")
  await expect(page.getByRole("heading", { name: "Ontdek" })).toBeVisible()
  await expect(page.locator("a[href*='#/werk/']").first()).toBeVisible()
  const own = requests.filter((p) => p.includes("/assets/") || p.includes("/api/"))
  expect(own.length).toBeGreaterThan(3)
  for (const p of own) expect(p.startsWith(PREFIX), p).toBe(true)
  expect(errors).toEqual([])
})

test("browse by category and search, deep link survives a reload", async ({ page }) => {
  await page.goto("./")
  await page.getByRole("button", { name: /^Gouden Eeuw/ }).click()
  await expect(page.getByRole("heading", { name: "Gouden Eeuw" })).toBeVisible()
  await expect(page).toHaveURL(/#\/\?cat=gouden-eeuw/)
  await page.getByLabel("Zoeken").fill("delft")
  await expect(page).toHaveURL(/q=delft/)
  await page.locator("a[href*='#/werk/']").first().click()
  await expect(page.locator("aside h1")).toContainText("Gezicht op Delft")
  const url = page.url()
  await page.reload()
  expect(page.url()).toBe(url)
  await expect(page.locator("aside h1")).toContainText("Gezicht op Delft")
})

test("pair in Instellingen, then one tap puts a work on the woonkamer Frame", async ({ page }, info) => {
  const errors = watchErrors(page)
  await ensurePaired(page, "Woonkamer")

  await page.goto("./#/?cat=landschap")
  await page.locator("a[href*='#/werk/']").first().click()
  const title = (await page.locator("aside h1").textContent())!
  await page.getByRole("radio", { name: /Donker/ }).click()
  await expect(page).toHaveURL(/mode=dark/)
  await page.getByRole("button", { name: /Zet op woonkamer/ }).click()
  await expect(page.getByText("Hangt nu in de woonkamer")).toBeVisible({ timeout: 30_000 })

  await page.goto("./")
  const wall = page.getByRole("region", { name: "Nu aan de muur" })
  await expect(wall.getByText(title).first()).toBeVisible()
  if (info.project.name === "desktop") expect(errors).toEqual([])
})

test("a TV in standby is woken first", async ({ page }) => {
  await ensurePaired(page, "Slaapkamer")
  await page.goto("./#/?cat=zee")
  await page.locator("a[href*='#/werk/']").first().click()
  await page.getByRole("button", { name: /Zet op slaapkamer/ }).click()
  await expect(page.getByText("Hangt nu in de slaapkamer")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("TV aanzetten")).toBeVisible()
})

test("favourites round trip", async ({ page }, info) => {
  await page.goto("./")
  // Projects share one server: use a different work per project.
  await page
    .locator("a[href*='#/werk/']")
    .nth(info.project.name === "phone" ? 5 : 2)
    .click()
  const title = (await page.locator("aside h1").textContent())!
  const saved = page.waitForResponse((r) => r.url().includes("/favourite") && r.ok())
  await page.getByRole("button", { name: "Bewaar als favoriet" }).click()
  await saved
  await expect(page.getByRole("button", { name: /^Favoriet$/ })).toBeVisible()
  await page.goto("./#/favorieten")
  await expect(page.locator("main a[href*='#/werk/']", { hasText: title }).first()).toBeVisible()
})

test("phone: bottom navigation and history", async ({ page }, info) => {
  test.skip(info.project.name !== "phone")
  await page.goto("./")
  const nav = page.getByRole("navigation", { name: "Hoofdmenu" }).last()
  await expect(nav).toBeVisible()
  await nav.getByRole("link", { name: "Geschiedenis" }).click()
  await expect(page.getByRole("heading", { name: "Geschiedenis" })).toBeVisible()
})

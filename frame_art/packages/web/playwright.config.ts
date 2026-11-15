import { defineConfig, devices } from "@playwright/test"

const PORT = 8131
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}/api/hassio_ingress/dev-token-123/`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 960 } } },
    { name: "phone", use: { ...devices["iPhone 15 Pro"], browserName: "chromium" } },
  ],
  webServer: {
    // Serves the production build (dist) behind a fake ingress prefix, with two fake Frames.
    command: `pnpm --filter @frame-art/server exec tsx scripts/dev-stack.ts --seed fake --port ${PORT}`,
    url: `http://localhost:${PORT}/api/hassio_ingress/dev-token-123/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})

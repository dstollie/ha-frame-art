import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// base "./": every asset path is relative, so one build works under any HA ingress prefix.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false, chunkSizeWarningLimit: 700 },
  server: { proxy: { "/api": "http://localhost:8099" } },
})

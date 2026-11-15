import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * One ES module, `panel/frame-art-panel.js`, defining the <frame-art-panel> web component. HA loads
 * it as a custom panel (through the integration); the ingress page (public/index.html) loads the
 * same file. CSS is inlined into the component's shadow root.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    copyPublicDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    lib: {
      entry: path.resolve(__dirname, "src/panel.tsx"),
      formats: ["es"],
      fileName: () => "panel/frame-art-panel.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})

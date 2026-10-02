import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The SPA is built into dist/ and served by the Worker as static assets.
// In dev, `npm run dev` runs `wrangler dev` on :8787 and Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8787" } },
});

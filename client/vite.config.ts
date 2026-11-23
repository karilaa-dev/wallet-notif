import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Backend for /api during dev/preview. Override with API_TARGET if needed.
const target = process.env.API_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target, changeOrigin: false },
    },
  },
  preview: {
    proxy: {
      "/api": { target, changeOrigin: false },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

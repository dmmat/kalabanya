import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this project from https://<user>.github.io/kalabanya/
// so the base path must match the repo name. Override with BASE env if needed.
export default defineConfig({
  base: process.env.BASE ?? "/kalabanya/",
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});

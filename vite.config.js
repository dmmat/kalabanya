import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves this project from https://<user>.github.io/kalabanya/
// so the base path must match the repo name. Override with BASE env if needed.
export default defineConfig({
  base: process.env.BASE ?? "/kalabanya/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "og-image.jpg",
        "robots.txt",
      ],
      manifest: {
        name: "КАЛАБАНЯ — калюжа, що висихає",
        short_name: "Калабаня",
        description:
          "Поетична інкрементальна гра-роглайк про калюжу, що висихає.",
        lang: "uk",
        dir: "ltr",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#070f12",
        theme_color: "#0b1a20",
        categories: ["games", "entertainment"],
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // precache the whole app shell + art so it works fully offline
        globPatterns: ["**/*.{js,css,html,svg,png,webp,jpg,json,txt,xml,woff2}"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});

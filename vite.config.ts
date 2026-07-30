import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.VITE_BASE_PATH ?? (repository ? `/${repository}/` : "/");
const commit = process.env.GITHUB_SHA?.slice(0, 7) ?? "development";

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_COMMIT__: JSON.stringify(commit)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["app-icon.svg"],
      manifest: {
        name: "Scan & Fourier Analyzer",
        short_name: "Scan Analyzer",
        description: "Private, offline scientific scan and Fourier analysis.",
        theme_color: "#102a43",
        background_color: "#f4f7fa",
        display: "standalone",
        orientation: "any",
        start_url: base,
        scope: base,
        icons: [
          {
            src: "app-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"]
      }
    })
  ],
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1800
  }
});

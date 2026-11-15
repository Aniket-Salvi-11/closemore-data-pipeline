/**
 * Builds the website widget: ONE JavaScript file (React, styles and images included).
 *   npm run build:widget   ->   dist-widget/closemore-copilot.js
 * Separate from the dev app (vite.config.ts); nothing else is needed on the website.
 */
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // The simulated answers (sample people and deals) never go into the website build.
      ...(process.env["WIDGET_MOCK"] === "true"
        ? []
        : [
            {
              find: "@/lib/mock-api",
              replacement: fileURLToPath(new URL("./src/widget/no-mock.ts", import.meta.url)),
            },
          ]),
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  // Ignore .env / .env.local: the dev settings there (mock mode, a local API address) must never end
  // up in the website build. Mock mode only with: WIDGET_MOCK=true npm run build:widget
  envDir: "widget-env-none",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.VITE_USE_MOCK_API": JSON.stringify(
      process.env["WIDGET_MOCK"] === "true" ? "true" : "false",
    ),
  },
  // Images are bundled into the script; nothing from public/ is needed on the website.
  publicDir: false,
  build: {
    outDir: "dist-widget",
    emptyOutDir: true,
    lib: {
      entry: "src/widget/main.tsx",
      name: "CloseMoreCopilotWidget",
      formats: ["iife"],
      fileName: () => "closemore-copilot.js",
    },
    cssCodeSplit: false,
    assetsInlineLimit: 200_000,
  },
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const useLocalRepository = env.VITE_SONORA_REPOSITORY === "local";

  return {
    cacheDir: ".vite-cache",
    plugins: [react()],
    server: {
      // 1 (local): serve public/media from Vite — no Django proxy.
      // 2 (api): proxy API/media/ws to Django, but still prefer local public files when present.
      proxy: useLocalRepository
        ? undefined
        : {
            "/api/v1": {
              target: "http://127.0.0.1:8000",
              changeOrigin: true,
            },
            "/media": {
              target: "http://127.0.0.1:8000",
              changeOrigin: true,
              bypass(req) {
                const pathname = req.url?.split("?")[0] ?? "";
                if (pathname && existsSync(join(process.cwd(), "public", pathname))) {
                  return pathname;
                }
              },
            },
            "/ws": {
              target: "ws://127.0.0.1:8000",
              ws: true,
            },
          },
    },
    build: { emptyOutDir: true },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: true,
    },
  };
});

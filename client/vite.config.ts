import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "cosign:local-editor",
      configureServer(server) {
        const { allowedHosts } = server.config.server;
        if (!allowedHosts || (Array.isArray(allowedHosts) && !allowedHosts.length)) return;
        server.middlewares.use("/__open-in-editor", (_request, response) => {
          response.statusCode = 404;
          response.end();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//.test(id)) return "motion";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/healthz": { target: "http://127.0.0.1:3001" },
      "/.well-known": { target: "http://127.0.0.1:3001" },
      "/mcp": { target: "http://127.0.0.1:3001" },
      "/authorize": { target: "http://127.0.0.1:3001" },
      "/token": { target: "http://127.0.0.1:3001" },
      "/register": { target: "http://127.0.0.1:3001" },
      "/revoke": { target: "http://127.0.0.1:3001" },
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});

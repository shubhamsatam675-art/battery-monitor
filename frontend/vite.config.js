import { defineConfig } from "vite";

// In dev, the frontend runs on :5173 and the API on :3001.
// This proxy lets the frontend call "/api/..." without CORS or hardcoded hosts.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});

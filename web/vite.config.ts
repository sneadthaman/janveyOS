import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "./web",
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      },
      "/health": {
        target: "http://localhost:3000",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "../web-dist",
    emptyOutDir: true
  }
});

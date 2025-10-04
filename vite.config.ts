import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/stat-visualizer/",
  build: {
    // minify: false,
  },
  resolve: {
    alias: {
      buffer: "buffer",
    },
  },
});

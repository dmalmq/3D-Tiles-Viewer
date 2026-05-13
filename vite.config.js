import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [cesium()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["gdal3.js"] },
  server: {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
});

import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

const devServerHeaders =
  process.env.VITE_DEV_ALLOW_CORS === "false"
    ? undefined
    : { "Access-Control-Allow-Origin": "*" };

export default defineConfig({
  plugins: [cesium()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["gdal3.js"] },
  server: devServerHeaders ? { headers: devServerHeaders } : {},
});

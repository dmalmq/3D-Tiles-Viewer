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
  build: {
    rollupOptions: {
      input: {
        main: "./index.html",
        viewer: "./viewer.html",
      },
    },
  },
  server: {
    ...(devServerHeaders ? { headers: devServerHeaders } : {}),
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.host) {
              proxyReq.setHeader("x-forwarded-host", req.headers.host);
              proxyReq.setHeader("x-forwarded-proto", "http");
            }
          });
        },
      },
      "/sessions": { target: "http://localhost:3001", changeOrigin: true },
      "/tilesets": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const api = spawn("node", ["server/index.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: "3001", PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || "http://localhost:5173" },
  stdio: "inherit",
  shell: process.platform === "win32",
});

const vite = spawn("npx", ["vite", "--port", "5173"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
});

function shutdown() {
  api.kill();
  vite.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

api.on("exit", (code) => {
  if (code) shutdown();
});
vite.on("exit", (code) => {
  if (code) shutdown();
});
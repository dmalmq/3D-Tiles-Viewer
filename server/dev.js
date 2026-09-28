import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Run both children with this Node binary directly (no shell): avoids
// DEP0190 on Node 24 and lets kill() reach the real process on Windows
// instead of a cmd.exe wrapper.
const VITE_BIN = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

const api = spawn(process.execPath, ["server/index.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: "3001", PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || "http://localhost:5173" },
  stdio: "inherit",
});

const vite = spawn(process.execPath, [VITE_BIN, "--port", "5173"], {
  cwd: ROOT,
  stdio: "inherit",
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
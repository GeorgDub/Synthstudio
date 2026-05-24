#!/usr/bin/env node
// Localhost-Dev-Server: bindet Vite ausschließlich an 127.0.0.1, öffnet
// nach Start automatisch den Standardbrowser. Niemand außer dem lokalen
// Gerät kann den Server erreichen — kein LAN, kein HTTPS, kein QR.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

process.env.NODE_ENV ??= "development";

export function buildLocalUrl(port) {
  return `http://localhost:${port}`;
}

function printBanner(localUrl) {
  console.log(
    [
      "",
      "  🖥️   Synthstudio Local Dev Server",
      "  ─────────────────────────────────────────────",
      `  URL:    ${localUrl}`,
      "  Bind:   127.0.0.1  (nur dieses Gerät)",
      "",
      "  Browser wird automatisch geöffnet.",
      "",
    ].join("\n")
  );
}

async function main() {
  const server = await createServer({
    configFile: path.join(PROJECT_ROOT, "vite.config.ts"),
    mode: "development",
    server: {
      host: "127.0.0.1",
      open: true,
    },
  });

  await server.listen();
  const port = server.config.server.port ?? 5173;
  printBanner(buildLocalUrl(port));
}

main().catch((err) => {
  console.error("dev:mobile failed:", err);
  process.exit(1);
});

#!/usr/bin/env node
// Mobile-Dev-Server: bindet Vite an alle Netzwerk-Interfaces, aktiviert HTTPS
// per selbst-signiertem Zertifikat (basic-ssl) und druckt LAN-URLs + QR-Codes
// im Terminal, damit man die App direkt am Handy öffnen kann.
//
// Nutzung: pnpm dev:mobile  (HTTP per default ist nicht aktiviert — wir
// brauchen HTTPS, damit WebMIDI/Mikro auch über LAN-IPs funktionieren).
//
// In GitHub Codespaces wird HTTPS automatisch deaktiviert (der Codespaces-
// Proxy terminiert HTTPS selbst) und stattdessen die öffentliche
// Codespace-URL inkl. QR-Code ausgegeben.

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

process.env.NODE_ENV ??= "development";

export function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      addresses.push({ name, address: info.address });
    }
  }
  return addresses;
}

export function buildMobileUrls(addresses, { protocol, port }) {
  return addresses.map(({ name, address }) => ({
    iface: name,
    url: `${protocol}//${address}:${port}`,
  }));
}

export function detectCodespace(env = process.env) {
  if (env.CODESPACES !== "true") return null;
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (!name || !domain) return null;
  return { name, domain };
}

export function buildCodespaceUrl({ name, domain }, port) {
  return `https://${name}-${port}.${domain}`;
}


function printLanBanner(localUrl, lanUrls) {
  const lines = [
    "",
    "  📱  Synthstudio Mobile Dev Server",
    "  ─────────────────────────────────────────────",
    `  Local:  ${localUrl}`,
  ];
  if (lanUrls.length === 0) {
    lines.push("  LAN:    (keine externen IPv4-Interfaces gefunden)");
  } else {
    lines.push("  LAN:");
    for (const { iface, url } of lanUrls) {
      lines.push(`    • ${url}    (${iface})`);
    }
  }
  lines.push(
    "",
    "  💡  HTTPS nutzt ein selbst-signiertes Zertifikat.",
    "      Beim ersten Aufruf am Handy → 'Trotzdem fortfahren' wählen.",
    "      WebMIDI/Mikrofon brauchen HTTPS, daher kein HTTP-Fallback.",
    ""
  );
  console.log(lines.join("\n"));
}

function printCodespaceBanner(publicUrl) {
  console.log(
    [
      "",
      "  📱  Synthstudio Mobile Dev Server (GitHub Codespaces)",
      "  ─────────────────────────────────────────────",
      `  Public: ${publicUrl}`,
      "",
      "  💡  Port 5173 muss in der Codespaces-Port-Sichtbarkeit auf",
      "      'Public' stehen, sonst lädt das Handy die Login-Seite.",
      "      HTTPS wird vom Codespaces-Proxy terminiert — der Server",
      "      selbst läuft HTTP, deshalb kein basicSsl-Plugin hier.",
      "",
    ].join("\n")
  );
}

function printQrCodes(entries) {
  if (entries.length === 0) return;
  for (const { label, url } of entries) {
    console.log(`  QR für ${label}  →  ${url}`);
    qrcode.generate(url, { small: true });
  }
}

async function main() {
  const codespace = detectCodespace();
  const useHttps = !codespace;

  const server = await createServer({
    configFile: path.join(PROJECT_ROOT, "vite.config.ts"),
    mode: "development",
    plugins: useHttps ? [basicSsl()] : [],
    server: {
      host: true,
      ...(useHttps ? { https: {} } : {}),
    },
  });

  await server.listen();

  const port = server.config.server.port ?? 5173;

  if (codespace) {
    const publicUrl = buildCodespaceUrl(codespace, port);
    printCodespaceBanner(publicUrl);
    printQrCodes([{ label: "Codespace", url: publicUrl }]);
    return;
  }

  const localUrl = `https://localhost:${port}`;
  const lanUrls = buildMobileUrls(getLanAddresses(), {
    protocol: "https:",
    port,
  });
  printLanBanner(localUrl, lanUrls);
  printQrCodes(lanUrls.map(({ iface, url }) => ({ label: iface, url })));
}

main().catch((err) => {
  console.error("dev-mobile failed:", err);
  process.exit(1);
});

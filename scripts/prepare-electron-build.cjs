#!/usr/bin/env node
/**
 * prepare-electron-build.js
 *
 * Dieses Script wird vor `electron-builder` ausgeführt und kopiert
 * die kompilierten Electron-Dateien in eine Staging-Struktur, die
 * electron-builder korrekt verpacken kann.
 *
 * Hintergrund: electron-builder v26 mit pnpm ignoriert `files[]`-Konfiguration
 * für Nicht-node_modules-Verzeichnisse. Dieses Script umgeht das Problem,
 * indem es eine flache Staging-Struktur erstellt.
 *
 * Ausführen: node scripts/prepare-electron-build.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STAGING = path.join(ROOT, "electron-staging");

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function copyDir(src, dest, filter = () => true) {
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ Quelle nicht gefunden: ${src}`);
    return 0;
  }
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(srcPath, destPath, filter);
    } else if (filter(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

// ─── Staging-Verzeichnis vorbereiten ─────────────────────────────────────────

console.log("🔧 Electron Build Staging...");
console.log(`   Staging: ${STAGING}`);

// Altes Staging löschen
if (fs.existsSync(STAGING)) {
  fs.rmSync(STAGING, { recursive: true });
}
fs.mkdirSync(STAGING, { recursive: true });

// 1. Minimale package.json für Staging erstellen
// electron-builder v3+ verbietet das 'build'-Feld in der App-package.json
const pkgSrc = path.join(ROOT, "package.json");
const pkgDest = path.join(STAGING, "package.json");
const pkgData = JSON.parse(fs.readFileSync(pkgSrc, "utf8"));
const stagingPkg = {
  name: pkgData.name || "korg-synth-studio",
  version: pkgData.version || "1.0.0",
  main: pkgData.main || "electron-dist/main.cjs",
};
fs.writeFileSync(pkgDest, JSON.stringify(stagingPkg, null, 2) + "\n");
console.log("   ✓ package.json (Staging-Version, kein build-Feld)");

// 2. electron-dist/ kopieren (.cjs + .json)
const electronDistSrc = path.join(ROOT, "electron-dist");
const electronDistDest = path.join(STAGING, "electron-dist");
const electronCount = copyDir(
  electronDistSrc,
  electronDistDest,
  (name) => name.endsWith(".cjs") || name.endsWith(".json")
);
console.log(`   ✓ electron-dist/ (${electronCount} Dateien)`);

// 3. dist/public/ kopieren (React-App, ohne .map-Dateien)
const distPublicSrc = path.join(ROOT, "dist", "public");
const distPublicDest = path.join(STAGING, "dist", "public");
const distCount = copyDir(
  distPublicSrc,
  distPublicDest,
  (name) => !name.endsWith(".map")
);
console.log(`   ✓ dist/public/ (${distCount} Dateien)`);

// 4. assets/ kopieren (Icons)
const assetsSrc = path.join(ROOT, "assets");
const assetsDest = path.join(STAGING, "assets");
if (fs.existsSync(assetsSrc)) {
  const assetsCount = copyDir(assetsSrc, assetsDest);
  console.log(`   ✓ assets/ (${assetsCount} Dateien)`);
}

console.log("");
console.log(`✅ Staging abgeschlossen: ${STAGING}`);
console.log("   Nächster Schritt: electron-builder --dir --linux");

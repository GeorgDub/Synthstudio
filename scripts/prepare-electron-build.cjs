#!/usr/bin/env node
/**
 * prepare-electron-build.cjs
 *
 * HINWEIS: Dieses Script ist ein No-Op seit v1.0.5.
 * electron-builder wird direkt aus dem Root ausgeführt mit:
 *   - asar: false
 *   - extraResources für electron-dist/ und dist/public/
 *
 * Das Script bleibt erhalten, damit der GitHub Actions Workflow
 * nicht geändert werden muss (fehlende workflows-Permission).
 */
console.log("✅ prepare-electron-build.cjs: No-Op (seit v1.0.5 nicht mehr benötigt)");
console.log("   electron-builder wird direkt aus dem Root ausgeführt.");
console.log("   Konfiguration: asar=false, extraResources=[electron-dist, dist/public]");

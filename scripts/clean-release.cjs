/**
 * scripts/clean-release.cjs — TASK-244 (v3.234+)
 *
 * Loescht VOR `electron-builder` die signierte Installer-EXE der AKTUELLEN
 * package.json-Version aus release/, damit ein Build-Re-Run keinen
 * Windows-Defender-File-Lock auf der noch-gelockten frueheren Datei trifft.
 *
 * Hintergrund:
 *   v3.231-Build scheiterte 1x mit `makensis: Can't open output file` —
 *   Defender hatte die frisch-signierte EXE noch ~1-2s gelockt. NSIS liess
 *   ein 263 KB-Bruchstueck liegen. Re-Run nach manuellem Delete lief durch.
 *   Dieses Skript automatisiert den Delete.
 *
 * Verhalten:
 *   - Lese version aus ./package.json
 *   - Loesche `release/Synthstudio Setup <VERSION>.exe` (falls vorhanden)
 *   - Loesche `release/Synthstudio Setup <VERSION>.exe.blockmap` (sonst veralteter blockmap)
 *   - Loesche `release/__uninstaller-NSIS-*-Synthstudio.exe` (Pre-NSIS-Intermediate)
 *   - Loesche `release/.__uninstaller.exe` (falls electron-builder das anlegt)
 *   - ALTE Versionen bleiben unberuehrt (User-Werkzeug zum Vergleichen)
 *   - Fehlende Files = OK (kein Fail)
 *
 * Hook: `package.json` prebuild:electron:win ruft dieses Skript.
 */
const fs = require("fs");
const path = require("path");

function readPackageVersion() {
  const pkgPath = path.resolve(__dirname, "..", "package.json");
  const raw = fs.readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  if (typeof pkg.version !== "string" || !pkg.version) {
    throw new Error(`package.json hat keine gueltige version: ${pkg.version}`);
  }
  return pkg.version;
}

function unlinkIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    // EBUSY = Defender hat noch das Handle. Kurz warten + retry.
    if (err.code === "EBUSY" || err.code === "EPERM") {
      try {
        // 200ms blocking sleep via Atomics (kein Promise / await — CJS-Script).
        const sab = new SharedArrayBuffer(4);
        const view = new Int32Array(sab);
        Atomics.wait(view, 0, 0, 200);
        fs.unlinkSync(filePath);
        return true;
      } catch (err2) {
        if (err2.code === "ENOENT") return false;
        console.warn(`[clean-release] Konnte ${filePath} nicht loeschen: ${err2.code}`);
        return false;
      }
    }
    console.warn(`[clean-release] Unerwarteter Fehler bei ${filePath}: ${err.code || err.message}`);
    return false;
  }
}

function cleanReleaseForVersion(releaseDir, version) {
  if (!fs.existsSync(releaseDir)) {
    return { deleted: [], skipped: [], note: "release/ existiert noch nicht" };
  }
  const targets = [
    `Synthstudio Setup ${version}.exe`,
    `Synthstudio Setup ${version}.exe.blockmap`,
    `.__uninstaller.exe`,
  ];
  const deleted = [];
  const skipped = [];
  for (const name of targets) {
    const full = path.join(releaseDir, name);
    if (unlinkIfExists(full)) {
      deleted.push(name);
    } else if (fs.existsSync(full)) {
      skipped.push(name);
    }
  }
  // Pre-NSIS-Intermediate hat ein Wildcard-Naming-Pattern.
  // `__uninstaller-NSIS-X.YY-Synthstudio.exe` mit X.YY = NSIS-Version.
  try {
    for (const entry of fs.readdirSync(releaseDir)) {
      if (/^__uninstaller-NSIS-.*Synthstudio\.exe$/.test(entry)) {
        if (unlinkIfExists(path.join(releaseDir, entry))) {
          deleted.push(entry);
        }
      }
    }
  } catch {
    /* ignore — readdir kann race-condition werfen wenn jemand parallel mutiert */
  }
  return { deleted, skipped };
}

function main() {
  const releaseDir = path.resolve(__dirname, "..", "release");
  const version = readPackageVersion();
  const result = cleanReleaseForVersion(releaseDir, version);
  if (result.note) {
    console.log(`[clean-release] ${result.note}`);
    return;
  }
  if (result.deleted.length === 0 && result.skipped.length === 0) {
    console.log(`[clean-release] Nichts zu loeschen fuer v${version}`);
    return;
  }
  for (const name of result.deleted) {
    console.log(`[clean-release] geloescht: ${name}`);
  }
  for (const name of result.skipped) {
    console.warn(`[clean-release] gelocked, nicht geloescht: ${name}`);
  }
}

// Export fuer Unit-Tests; CLI-Aufruf via `node scripts/clean-release.cjs`.
module.exports = { cleanReleaseForVersion, readPackageVersion };

if (require.main === module) {
  main();
}

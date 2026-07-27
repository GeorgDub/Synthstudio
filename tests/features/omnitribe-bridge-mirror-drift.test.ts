/**
 * omnitribe-bridge-mirror-drift.test.ts — Drift-Gate für die OmniTribe-Spiegel.
 *
 * Vier Dateien in diesem Repo sind **Kopien**, keine Quellen. Ihre Quelle liegt
 * im OmniTribe-Repo, und der Weg hierher führt ausschließlich über
 * `omnitribe/tools/build/sync_to_synthstudio.py --apply`:
 *
 *   client/src/audio/OmniTribeBridge.ts   ← host/synthstudio/OmniTribeBridge.ts
 *   client/src/audio/nrpn-map.ts          ← host/synthstudio/nrpn-map.ts (generiert)
 *   docs/omnitribe/NRPN_REFERENCE.md      ← docs/midi/NRPN_REFERENCE.md
 *   SYNTHSTUDIO_INTEGRATION.md            ← SYNTHSTUDIO_INTEGRATION.md
 *
 * Wer eine davon hier direkt bearbeitet, verliert die Änderung beim nächsten
 * Sync — lautlos.
 *
 * ── Warum Hash-Manifest statt Pfad-Vergleich ────────────────────────────────
 * Die Vorgängerfassung las die Quelle über einen absoluten Pfad
 * (`G:/IdeaProjects/Omnitribe/...`) und übersprang sich deshalb per
 * `RUN_BRIDGE_DRIFT_CHECK=1`-Opt-in selbst. CI-Runner haben dieses Laufwerk
 * nicht, also lief der Test dort nie — er schützte faktisch nichts. Genau in
 * dieser Zeit fiel die NRPN-Map um eine Generation zurück (16 statt 17 Module,
 * zwei Monate alt), ohne dass es jemandem auffiel.
 *
 * Jetzt schreibt das Sync-Tool bei `--apply` ein Hash-Manifest
 * (`client/src/audio/.omnitribe-sync.json`) mit dem sha256 jeder Quelldatei.
 * Der Test vergleicht die Spiegel dagegen — ohne Zugriff aufs andere Repo,
 * also überall lauffähig.
 *
 * Ein Manifest und keine eingecheckten Kopien: eine Kopie könnte selbst
 * driften, ein Hash nicht.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = resolve(REPO, "client/src/audio/.omnitribe-sync.json");

interface SyncManifest {
  _comment?: string;
  files: Record<string, string>;
}

function readManifest(): SyncManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as SyncManifest;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("OmniTribe-Spiegel: Drift-Gate", () => {
  it("das Sync-Manifest ist vorhanden und wohlgeformt", () => {
    expect(
      existsSync(MANIFEST_PATH),
      "client/src/audio/.omnitribe-sync.json fehlt — im OmniTribe-Repo " +
        "'python tools/build/sync_to_synthstudio.py --apply' ausführen",
    ).toBe(true);

    const m = readManifest();
    expect(m.files, "Manifest hat kein files-Objekt").toBeTypeOf("object");
    expect(
      Object.keys(m.files).length,
      "Manifest ist leer — der Sync hat keine Quelle gefunden",
    ).toBeGreaterThan(0);
  });

  it("keine gespiegelte Datei wurde hier direkt bearbeitet", () => {
    const m = readManifest();
    const drifted: string[] = [];

    for (const [rel, expectedSha] of Object.entries(m.files)) {
      const path = resolve(REPO, rel);
      if (!existsSync(path)) {
        drifted.push(`${rel}: fehlt`);
        continue;
      }
      const actual = sha256(path);
      if (actual !== expectedSha) {
        drifted.push(
          `${rel}: ${actual.slice(0, 12)}… erwartet ${expectedSha.slice(0, 12)}…`,
        );
      }
    }

    expect(
      drifted,
      "Diese Spiegel weichen von ihrer Quelle ab. Änderungen gehören ins " +
        "OmniTribe-Repo, danach dort 'python tools/build/sync_to_synthstudio.py " +
        `--apply' ausführen:\n  ${drifted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("die NRPN-Map trägt alle Module der Quelle", () => {
    // Der konkrete Rückfall, den dieses Gate verhindern soll: die Map war zwei
    // Monate und ein Modul zurück (generator_catalog fehlte komplett), weil der
    // Sync nach einer Änderung an der Quelle nie lief.
    const map = readFileSync(resolve(REPO, "client/src/audio/nrpn-map.ts"), "utf8");
    const modules = [...map.matchAll(/^\s*"([a-z_]+)":\s*\{/gm)].map((x) => x[1]);

    expect(modules.length, `nur ${modules.length} Module gefunden`).toBeGreaterThanOrEqual(17);
    expect(modules).toContain("generator_catalog");
  });

  it("die Bridge exportiert die Symbole, die die Parity-Harness braucht", () => {
    // unpack32_7bit war in der Quelle exportiert und im Spiegel nicht — genau
    // die Art stiller Einweg-Drift, die vorher niemand bemerkt hat.
    const bridge = readFileSync(
      resolve(REPO, "client/src/audio/OmniTribeBridge.ts"),
      "utf8",
    );
    for (const sym of ["encode7Bit", "decode7Bit", "buildFrame", "unpack32_7bit"]) {
      expect(
        bridge,
        `${sym} ist im Spiegel nicht exportiert — die TS↔Py-Parity-Harness ` +
          "in OmniTribe importiert es",
      ).toMatch(new RegExp(`export\\s+(?:async\\s+)?function\\s+${sym}\\b`));
    }
  });
});

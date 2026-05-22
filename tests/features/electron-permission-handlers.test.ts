/**
 * tests/features/electron-permission-handlers.test.ts
 *
 * Regression-Tests fuer electron/permissions.ts (TASK-243, schuetzt TASK-242).
 *
 * Diese Tests sind die letzte Verteidigung gegen versehentliche Erweiterung
 * der Permission-Whitelist. SysEx + MIDI = direkter Hardware-Zugriff aus dem
 * Renderer (KORG OmniTribe, Electribe2-NRPN, externe Pads). Eine versehentliche
 * Erweiterung um z.B. `geolocation`, `usb`, `hid`, `bluetooth`, `notifications`
 * oeffnet zusaetzliche Angriffsflaechen und MUSS hier rot werden.
 *
 * Anti-Regression-Strategie:
 *  1. Harte Set-Groesse (toBe(4)) -> bricht bei jeder Erweiterung
 *  2. Explizite Whitelist-Eintraege einzeln (Diff zeigt sofort was sich aendert)
 *  3. Explizite Deny-Liste typischer Chromium-Permissions
 *  4. Pure-Helper isPermissionAllowed() positiv + negativ + Edge-Cases
 *
 * Wichtig: keine Snapshot-Tests (toMatchSnapshot) - Diff soll im Test-File
 * selbst lesbar sein, nicht in einer separaten .snap-Datei.
 *
 * Das Modul electron/permissions.ts importiert KEINE Electron-Runtime -
 * dieser Test laeuft daher ohne jeden Mock direkt in Vitest/Node.
 */
import { describe, it, expect } from "vitest";
import {
  ALLOWED_PERMISSIONS,
  isPermissionAllowed,
} from "../../electron/permissions";

// ─── Konstanten fuer Regression-Klarheit ─────────────────────────────────────

/**
 * Exakte erwartete Whitelist-Groesse. Wird diese Zahl geaendert ohne dass
 * der Test mitgeaendert wird -> Build rot. Das ist Absicht.
 */
const EXPECTED_WHITELIST_SIZE = 4;

/**
 * Die VIER Permissions, die im Renderer erlaubt sein duerfen.
 * Aenderungen MUESSEN durch Security-Review (siehe agents/SECURITY.md).
 */
const EXPECTED_ALLOWED = [
  "media", // Mikrofon-Input fuer Outboard-FX-Modus
  "mediaKeySystem", // DRM-related Audio (Chromium ruft implizit)
  "midi", // Web MIDI API (Required for KORG OmniTribe + Electribe2 + Pads)
  "midiSysex", // Required for KORG OmniTribe SysEx integration (NRPN+OTP)
] as const;

/**
 * Permissions, die EXPLIZIT verboten bleiben muessen. Diese Liste ist
 * nicht erschoepfend - sie deckt typische Chromium-Permission-Strings
 * ab, die wir bewusst NIE granten. Bei Hinzufuegen einer dieser Perms
 * zur Whitelist muss dieser Test angepasst werden, was den Security-Review
 * sichtbar macht.
 */
const EXPECTED_DENIED = [
  "geolocation", // Standortzugriff - DAW braucht das nie
  "notifications", // System-Notifications - wir nutzen In-App-Toasts
  "camera", // Video-Input - keine Anwendung
  "microphone", // <- Chromium liefert "media" fuer Mic/Cam; "microphone" allein nicht erlaubt
  "usb", // WebUSB - Hardware via WebMIDI/Web Audio statt
  "hid", // WebHID - dito
  "bluetooth", // Web Bluetooth - dito
  "serial", // Web Serial - dito
  "clipboard-read", // Clipboard-Zugriff - nicht benoetigt
  "clipboard-write", // dito
  "idle-detection", // Anwesenheitserkennung - irrelevant
  "background-sync", // ServiceWorker-Sync - keine Anwendung
  "persistent-storage", // Quota-Erweiterung - keine Anwendung
  "fullscreen", // Fullscreen-API laeuft bereits ohne Permission im Electron
  "openExternal", // Externe URLs - haben dedizierten IPC-Channel
  "pointerLock", // Pointer Lock - kein Use-Case
  "display-capture", // Screen-Capture - keine Anwendung
] as const;

// ─── ALLOWED_PERMISSIONS ─────────────────────────────────────────────────────

describe("ALLOWED_PERMISSIONS (Whitelist-Konstante)", () => {
  it("hat EXAKT die erwartete Anzahl an Eintraegen (Aufblaehung-Schutz)", () => {
    // CRITICAL: wenn dieser Test rot wird, hat jemand die Whitelist
    // erweitert OHNE Security-Review. Diff anschauen, dann Security-Agent
    // konsultieren, dann diese Zahl + EXPECTED_ALLOWED anpassen.
    expect(ALLOWED_PERMISSIONS.size).toBe(EXPECTED_WHITELIST_SIZE);
  });

  it("enthaelt 'media' (Mikrofon-Input fuer Outboard-FX)", () => {
    expect(ALLOWED_PERMISSIONS.has("media")).toBe(true);
  });

  it("enthaelt 'mediaKeySystem' (DRM-Audio von Chromium implizit)", () => {
    expect(ALLOWED_PERMISSIONS.has("mediaKeySystem")).toBe(true);
  });

  it("enthaelt 'midi' (Required for KORG OmniTribe + Electribe2 + Pads)", () => {
    expect(ALLOWED_PERMISSIONS.has("midi")).toBe(true);
  });

  it("enthaelt 'midiSysex' (Required for KORG OmniTribe SysEx integration)", () => {
    // CRITICAL-PATH: OmniTribe/Electribe2-Bridge ist auf SysEx angewiesen
    // (NRPN-Pattern-Edit + OTP-Firmware-Reads). Wird diese Permission
    // entfernt, ist die KORG-Hardware-Integration komplett tot.
    expect(ALLOWED_PERMISSIONS.has("midiSysex")).toBe(true);
  });

  it("enthaelt midi UND midiSysex gemeinsam (KORG-Vision-Invariante)", () => {
    // Diese Kombination ist nicht optional: Web MIDI API verlangt SysEx
    // als separate Permission, sonst kommen nur Note-On/CC-Events durch
    // (kein OmniTribe-Connect, kein Electribe2-NRPN-Edit).
    expect(ALLOWED_PERMISSIONS.has("midi")).toBe(true);
    expect(ALLOWED_PERMISSIONS.has("midiSysex")).toBe(true);
  });

  it("matched die explizite EXPECTED_ALLOWED-Liste vollstaendig (Diff-Lesbarkeit)", () => {
    // Sortiert vergleichen, damit Reihenfolge in der Quelldatei egal ist,
    // der Diff aber bei Aenderung exakt zeigt welcher String neu/weg ist.
    const actual = Array.from(ALLOWED_PERMISSIONS).sort();
    const expected = [...EXPECTED_ALLOWED].sort();
    expect(actual).toEqual(expected);
  });

  it("ist ein ReadonlySet (Mutation aus Tests/Renderer-Code verboten)", () => {
    // Typ-Check zur Laufzeit: Set existiert, hat die Set-API.
    expect(ALLOWED_PERMISSIONS).toBeInstanceOf(Set);
    // TypeScript-Compiler verhindert .add()/.delete() bereits per
    // ReadonlySet<string>-Typ - hier nur die Laufzeit-Form pruefen.
    expect(typeof ALLOWED_PERMISSIONS.has).toBe("function");
    expect(typeof (ALLOWED_PERMISSIONS as Set<string>).size).toBe("number");
  });
});

// ─── isPermissionAllowed (Pure Helper) ───────────────────────────────────────

describe("isPermissionAllowed (Pure-Helper)", () => {
  // ─ Happy Path: alle 4 erlaubten Permissions ─────────────────────────────
  describe("erlaubte Permissions (return true)", () => {
    for (const perm of EXPECTED_ALLOWED) {
      it(`erlaubt '${perm}'`, () => {
        expect(isPermissionAllowed(perm)).toBe(true);
      });
    }
  });

  // ─ Negative Cases: typische Chromium-Permissions, die deny bleiben muessen
  describe("verbotene Permissions (return false)", () => {
    for (const perm of EXPECTED_DENIED) {
      it(`verbietet '${perm}'`, () => {
        expect(isPermissionAllowed(perm)).toBe(false);
      });
    }
  });

  // ─ Edge Cases ────────────────────────────────────────────────────────────
  describe("Edge Cases", () => {
    it("verbietet den leeren String", () => {
      expect(isPermissionAllowed("")).toBe(false);
    });

    it("verbietet unbekannte / freie Strings", () => {
      expect(isPermissionAllowed("not-a-real-permission")).toBe(false);
      expect(isPermissionAllowed("foo")).toBe(false);
      expect(isPermissionAllowed("admin")).toBe(false);
    });

    it("ist case-sensitive (Chromium-Permission-Strings sind lowercase/camelCase)", () => {
      // 'MIDI' uppercase ist KEIN gueltiger Chromium-Permission-String,
      // 'MidiSysex' auch nicht. Wenn jemand sich vertippt, muss deny rauskommen.
      expect(isPermissionAllowed("MIDI")).toBe(false);
      expect(isPermissionAllowed("Midi")).toBe(false);
      expect(isPermissionAllowed("MIDISYSEX")).toBe(false);
      expect(isPermissionAllowed("MidiSysex")).toBe(false);
      expect(isPermissionAllowed("Media")).toBe(false);
    });

    it("verbietet whitespace-padded Strings (keine Trim-Toleranz)", () => {
      // Defense-in-Depth: falls Chromium jemals einen padded String liefert,
      // bleibt der Default deny. Wir wollen KEINE Auto-Trim-Logik im Pfad.
      expect(isPermissionAllowed(" midi")).toBe(false);
      expect(isPermissionAllowed("midi ")).toBe(false);
      expect(isPermissionAllowed(" midiSysex ")).toBe(false);
    });

    it("verbietet aehnliche aber falsche Strings (kein Prefix/Substring-Match)", () => {
      // Sicherstellen, dass die Implementierung Set.has() nutzt
      // und NICHT startsWith()/includes() - sonst koennte 'midi-extra'
      // versehentlich granted werden.
      expect(isPermissionAllowed("midi-extra")).toBe(false);
      expect(isPermissionAllowed("midiextra")).toBe(false);
      expect(isPermissionAllowed("media-stream")).toBe(false);
      expect(isPermissionAllowed("sysex")).toBe(false);
      expect(isPermissionAllowed("midiSysexExt")).toBe(false);
    });
  });

  // ─ Konsistenz-Check Helper <-> Set ───────────────────────────────────────
  describe("Konsistenz Helper <-> ALLOWED_PERMISSIONS", () => {
    it("isPermissionAllowed() stimmt fuer jeden Whitelist-Eintrag mit Set.has() ueberein", () => {
      // Falls jemand den Helper auf eine andere Datenquelle umstellt
      // (eigenes Array, ENV-Variable, …), divergiert das hier.
      for (const perm of ALLOWED_PERMISSIONS) {
        expect(isPermissionAllowed(perm)).toBe(ALLOWED_PERMISSIONS.has(perm));
        expect(isPermissionAllowed(perm)).toBe(true);
      }
    });

    it("isPermissionAllowed() liefert false fuer Strings ausserhalb des Sets", () => {
      const allOutside = [...EXPECTED_DENIED, "", "random-string-xyz"];
      for (const perm of allOutside) {
        expect(isPermissionAllowed(perm)).toBe(false);
        expect(ALLOWED_PERMISSIONS.has(perm)).toBe(false);
      }
    });
  });
});

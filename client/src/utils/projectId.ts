/**
 * Synthstudio – projectId.ts (v3.58.0)
 *
 * Stable UUID-Generator + Validator für das `projectId`-Feld im
 * .synth-File-Schema v1.24. Closes v3.57-Caveat:
 *   "projectNameToId(projectName) als ID → Rename verliert AutoSave-History".
 *
 * Eine projectId ist:
 *   - genau einmal erzeugt (bei `newProject`)
 *   - immutable für die Lebenszeit des Projekts (auch bei Rename)
 *   - im .synth-File persistent (Round-Trip-stable)
 *   - kompatibel mit sanitizeProjectId() aus autoSaveEngine
 *     (Whitelist /^[A-Za-z0-9_-]{1,64}$/ — UUID v4 erfüllt das)
 *
 * Format: UUID v4 (RFC 4122) — 36 Zeichen `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.
 * Fallback ohne `crypto.randomUUID` (alte Browser, Node-Tests): manueller
 * v4-Generator über `crypto.getRandomValues` oder `Math.random` als
 * letzter Pfad.
 *
 * Pure-fn-Modul, keine Side-Effects. Testbar in env:node.
 */

/** Strikte Validierung: muss Schema-v1.24-konform sein. */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Liefert true wenn `raw` eine wohlgeformte UUID v4 ist.
 * Wird beim Load eines v1.24-Files genutzt, um zwischen "fresh UUID
 * generieren" und "vorhandene UUID übernehmen" zu unterscheiden.
 */
export function isValidProjectId(raw: unknown): raw is string {
  return typeof raw === "string" && UUID_V4_REGEX.test(raw);
}

/**
 * Generiert eine neue UUID v4. Bevorzugt `crypto.randomUUID()`
 * (Node 19+, Chrome 92+, Firefox 95+, Safari 15.4+). Fallback auf
 * `crypto.getRandomValues()` + manuelle Konstruktion. Letzter Fallback
 * für Test-Umgebungen ohne crypto: `Math.random()` (NICHT kryptographisch,
 * aber für eine projectId-Disambiguation ausreichend).
 */
export function generateProjectId(): string {
  // Pfad 1: Native randomUUID (bevorzugt)
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === "function") {
      const id = c.randomUUID();
      if (isValidProjectId(id)) return id;
    }
  } catch {
    /* fallthrough */
  }

  // Pfad 2: getRandomValues + manuelle v4-Konstruktion
  try {
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (c && typeof c.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      // RFC 4122 v4: byte 6 high-nibble = 4, byte 8 high-nibble = 8..b
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      return bytesToUuid(bytes);
    }
  } catch {
    /* fallthrough */
  }

  // Pfad 3: Math.random-Fallback (Test-Env ohne crypto)
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, "0"));
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}

/**
 * Liefert die projectId aus einem geladenen .synth-File ODER generiert
 * eine neue, falls das Feld fehlt (pre-v1.24) oder invalid ist.
 *
 * Pure-fn, deterministisch wenn `existing` valide ist — sonst nicht-
 * deterministisch (frische UUID). Wird in parseProject() + im
 * useProjectStore-Load-Pfad genutzt.
 */
export function ensureProjectId(existing: unknown): string {
  if (isValidProjectId(existing)) return existing;
  return generateProjectId();
}

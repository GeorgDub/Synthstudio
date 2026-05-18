/**
 * Synthstudio – autoBackupController.ts (v3.65.0)
 *
 * Pre-Action AutoBackup-Helper. Schützt User vor undo-baren destruktiven
 * Aktionen (Clear Pattern, Delete Pattern, Apply Template, Compact ESX-Bank,
 * etc.) indem VOR Ausführung der Aktion eine markierte AutoSave-Version
 * geschrieben wird.
 *
 * Defensive-Contract:
 *   - autoBackupBeforeAction blockiert NIE die Aktion. Bei Fehler wird der
 *     User-Action-Pfad trotzdem ausgeführt — der User-Confirm-Dialog hat
 *     immer Vorrang.
 *   - Fehler werden silent geloggt (console.warn) und gezählt für Tests.
 *
 * Label-Format: "Before: <actionLabel>"  z.B. "Before: Clear Pattern"
 *
 * Public-API:
 *   autoBackupBeforeAction(actionLabel, projectId, snapshotProvider)
 *     → Promise<AutoBackupResult>
 *   buildAutoBackupLabel(actionLabel) → string  (pure-fn, deterministic)
 *   isAutoBackupLabel(label) → boolean  (pure-fn, für History-Filter)
 *   stripAutoBackupPrefix(label) → string  (pure-fn, für UI-Display)
 *
 * Wird konsumiert von:
 *   App.tsx (pattern-clear, korg-template-apply, pattern-delete)
 *   KorgBankEditor.tsx (compact)
 *   DrumMachine.tsx (pattern-clear-button)
 *   VersionHistoryModal.tsx (Label-Display + Filter-Toggle)
 */
import { writeAutoSaveVersion } from "@/utils/autoSaveEngine";

// ─── Label-Konventionen ──────────────────────────────────────────────────────

/** Präfix für AutoBackup-Labels — gemeinsam für Pre-Action + Manuelle Saves. */
export const AUTO_BACKUP_LABEL_PREFIX = "Before: ";

/** Maximale Länge eines Action-Labels (Engine-Cap ist 200, wir lassen Margin). */
export const AUTO_BACKUP_MAX_ACTION_LABEL = 150;

/**
 * Baut das vollständige Label für eine Pre-Action-Backup-Version.
 * Pure-fn, idempotent: doppelter Aufruf erzeugt keine doppelte Präfixierung.
 */
export function buildAutoBackupLabel(actionLabel: string): string {
  const raw = typeof actionLabel === "string" ? actionLabel.trim() : "";
  if (!raw) return `${AUTO_BACKUP_LABEL_PREFIX}Action`;
  const stripped = raw.startsWith(AUTO_BACKUP_LABEL_PREFIX)
    ? raw.slice(AUTO_BACKUP_LABEL_PREFIX.length).trim()
    : raw;
  const safe = stripped.slice(0, AUTO_BACKUP_MAX_ACTION_LABEL);
  return `${AUTO_BACKUP_LABEL_PREFIX}${safe}`;
}

/**
 * True wenn ein Label mit dem AutoBackup-Präfix beginnt.
 * Für History-Filter "nur manuelle Backups anzeigen".
 */
export function isAutoBackupLabel(label: string | null | undefined): boolean {
  if (typeof label !== "string") return false;
  return label.startsWith(AUTO_BACKUP_LABEL_PREFIX);
}

/**
 * Entfernt den AutoBackup-Präfix für UI-Display.
 * Pure-fn, defensive: kein Präfix → Pass-through.
 */
export function stripAutoBackupPrefix(label: string | null | undefined): string {
  if (typeof label !== "string") return "";
  if (!label.startsWith(AUTO_BACKUP_LABEL_PREFIX)) return label;
  return label.slice(AUTO_BACKUP_LABEL_PREFIX.length);
}

// ─── Public-API: Pre-Action-Hook ─────────────────────────────────────────────

export interface AutoBackupResult {
  /** True wenn die AutoSave-Version geschrieben wurde. */
  success: boolean;
  /** Versions-ID bei success=true. */
  versionId?: string;
  /** Label das geschrieben wurde (für Tests + History-Display). */
  label?: string;
  /** Fehler-String bei success=false (silent — nicht im UI gezeigt). */
  error?: string;
}

/**
 * Snapshot-Provider: liefert das aktuelle Project-JSON. Wird als Function
 * übergeben statt direkt JSON, damit der Aufrufer den Snapshot lazy bauen
 * kann (Serialisierung kostet).
 */
export type AutoBackupSnapshotProvider = () => string | null | undefined;

// ─── Globaler Hook-Registry (für tief verschachtelte Caller) ────────────────

/**
 * Eine pre-bound Backup-Funktion, die nur noch das actionLabel braucht.
 * App.tsx registriert sich nach dem ersten Render, alle anderen Komponenten
 * können ohne Prop-Drilling rufen.
 */
export type BoundAutoBackup = (actionLabel: string) => Promise<AutoBackupResult>;

let _registeredBackup: BoundAutoBackup | null = null;

/**
 * App.tsx ruft das einmal nach dem useCallback-Init. unregisterAutoBackup()
 * wird im Unmount-Cleanup aufgerufen.
 */
export function registerAutoBackup(fn: BoundAutoBackup | null): void {
  _registeredBackup = fn;
}

/**
 * Liest die registrierte Backup-Funktion. Returnt eine safe No-Op wenn
 * nichts registriert ist (z.B. in Tests oder vor App.tsx-Mount).
 */
export function getRegisteredAutoBackup(): BoundAutoBackup {
  if (_registeredBackup) return _registeredBackup;
  return async (actionLabel: string) => ({
    success: false,
    label: buildAutoBackupLabel(actionLabel),
    error: "no backup registered",
  });
}

/** Test-Helper: reset der globalen Registrierung zwischen Tests. */
export function __resetAutoBackupRegistryForTests(): void {
  _registeredBackup = null;
}

/**
 * Führt VOR einer destruktiven User-Action einen AutoBackup-Write aus.
 *
 * NIE blockierend für die Aktion: bei Fehler (kein Snapshot, invalid
 * projectId, Engine-Fail) returnt {success:false,error:...} ohne zu werfen.
 * Der Aufrufer ignoriert das Result einfach und macht die Aktion trotzdem.
 *
 *   await autoBackupBeforeAction("Clear Pattern", projectId, () => json);
 *   dm.clearPattern();
 */
export async function autoBackupBeforeAction(
  actionLabel: string,
  projectId: string | null | undefined,
  snapshotProvider: AutoBackupSnapshotProvider,
): Promise<AutoBackupResult> {
  const label = buildAutoBackupLabel(actionLabel);

  // Defensive guards — silent skip, nie blockieren.
  if (typeof projectId !== "string" || projectId.length === 0) {
    return { success: false, label, error: "missing projectId" };
  }
  if (typeof snapshotProvider !== "function") {
    return { success: false, label, error: "missing snapshotProvider" };
  }

  let json: string | null | undefined;
  try {
    json = snapshotProvider();
  } catch (err) {
    return { success: false, label, error: `snapshot-throw: ${String(err)}` };
  }
  if (typeof json !== "string" || json.length === 0) {
    return { success: false, label, error: "empty snapshot" };
  }

  try {
    const res = await writeAutoSaveVersion(projectId, json, { label });
    if (!res.success) {
      // Engine schon defensive — nur loggen.
      console.warn("[AutoBackup] Schreibfehler:", res.error, "label:", label);
      return { success: false, label, error: res.error };
    }
    return { success: true, versionId: res.versionId, label };
  } catch (err) {
    console.warn("[AutoBackup] Promise-Reject:", err, "label:", label);
    return { success: false, label, error: String(err) };
  }
}

/**
 * startupPicker.ts — Pure-Logik für den Startup-Projekt-Picker (v3.292).
 *
 * Beim Programmstart wird KEIN Projekt mehr automatisch geladen. Stattdessen
 * entscheidet der User: neues Projekt, vorhandenes laden, oder das zuletzt
 * geöffnete öffnen. Diese Datei kapselt die (DOM-freie, testbare) Frage
 * „soll der Picker erscheinen und ist ein letztes Projekt verfügbar?".
 */

/** Minimale Sicht auf einen gecachten Projekt-Snapshot (nur was der Picker zeigt). */
export interface CachedProjectInfo {
  projectName?: string;
}

/**
 * Entscheidet, ob der Startup-Picker angezeigt werden soll.
 *
 * @param opts.welcomeWizardOpen  First-Run-Wizard aktiv → Picker unterdrücken.
 * @param opts.openedViaFile      Projekt kam via Datei-Assoziation/CLI → kein Picker.
 * @param opts.alreadyShown       Wurde in dieser Session schon gezeigt.
 */
export function shouldShowStartupPicker(opts: {
  welcomeWizardOpen: boolean;
  openedViaFile?: boolean;
  alreadyShown?: boolean;
}): boolean {
  if (opts.alreadyShown) return false;
  if (opts.welcomeWizardOpen) return false;
  if (opts.openedViaFile) return false;
  return true;
}

/**
 * Liefert den Anzeige-Namen des letzten Projekts (für den "Letztes öffnen"-
 * Button) oder null, wenn kein (gültiges) letztes Projekt vorliegt.
 */
export function lastProjectLabel(
  cached: CachedProjectInfo | null | undefined
): string | null {
  if (!cached) return null;
  const name = (cached.projectName ?? "").trim();
  if (name.length === 0) return null;
  if (name === "Neues Projekt") return null; // leeres Default → kein echtes „letztes"
  return name;
}

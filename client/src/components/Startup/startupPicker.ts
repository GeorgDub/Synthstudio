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
 * @param opts.isAutomated        Automatisierte Umgebung (Playwright/WebDriver,
 *   `navigator.webdriver === true`) → Picker unterdrücken. Ohne das blockiert
 *   das Modal JEDEN Web-E2E-Test (Klicks laufen in Timeouts; brach die komplette
 *   Playwright-Suite inkl. „Audit 3: keine blockierenden Overlays"). Die
 *   bestehende Test-Konvention seedet Modals per localStorage weg — für ein
 *   neues Modal müssten ~40 Spec-Files angefasst werden; webdriver-Detection
 *   deckt alle ab, ohne echte User zu betreffen.
 * @param opts.forceForTest       Explizites Opt-in (z.B. künftige Picker-E2E-
 *   Tests via localStorage-Flag) → übersteuert isAutomated.
 */
export function shouldShowStartupPicker(opts: {
  welcomeWizardOpen: boolean;
  openedViaFile?: boolean;
  alreadyShown?: boolean;
  isAutomated?: boolean;
  forceForTest?: boolean;
}): boolean {
  if (opts.alreadyShown) return false;
  if (opts.welcomeWizardOpen) return false;
  if (opts.openedViaFile) return false;
  if (opts.isAutomated && !opts.forceForTest) return false;
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

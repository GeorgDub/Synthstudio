/**
 * Synthstudio – quickActionContextRegistry (v3.69.0)
 *
 * Globale Registry für den aktiven QuickActionContext.
 *
 * Hintergrund:
 *   App.tsx ist die einzige Komponente die alle nötigen Setter
 *   (dm/mixer/scene/performance/audio-engine) zugleich besitzt. Tief
 *   verschachtelte Komponenten (MacroEditor in der SettingsPanel-Sidebar
 *   z.B.) brauchen den Context aber zum "Test"-Button-Klick. Statt
 *   Prop-Drilling registriert App.tsx den fertig gewireten Context hier
 *   und alle Consumer rufen `getRegisteredQuickActionContext()` ab.
 *
 * Wie autoBackupController.ts. Pure-Modul ohne React-Abhängigkeiten.
 */
import type { QuickActionContext } from "@/utils/quickActionExecutor";

let _registered: QuickActionContext | null = null;

/**
 * Registriert den globalen QuickActionContext oder löscht ihn (null).
 * Idempotent. Unmount → registerQuickActionContext(null).
 */
export function registerQuickActionContext(
  ctx: QuickActionContext | null,
): void {
  _registered = ctx;
}

/**
 * Liest den aktuell registrierten Context aus. Null wenn App.tsx noch
 * nicht gemountet ist (z.B. in Tests oder Popup-Renderern). Caller muss
 * defensive damit umgehen ("Test"-Button disabled wenn null).
 */
export function getRegisteredQuickActionContext(): QuickActionContext | null {
  return _registered;
}

/**
 * Test-Helper. Reset zwischen Vitest-Runs.
 */
export function __resetQuickActionContextRegistryForTests(): void {
  _registered = null;
}

/**
 * client/src/utils/popoutThemeSync.ts
 *
 * MIG-3C: Hält das `data-theme` Attribut und Custom-Themes-Style in allen
 * geöffneten dockview-popout-Fenstern synchron mit dem Hauptfenster.
 *
 * Workflow:
 *   1. Beim Öffnen eines Popouts: registerPopoutWindow(win)
 *      → setzt das aktuelle theme auf win.document.documentElement
 *      → hängt Custom-Theme-<style>-Element-Klon hinzu falls aktiv
 *
 *   2. Beim Theme-Wechsel (applyTheme / applyCustomTheme):
 *      → broadcastTheme() iteriert über alle registrierten popouts
 *      → wendet identische DOM-Mutation an
 *
 *   3. Beim Schließen des Popouts: window 'unload' event → unregister
 *
 * Architektur: ein Module-Singleton trackt Set<Window>. Wir benutzen
 * `win.closed` als Lebendcheck und filtern tote Refs vor Broadcasts.
 */

const STYLE_ELEMENT_ID = "ss-custom-theme-style";

const _popouts = new Set<Window>();

/** Registriert ein popout-Fenster für Theme-Sync. Returns cleanup. */
export function registerPopoutWindow(win: Window | null | undefined): () => void {
  if (!win) return () => {};
  _popouts.add(win);
  // Initialer Sync — aktuelles Theme aus Hauptfenster übernehmen
  syncThemeToWindow(win);
  // Auto-Unregister bei Schließen
  const onUnload = () => {
    _popouts.delete(win);
  };
  try {
    win.addEventListener("unload", onUnload, { once: true });
  } catch { /* ignore */ }
  return () => {
    try { win.removeEventListener("unload", onUnload); } catch { /* ignore */ }
    _popouts.delete(win);
  };
}

/** Wendet das aktuelle Theme von document.documentElement auf ein Ziel-Fenster an. */
export function syncThemeToWindow(win: Window): void {
  if (win.closed) {
    _popouts.delete(win);
    return;
  }
  const winDoc = win.document;
  const winHtml = winDoc.documentElement;

  // 1. data-theme Attribut
  const dataTheme = document.documentElement.getAttribute("data-theme");
  if (dataTheme) {
    winHtml.setAttribute("data-theme", dataTheme);
  } else {
    winHtml.removeAttribute("data-theme");
  }

  // 2. Custom-Theme <style>-Element klonen
  // Existierende Klon-Style entfernen damit replace clean ist
  const existing = winDoc.getElementById(STYLE_ELEMENT_ID);
  if (existing) existing.remove();

  const sourceStyle = document.getElementById(STYLE_ELEMENT_ID);
  if (sourceStyle) {
    const clone = winDoc.createElement("style");
    clone.id = STYLE_ELEMENT_ID;
    clone.textContent = sourceStyle.textContent ?? "";
    winDoc.head.appendChild(clone);
  }
}

/** Broadcastet aktuelles Theme an ALLE registrierten popouts. */
export function broadcastThemeToPopouts(): void {
  for (const win of Array.from(_popouts)) {
    if (win.closed) {
      _popouts.delete(win);
      continue;
    }
    try {
      syncThemeToWindow(win);
    } catch { /* ignore — cross-origin oder bereits zerstört */ }
  }
}

/** Für Tests / Debug. */
export function getPopoutCount(): number {
  let alive = 0;
  for (const w of _popouts) if (!w.closed) alive++;
  return alive;
}

/**
 * Diagnose-Log — Klick-Tap.
 *
 * Am 2026-08-10 griff ein Fix nicht, weil ein ANDERER Knopf gedrückt wurde als
 * der reparierte („⬇ Von Korg" statt „⇩ Gerät"). Das kostete eine Sitzung und
 * war hinterher nicht rekonstruierbar, weil niemand mitgeschrieben hatte.
 *
 * Capture-Phase auf `document`: so kommt der Tap vor jedem Handler dran und
 * sieht auch Klicks, die ein Handler mit `stopPropagation()` abfängt.
 */
import type { TraceLog } from "./traceLog";

/** Der Knopf, nicht das Icon darin. */
function bedienElement(ziel: EventTarget | null): HTMLElement | null {
  if (!(ziel instanceof Element)) return null;
  const treffer = ziel.closest(
    "button, a, [role='button'], input, select, [data-testid]"
  );
  return (treffer as HTMLElement | null) ?? (ziel as HTMLElement);
}

/**
 * Wie der Knopf im Log heißen soll.
 *
 * ★ `data-testid` gewinnt: Beschriftungen ändern sich, und zwei Knöpfe
 * dürfen dieselbe tragen — genau das war ja die Falle. Die Beschriftung
 * kommt trotzdem mit, damit ich sie im Screenshot wiederfinde.
 */
function benenne(el: HTMLElement): { src: string; msg: string } {
  const testid = el.getAttribute("data-testid");
  const aria = el.getAttribute("aria-label");
  const titel = el.getAttribute("title");
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const beschriftung = aria || text || titel || "";
  const tag = el.tagName.toLowerCase();
  return {
    src: testid || beschriftung || tag,
    msg: beschriftung ? `${tag} „${beschriftung}"` : `${tag} (ohne Beschriftung)`,
  };
}

/** Installiert den Tap. Gibt eine Funktion zurück, die ihn wieder entfernt. */
export function installClickTap(log: TraceLog): () => void {
  const handler = (event: Event) => {
    try {
      const el = bedienElement(event.target);
      if (!el) return;
      const { src, msg } = benenne(el);
      // Jeder Klick eröffnet eine eigene Kette — die folgenden Frames und
      // Schritte hängen daran und sind später als EIN Vorgang lesbar.
      const corr = log.beginChain();
      log.push({ kind: "click", src, msg, corr });
    } catch {
      /* Das Log darf die Bedienung nie stören. */
    }
  };
  document.addEventListener("click", handler, true);
  return () => document.removeEventListener("click", handler, true);
}

// @vitest-environment jsdom
/**
 * Synthstudio – diag-click-tap.test.ts
 *
 * Am 2026-08-10 griff ein Fix nicht, weil ein ANDERER Knopf gedrückt wurde als
 * der reparierte — „⬇ Von Korg" statt „⇩ Gerät". Das kostete eine Sitzung und
 * war hinterher nicht rekonstruierbar.
 *
 * Der Klick-Tap hört in der Capture-Phase auf `document` mit. Er muss den Knopf
 * so benennen, dass ich ihn WIEDERERKENNE — „button" hilft niemandem — und er
 * eröffnet die Kette, an der die folgenden MIDI-Rahmen hängen.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createTraceLog } from "../../client/src/diag/traceLog";
import { installClickTap } from "../../client/src/diag/clickTap";

let abbauen: (() => void) | null = null;

afterEach(() => {
  abbauen?.();
  abbauen = null;
  document.body.innerHTML = "";
});

function klick(html: string, waehle: string) {
  document.body.innerHTML = html;
  const ziel = document.querySelector(waehle) as HTMLElement;
  ziel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return ziel;
}

describe("clickTap", () => {
  it("nennt den Knopf bei seiner Beschriftung", () => {
    const log = createTraceLog({ capacity: 50 });
    abbauen = installClickTap(log);

    klick(`<button id="a">⇩ Gerät</button>`, "#a");

    const [e] = log.recent();
    expect(e.kind).toBe("click");
    expect(e.msg).toContain("⇩ Gerät");
  });

  it("erwischt auch den Klick auf ein Kind des Knopfes", () => {
    // In der echten UI trifft der Klick fast immer ein <span> oder <svg> im
    // Knopf. Wer nur `event.target` protokolliert, schreibt „span" ins Log.
    const log = createTraceLog({ capacity: 50 });
    abbauen = installClickTap(log);

    klick(`<button aria-label="Von Korg laden"><span id="i">⬇</span></button>`, "#i");

    expect(log.recent()[0].msg).toContain("Von Korg laden");
  });

  it("bevorzugt data-testid, weil die Beschriftung sich ändern darf", () => {
    const log = createTraceLog({ capacity: 50 });
    abbauen = installClickTap(log);

    klick(`<button data-testid="pull-e2" id="a">⇩ Gerät</button>`, "#a");

    expect(log.recent()[0].src).toBe("pull-e2");
  });

  it("eröffnet eine Kette, an der die folgenden Ereignisse hängen", () => {
    const log = createTraceLog({ capacity: 50 });
    abbauen = installClickTap(log);

    klick(`<button id="a">Push</button>`, "#a");
    const nachKlick = log.push({ kind: "step", src: "t", msg: "danach" });

    expect(log.recent()[0].corr).toBeTruthy();
    expect(nachKlick.corr).toBe(log.recent()[0].corr);
  });

  it("gibt jedem Klick eine eigene Kette", () => {
    const log = createTraceLog({ capacity: 50 });
    abbauen = installClickTap(log);

    klick(`<button id="a">Erst</button>`, "#a");
    klick(`<button id="b">Dann</button>`, "#b");

    const ketten = log.recent().map(e => e.corr);
    expect(ketten[0]).not.toBe(ketten[1]);
  });

  it("hört nach dem Abbau auf zu protokollieren", () => {
    const log = createTraceLog({ capacity: 50 });
    const ab = installClickTap(log);
    ab();

    klick(`<button id="a">Nach dem Abbau</button>`, "#a");

    expect(log.recent()).toHaveLength(0);
  });
});

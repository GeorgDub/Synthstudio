/**
 * Synthstudio – Built-In Scripts (v1.75)
 *
 * Registry vorgefertigter ss.*-Scripts die direkt ohne KI-API-Key in den
 * `useScriptStore` geladen werden können. Komplementär zu
 * `aiScriptTemplates.ts` (das nur Prompts liefert die ein LLM ausführt).
 *
 * Jedes Built-In ist auf Sandbox-Konformität getestet:
 *   - enthält mind. einen ss.*-Aufruf
 *   - enthält keine `eval` / `new Function` / `fetch` etc.
 *   - bleibt unter MAX_SCRIPT_CODE_BYTES (10kB)
 *
 * Loading: User klickt "Built-In laden" im ScriptRunner → wählt ein Script
 * aus → `addScript({name, code, scope:"app", enabled:false, …})` wird
 * aufgerufen. Der User kann dann das Script umbenennen, aktivieren, oder
 * an eine Taste/Macro binden.
 */

export interface BuiltInScript {
  id: string;
  name: string;
  category: "Pattern" | "Transport" | "Performance" | "Macro";
  description: string;
  code: string;
}

export const BUILT_IN_SCRIPTS: BuiltInScript[] = [
  {
    id: "duplicate-current-pattern",
    name: "Pattern duplizieren",
    category: "Pattern",
    description:
      "Dupliziert das aktuell aktive Pattern. Praktisch als Macro/Pad-Binding " +
      "um schnell Variationen vom aktuellen Pattern zu bauen.",
    code: [
      "// Pattern duplizieren — kopiert das aktuell aktive Pattern.",
      "// Nach dem Aufruf ist die Kopie das neue aktive Pattern, also kannst du",
      "// direkt darin weiterarbeiten ohne das Original zu verändern.",
      "ss.log('Dupliziere aktuelles Pattern …');",
      "await ss.dispatch('pattern-duplicate');",
      "ss.log('Fertig — du arbeitest jetzt in der Kopie.');",
    ].join("\n"),
  },
  {
    id: "duplicate-and-randomize",
    name: "Pattern duplizieren + randomisieren",
    category: "Pattern",
    description:
      "Dupliziert das aktuelle Pattern und triggert dann sofort ein " +
      "Randomize auf die Kopie. Ideal für Variation-Building während eines " +
      "Live-Sets — Original bleibt erhalten.",
    code: [
      "// Duplizieren + randomisieren — Live-Variation-Pipeline.",
      "ss.log('Pattern duplizieren …');",
      "await ss.dispatch('pattern-duplicate');",
      "await ss.wait(50); // kurz warten damit die Kopie aktiv ist",
      "ss.log('Randomisiere die Kopie …');",
      "await ss.dispatch('pattern-randomize');",
      "ss.log('Variation bereit.');",
    ].join("\n"),
  },
  {
    id: "duplicate-fill-and-back",
    name: "Pattern duplizieren + Fill",
    category: "Pattern",
    description:
      "Dupliziert das aktuelle Pattern und triggert pattern-fill auf der " +
      "Kopie — erzeugt eine dichte 16-Step-Variation des Originals.",
    code: [
      "ss.log('Dupliziere für Fill …');",
      "await ss.dispatch('pattern-duplicate');",
      "await ss.wait(50);",
      "await ss.dispatch('pattern-fill');",
      "ss.log('Fill-Variante erstellt.');",
    ].join("\n"),
  },
  {
    id: "tap-tempo-then-play",
    name: "Tap → Play",
    category: "Transport",
    description:
      "Dispatcht 4× tap-tempo damit die BPM aus Pads heraus eingegeben " +
      "werden kann, danach startet Play. Praktisch als Macro auf einem Pad.",
    code: [
      "// 4 Taps mit jeweils 500ms Abstand = 120 BPM",
      "for (let i = 0; i < 4; i++) {",
      "  await ss.dispatch('tap-tempo');",
      "  await ss.wait(500);",
      "}",
      "await ss.play();",
      "ss.log('Tempo getappt + Play gestartet.');",
    ].join("\n"),
  },
  {
    id: "drop-reset",
    name: "Drop-Reset (Stop + Clear + Play)",
    category: "Performance",
    description:
      "Klassischer Drop-Move: Stop → kurz warten → Pattern clear → " +
      "kurz warten → Play. Auf einem Pad/Taste das instant-resetting " +
      "Tool für Live-Sets.",
    code: [
      "ss.log('Drop …');",
      "await ss.stop();",
      "await ss.wait(200);",
      "await ss.dispatch('pattern-clear');",
      "await ss.wait(100);",
      "await ss.play();",
      "ss.log('Cleared + restarted.');",
    ].join("\n"),
  },
  {
    id: "macro-zero",
    name: "Alle Macros auf 0",
    category: "Macro",
    description:
      "Setzt alle 8 Macros (0-7) instant auf 0. Praktisch als Panic-Button " +
      "um alle FX-Modulationen zurückzunehmen.",
    code: [
      "for (let i = 0; i < 8; i++) {",
      "  await ss.setMacro(i, 0);",
      "}",
      "ss.log('Alle 8 Macros = 0.');",
    ].join("\n"),
  },
  {
    id: "macro-half",
    name: "Alle Macros auf 0.5",
    category: "Macro",
    description:
      "Setzt alle 8 Macros auf 0.5 (Mitte). Sanftere FX-Default-Position " +
      "wenn du nicht alles auf 0 ziehen willst.",
    code: [
      "for (let i = 0; i < 8; i++) {",
      "  await ss.setMacro(i, 0.5);",
      "}",
      "ss.log('Alle 8 Macros = 0.5.');",
    ].join("\n"),
  },
];

/** Gruppiert die Built-Ins nach Kategorie für UI-Dropdown. */
export function groupBuiltInsByCategory(): Record<string, BuiltInScript[]> {
  const map: Record<string, BuiltInScript[]> = {};
  for (const s of BUILT_IN_SCRIPTS) {
    if (!map[s.category]) map[s.category] = [];
    map[s.category].push(s);
  }
  return map;
}

/** Findet ein Built-In per ID. */
export function findBuiltIn(id: string): BuiltInScript | undefined {
  return BUILT_IN_SCRIPTS.find((s) => s.id === id);
}

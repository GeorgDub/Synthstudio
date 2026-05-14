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
  {
    id: "carry-samples-from-prev",
    name: "Sampler vom vorherigen Pattern übernehmen",
    category: "Pattern",
    description:
      "Nimmt die Sample-Belegung + FX + Volume/Pan vom vorherigen Pattern " +
      "und kopiert sie ins aktuelle. Steps bleiben unverändert. Spart das " +
      "manuelle 8×Sample-Drag wenn du Variationen vom selben Drum-Kit baust.",
    code: [
      "ss.log('Übernehme Sampler vom vorherigen Pattern …');",
      "await ss.dispatch('pattern-copy-samples-from-prev');",
      "ss.log('Fertig — Sounds + FX vom vorherigen Pattern übernommen.');",
    ].join("\n"),
  },
  {
    id: "duplicate-with-samples-fresh-pattern",
    name: "Variation mit gleichem Sound (duplizieren + clear)",
    category: "Pattern",
    description:
      "Dupliziert das aktuelle Pattern (incl. aller Samples + FX) und " +
      "leert dann die Steps der Kopie. Ideal um eine neue Pattern-Variation " +
      "auf demselben Sound-Kit zu starten.",
    code: [
      "ss.log('Dupliziere Pattern mit allen Sounds …');",
      "await ss.dispatch('pattern-duplicate');",
      "await ss.wait(50);",
      "ss.log('Leere die Steps für eine fresh Variation …');",
      "await ss.dispatch('pattern-clear');",
      "ss.log('Fertig — neues Pattern bereit, Sound-Kit identisch.');",
    ].join("\n"),
  },
  // ─── v1.83: weitere Performance-Helper ────────────────────────────────
  {
    id: "build-up-10s",
    name: "Build-Up 10s (BPM + Macro 0)",
    category: "Performance",
    description:
      "Klassischer Build-Up: BPM von aktuellem Wert auf +20 in 10 Sekunden, " +
      "parallel Macro 0 von 0 → 1 als Filter-Sweep. Live-Tension-Booster.",
    code: [
      "// Build-Up 10s — BPM-Ramp + Filter-Sweep parallel",
      "const startBpm = 120;",
      "const targetBpm = 140;",
      "const steps = 50;",
      "for (let i = 0; i <= steps; i++) {",
      "  const t = i / steps;",
      "  await ss.bpm(Math.round(startBpm + (targetBpm - startBpm) * t));",
      "  await ss.setMacro(0, t);",
      "  await ss.wait(200);",
      "}",
      "ss.log('Build-Up komplett — Drop einleiten.');",
    ].join("\n"),
  },
  {
    id: "stutter-4-steps",
    name: "Stutter (4× Macro-Snap)",
    category: "Performance",
    description:
      "Live-Stutter-Effekt: Macro 0 4× hintereinander zwischen 0 und 1 " +
      "togglen mit 125ms Abstand — Glitch-Vibe für Übergänge.",
    code: [
      "for (let i = 0; i < 4; i++) {",
      "  await ss.setMacro(0, i % 2 === 0 ? 1 : 0);",
      "  await ss.wait(125);",
      "}",
      "await ss.setMacro(0, 0);",
      "ss.log('Stutter complete.');",
    ].join("\n"),
  },
  {
    id: "macro-random-burst",
    name: "Macro-Random-Burst",
    category: "Macro",
    description:
      "Setzt alle 8 Macros sofort auf Zufallswerte (ss.random()) — " +
      "praktisch für 'shake everything up' Live-Performance.",
    code: [
      "for (let i = 0; i < 8; i++) {",
      "  await ss.setMacro(i, ss.random());",
      "}",
      "ss.log('8 Macros randomisiert.');",
    ].join("\n"),
  },
  {
    id: "pattern-walk-8s",
    name: "Pattern-Walker (alle 8s nächstes)",
    category: "Pattern",
    description:
      "Springt alle 8 Sekunden zum nächsten Pattern, 8 Sprünge total. " +
      "Auto-Pilot für Live-Sets ohne manuelle Pattern-Wechsel.",
    code: [
      "for (let i = 0; i < 8; i++) {",
      "  ss.log(`Sprung ${i + 1}/8`);",
      "  await ss.dispatch('pattern-next');",
      "  await ss.wait(8000);",
      "}",
      "ss.log('Pattern-Walk fertig.');",
    ].join("\n"),
  },
  {
    id: "beat-repeat-burst",
    name: "Beat-Repeat-Burst (2s Note-Repeat AN, dann AUS)",
    category: "Performance",
    description:
      "Klassischer Hardtekk/Techno-Move: Note-Repeat 2 Sekunden lang einschalten " +
      "(triggert den aktuellen Step rasend), dann automatisch wieder aus. " +
      "Bind das Script auf ein Pad für Live-Stutter-Action.",
    code: [
      "ss.log('Beat-Repeat ON — 2 Sekunden Stutter');",
      "await ss.dispatch('toggle-note-repeat');",
      "await ss.wait(2000);",
      "await ss.dispatch('toggle-note-repeat');",
      "ss.log('Beat-Repeat OFF');",
    ].join("\n"),
  },
  {
    id: "beat-repeat-quick-roll",
    name: "Quick Roll (500ms Note-Repeat)",
    category: "Performance",
    description:
      "Schnellere Variante: 500ms Note-Repeat-Burst. Perfekt für kurze Drum-Rolls " +
      "und Fill-Ins zwischen den Bars.",
    code: [
      "await ss.dispatch('toggle-note-repeat');",
      "await ss.wait(500);",
      "await ss.dispatch('toggle-note-repeat');",
    ].join("\n"),
  },
  {
    id: "macro-sine-lfo-15s",
    name: "Macro 0 Sinus-LFO (15s)",
    category: "Macro",
    description:
      "Macro 0 oszilliert sinusförmig zwischen 0 und 1 für 15 Sekunden " +
      "(Periode 4s). Perfekt für sanfte Filter-Bewegungen während eines Drops.",
    code: [
      "const duration = 15000;",
      "const period = 4000;",
      "const tick = 30;",
      "const start = ss.now();",
      "while (ss.now() - start < duration) {",
      "  const t = (ss.now() - start) / period;",
      "  const v = (Math.sin(t * Math.PI * 2) + 1) / 2;",
      "  await ss.setMacro(0, v);",
      "  await ss.wait(tick);",
      "}",
      "await ss.setMacro(0, 0.5);",
      "ss.log('LFO fertig — Macro 0 zentriert.');",
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

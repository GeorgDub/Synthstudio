---
mode: agent
model: Claude Sonnet 4
---

<!-- markdownlint-disable-file -->

# Implementation Prompt: Synthstudio Roadmap – Differenzierende Features & Tests

## Implementation Instructions

### Step 1: Create Changes Tracking File

You WILL create `20260325-synthstudio-roadmap-changes.md` in #file:../changes/ if it does not exist.

### Step 2: Execute Implementation

You WILL follow the project architecture rules:
- Electron-Calls NUR über useElectron()-Hook (Goldenes Gesetz)
- Alle neuen Stores als Custom Hooks (useState + useCallback Pattern)
- TypeScript-First: Alle neuen Interfaces in der jeweiligen Modul-Datei definieren
- Tests werden parallel zur Implementierung geschrieben (Test-First wo möglich)

You WILL systematically implement #file:../plans/20260325-synthstudio-roadmap-plan.instructions.md task-by-task:

**Prioritäts-Reihenfolge (nach User-Impact):**
1. Phase 1: Step Probability & Conditional Triggers (Kern-Feature, geringer Aufwand)
2. Phase 2: Euclidean Rhythm Generator (Pure-Function, sofort testbar)
3. Phase 9: Test-Suiten für bestehende Features (Stabilisierung)
4. Phase 3: Sample Slicer (Hoher User-Value)
5. Phase 4: Performance Mode (Live-Performer Zielgruppe)
6. Phase 5: Wavetable/FM Synth (Größter Feature-Sprung)
7. Phase 6: Modulationsmatrix (Pro-User Feature)
8. Phase 7: Collaborative Session (Einzigartiges Feature)
9. Phase 8: AI Mix Assistant (AI-Erweiterung bestehender Infrastruktur)

**CRITICAL**: If ${input:phaseStop:true} is true, you WILL stop after each Phase for user review.
**CRITICAL**: If ${input:taskStop:false} is true, you WILL stop after each Task for user review.

### Step 3: Bei jeder Task

1. Lese die Details-Spezifikation aus #file:../details/20260325-synthstudio-roadmap-details.md
2. Lese den relevanten Code aus den source-Dateien (IMMER lesen vor dem Editieren)
3. Implementiere die Änderungen
4. Schreibe die Tests
5. Führe `pnpm test` aus und stelle sicher dass alle Tests grün sind
6. Führe `pnpm check` aus und stelle sicher dass TypeScript-Fehler behoben sind
7. Trage die Änderung in die Changes-Datei ein
8. Setze den Checklist-Eintrag in der Plan-Datei auf [x]

### Step 4: Architektur-Regeln

- **NIEMALS** `import { ipcRenderer }` direkt in client/ verwenden
- **IMMER** `useElectron()` für Electron-spezifische Operationen nutzen
- Neue UI-Komponenten: Radix UI Primitives + Tailwind CSS
- Neue Icons: Lucide React
- Neue Animationen: Framer Motion
- Neue Stores: React useState + useCallback Hooks (kein Zustand)

### Step 5: Test-Konventionen

```typescript
// Vorlage für neue Tests (analog zu tests/electron/dragdrop.test.ts)
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Feature – Untergruppe", () => {
  it("beschreibt das erwartete Verhalten klar", () => {
    // Arrange
    // Act
    // Assert
    expect(result).toBe(expected);
  });
});
```

- Kein Electron-Import in Unit-Tests
- Web Audio API Mock falls nötig (AudioContext, GainNode etc.)
- Logik immer in Pure Functions extrahieren, dann testen

### Step 6: Cleanup

When ALL Phases are checked off ([x]) and completed:

1. Summary aller Änderungen aus #file:../changes/20260325-synthstudio-roadmap-changes.md
2. Links zu allen erstellten Dateien (als Markdown-Links)
3. Test-Ergebnis zusammenfassen: "X/Y Tests bestanden"
4. Links zu Plan, Details und Research als Markdown
5. **MANDATORY**: Versuche diese Prompt-Datei zu löschen: .copilot-tracking/prompts/implement-synthstudio-roadmap.prompt.md

## Success Criteria

- [ ] Changes tracking file created
- [ ] Phase 1: 12 step-probability Tests grün
- [ ] Phase 2: 10 euclidean Tests grün
- [ ] Phase 3: 10 sample-slicer Tests grün
- [ ] Phase 4: 8 performance-mode Tests grün
- [ ] Phase 5: 8 synth-engine Tests grün
- [ ] Phase 6: 8 mod-matrix Tests grün
- [ ] Phase 7: 8 collaborative-session Tests grün
- [ ] Phase 8: 8 ai-mix-assistant Tests grün
- [ ] Phase 9: 28 bestehende Feature-Tests grün
- [ ] `pnpm test` 100% grün
- [ ] `pnpm check` ohne TypeScript-Fehler
- [ ] Alle UI-Komponenten in Browser UND Electron funktionsfähig

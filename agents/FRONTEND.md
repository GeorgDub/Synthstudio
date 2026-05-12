# FRONTEND — Agent-Profil

## Rolle

Der Frontend-Agent ist verantwortlich für alles, was der Nutzer sieht und direkt mit ihm interagiert: React-Komponenten, State-Management, CSS-Theming, Custom Hooks und die gesamte visuelle Qualität der Anwendung.

---

## Kernfähigkeiten

### React & TypeScript
- React 19: Server Components, Suspense, Concurrent Features, `useReducer`, `useEffect`, `useCallback`, `useMemo`
- TypeScript strict mode: Typen für alle Props, keine impliziten `any`
- Radix UI headless components richtig einsetzen (korrekte A11y-Attribute)
- Performance: `React.memo`, `useMemo`, kein unnötiges Re-Rendering

### State Management (Custom Observer Pattern)
```typescript
// Das Synthstudio-eigene Store-Pattern — NICHT Zustand npm
let _state = loadState();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function useMyStore() {
  const [, rerender] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => _listeners.delete(rerender);
  }, []);
  return _state;
}
```
Stores befinden sich in `client/src/store/use<Feature>Store.ts`.

### CSS & Theming — KRITISCHE REGELN
- **Niemals** hardcodierte Tailwind-Farben: kein `bg-slate-900`, `text-cyan-400`, `bg-gray-800`
- **Immer** semantische Klassen verwenden:

| Klasse | Token |
|---|---|
| `bg-bg-base` | `--ss-bg-base` |
| `bg-bg-panel` | `--ss-bg-panel` |
| `bg-bg-elevated` | `--ss-bg-elevated` |
| `text-text-primary` | `--ss-text-primary` |
| `text-text-muted` | `--ss-text-muted` |
| `text-text-dim` | `--ss-text-dim` |
| `border-border-color` | `--ss-border` |
| `bg-accent-primary` | `--ss-accent-primary` |
| `bg-accent-secondary` | `--ss-accent-secondary` |
| `bg-accent-success` | `--ss-accent-success` |
| `bg-accent-danger` | `--ss-accent-danger` |

- Neues Theme: alle 12 `--ss-*` Variablen definieren, `[data-theme="name"]` Selektor in `index.css`
- Nach `addCustomTheme()` immer `applyCustomTheme(id)` aufrufen — häufigster Bug!
- Circular Import Warnung: `useThemeStore.ts` importiert aus `ThemeSettings.tsx` — nicht refactoren ohne vorherige Analyse

### Isomorphes Design
- Alle Electron-Features: Browser-Fallbacks via `useElectron()` Hook
- Niemals `window.electronAPI` direkt in Komponenten verwenden

---

## Arbeitsweise

### Neue Komponente erstellen

```
1. INDEX.js lesen → relevante stores, bekannte bugs, file-ownership prüfen
2. Komponente in client/src/components/<Feature>/<Feature>.tsx erstellen
3. Store in client/src/store/use<Feature>Store.ts (falls benötigt)
4. Utility in client/src/utils/<feature>.ts (pure Logik, kein UI)
5. Ausschließlich semantische Tailwind-Klassen
6. pnpm check ausführen — muss fehlerfrei sein
7. Testing-Agent informieren: Komponente braucht Tests
```

### Bug fixen (UI/Style)

```
1. INDEX.js lesen — Bug-ID und Details lesen (idx.bugs["BUG-XXX"])
2. Betroffene Datei via idx.files[pfad] identifizieren
3. Fix implementieren
4. pnpm check
5. Bug in idx.bugs["BUG-XXX"].fixed = true setzen
6. Session-Ende: idx.update() mit changed-Pfaden
```

### Theme hinzufügen / ändern

```
1. client/src/index.css öffnen
2. [data-theme="neuer-name"] Block mit ALLEN 12 --ss-* Variablen erstellen
3. @theme Block prüfen — alle Mappings vorhanden?
4. ThemeSettings.tsx: Theme zur Auswahlliste hinzufügen
5. CustomThemeCreator falls nötig: applyCustomTheme(id) Aufruf sicherstellen
```

---

## Verantwortliche Dateien

```
client/src/
├── App.tsx                                  # Root, Tab-Routing, onPosition-Callback
├── index.css                                # Alle Themes + Design-Tokens
├── store/
│   ├── useThemeStore.ts                     # Theme-State (Circular-Import-Risiko!)
│   ├── useProjectStore.ts                   # Projekt-Load/Save, Undo/Redo
│   ├── useSequencerStore.ts                 # Step-Sequencer-State
│   ├── useSceneStore.ts                     # Scene-Launch-State
│   ├── useMorphStore.ts                     # Pattern-Morph
│   ├── useNoteRepeatStore.ts                # Note-Repeat
│   ├── useTransposeStore.ts                 # Global-Transpose
│   ├── useAutomationStore.ts                # Automation-Clips
│   ├── useKeyboardBindingsStore.ts          # Tastenkürzel
│   └── useHumanizerStore.ts                 # Humanizer
├── components/
│   ├── Settings/
│   │   ├── ThemeSettings.tsx                # Theme-Auswahl
│   │   └── CustomThemeCreator.tsx           # Custom-Theme-Formular
│   ├── Automation/AutomationView.tsx
│   ├── Scene/SceneLaunchPad.tsx
│   └── PatternMorph/PatternMorphPanel.tsx
└── hooks/
    └── useElectron.ts                       # IPC + Browser-Fallbacks
```

---

## Qualitätscheckliste (vor jedem Commit)

- [ ] Keine hardcodierten Tailwind-Farben (`bg-slate-*`, `text-gray-*`, etc.)
- [ ] Alle neuen Stores folgen dem Observer-Pattern
- [ ] Keine direkten `window.electronAPI` Zugriffe
- [ ] `pnpm check` fehlerfrei
- [ ] Testing-Agent wurde über neue/geänderte Komponenten informiert
- [ ] `idx.update()` am Session-Ende aufgerufen

---

## Session-Ende Beispiel

```js
idx.update({
  agent:   "frontend",
  done:    [
    "Fixed hardcoded bg-slate-900 in MixerView.tsx",
    "Added Daylight theme with all 12 --ss-* tokens",
    "Fixed applyCustomTheme() missing call in CustomThemeCreator"
  ],
  next:    [
    "NoteRepeatPanel still uses text-cyan-400 — replace with text-accent-primary",
    "useSequencerStore: persistence test below 60% coverage"
  ],
  changed: [
    "client/src/components/Mixer/MixerView.tsx",
    "client/src/index.css",
    "client/src/components/Settings/CustomThemeCreator.tsx"
  ]
});
```

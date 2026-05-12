# Schnellstart — Neue Session beginnen

Dieses Dokument zeigt, wie jede neue Agent-Session in 60 Sekunden startklar ist.

---

## Schritt 1: INDEX.js laden (IMMER)

```js
const idx = require('./agents/INDEX.js');
```

## Schritt 2: Kontext lesen

```js
// Projekt-Stack
console.log(idx.project.stack);

// Letzte 5 Arbeitsschritte aller Agenten
console.log(idx.workLog.slice(-5));

// Offene Aufgaben
console.log(idx.openTasks);

// Bekannte ungefixte Bugs
Object.entries(idx.bugs)
  .filter(([, b]) => !b.fixed)
  .forEach(([id, b]) => console.log(id, b.title, b.severity));
```

## Schritt 3: Agent-Profil lesen

Lies die eigene MD-Datei für spezifische Regeln:
- Coordinator → `agents/COORDINATOR.md`
- Frontend → `agents/FRONTEND.md`
- Backend → `agents/BACKEND.md`
- Testing → `agents/TESTING.md`
- Builder → `agents/BUILDER.md`
- Database → `agents/DATABASE.md`
- Security → `agents/SECURITY.md`
- Refactor → `agents/REFACTOR.md`

## Schritt 4: Arbeit beginnen

Relevante Dateien via `idx.files` identifizieren:
```js
// Wer ist Owner der Datei, die ich bearbeiten will?
console.log(idx.files['client/src/App.tsx']);
```

## Schritt 5: Session beenden (IMMER)

```js
idx.update({
  agent:   "<dein-agent-name>",
  done:    ["Was konkret erledigt wurde"],
  next:    ["Was als nächstes getan werden muss"],
  changed: ["client/src/pfad/zur/datei.tsx"]
});
```

---

## Projekt-Kommandos (Kurzreferenz)

```bash
pnpm dev              # Web-App starten (Port 5173)
pnpm dev:electron     # Electron starten
pnpm check            # TypeScript prüfen
pnpm test             # Unit-Tests
pnpm test:all         # Vollständige CI-Suite
pnpm format           # Code formatieren
```

## Kritische Regeln (nie vergessen)

1. Kein `npm` / `yarn` — nur `pnpm`
2. Keine hardcodierten Tailwind-Farben (`bg-slate-*`, `text-gray-*`)
3. Kein `window.electronAPI` direkt — immer `useElectron()` Hook
4. `pnpm check && pnpm test` muss grün sein vor jedem Commit
5. Test-Dateien niemals löschen
6. `idx.update()` am Ende jeder Session

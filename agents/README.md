# Agent System — Übersicht

Ein spezialisiertes, projektübergreifendes Multi-Agent-Coding-System für professionelle Softwareentwicklung. Jeder Agent hat genau definierte Verantwortlichkeiten, kommuniziert über ein einheitliches Protokoll und persistiert sein Wissen in `INDEX.js` — sodass keine Session mit einem leeren Wissensstand beginnt.

---

## Agenten-Übersicht

| Agent | Datei | Kernverantwortung |
|---|---|---|
| **Coordinator** | `COORDINATOR.md` | Aufgabenverteilung, Priorisierung, Konfliktlösung |
| **Frontend** | `FRONTEND.md` | React, UI, Komponenten, Themes, State |
| **Backend** | `BACKEND.md` | Electron, IPC, Audio Engine, APIs |
| **Testing** | `TESTING.md` | Unit-Tests, E2E-Tests, Bug-Dokumentation |
| **Builder** | `BUILDER.md` | Builds, CI/CD, Packaging, Dependencies |
| **Database** | `DATABASE.md` | Drizzle ORM, Migrations, Datenmodelle |
| **Security** | `SECURITY.md` | IPC-Sicherheit, Context Isolation, Audits |
| **Refactor** | `REFACTOR.md` | Code-Qualität, Debt-Abbau, Modernisierung |

---

## Kernprinzip: INDEX.js

```
┌─────────────────────────────────────────────┐
│                  INDEX.js                   │
│  Zentrales Wissens-Repository aller Agenten │
│                                             │
│  • project meta   • file map               │
│  • known bugs     • feature status         │
│  • work log       • open tasks             │
└─────────────────────────────────────────────┘
        ▲                   ▲
  LESEN bei Start     SCHREIBEN bei Ende
        │                   │
  ┌─────┴──┐  ┌──────────┐  ┌─────────┐
  │Frontend│  │ Backend  │  │ Testing │  ...
  └────────┘  └──────────┘  └─────────┘
```

**Jede Session startet mit:**
```js
const idx = require('./agents/INDEX.js');
// Jetzt kennt der Agent den vollständigen Projektzustand
```

**Jede Session endet mit:**
```js
idx.update({
  agent:   "frontend",
  done:    ["ThemeSelector refactored", "Bug BUG-003 fixed"],
  next:    ["CustomThemeCreator needs dark mode toggle"],
  changed: ["client/src/components/Settings/ThemeSettings.tsx"]
});
```

---

## Koordinationsfluss

```
User-Anfrage
     │
     ▼
COORDINATOR
  • Liest INDEX.js
  • Analysiert Anfrage
  • Bricht in Sub-Tasks auf
  • Delegiert an Spezialisten
     │
     ├──► FRONTEND  (UI, React, CSS)
     ├──► BACKEND   (Electron, Audio, APIs)
     ├──► TESTING   (Tests schreiben & ausführen)
     ├──► BUILDER   (Build, Package, Deploy)
     ├──► DATABASE  (Schema, Migrations, Queries)
     ├──► SECURITY  (Audit, IPC-Prüfung)
     └──► REFACTOR  (Code-Qualität, Debt)
          │
          ▼
     Alle schreiben Ergebnis in INDEX.js
          │
          ▼
     COORDINATOR fasst zusammen & liefert
```

---

## Dateistruktur

```
agents/
├── README.md          ← Diese Datei — Systemübersicht
├── INDEX.js           ← Zentrales Wissens-Repository
├── PROTOCOL.md        ← Kommunikationsprotokoll & Format
├── COORDINATOR.md     ← Koordinator-Agent
├── FRONTEND.md        ← Frontend-Agent
├── BACKEND.md         ← Backend-Agent
├── TESTING.md         ← Testing-Agent
├── BUILDER.md         ← Builder-Agent
├── DATABASE.md        ← Database-Agent
├── SECURITY.md        ← Security-Agent
└── REFACTOR.md        ← Refactor-Agent
```

---

## Projektübergreifende Nutzung

Das System ist **nicht Synthstudio-spezifisch**. Für ein neues Projekt:

1. `INDEX.js` kopieren und `project`-Block anpassen
2. Alle `files`, `features`, `bugs` leeren (leere Objekte `{}`)
3. Erster Agent (empfohlen: `COORDINATOR`) führt initiale Analyse durch und befüllt INDEX.js
4. Alle weiteren Agents starten sofort mit Kontext

Das System skaliert von kleinen Projekten (nur Frontend + Testing) bis zu Enterprise-Codebases (alle 8 Agenten aktiv).

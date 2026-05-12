# Kommunikationsprotokoll — Agent System

Dieses Dokument definiert verbindliche Regeln für alle Agenten: Wie sie kommunizieren, was sie lesen, was sie schreiben und wie sie Konflikte melden.

---

## 1. Session-Lifecycle (PFLICHT für jeden Agenten)

### 1.1 Session-Start

```js
const idx = require('./agents/INDEX.js');

// Pflichtlektüre:
console.log(idx.project);           // Stack, Verzeichnisse
console.log(idx.rules);             // Architektur-Regeln
console.log(idx.workLog.slice(-5)); // Die letzten 5 Einträge
console.log(idx.bugs);             // Bekannte Bugs
console.log(idx.openTasks);        // Aktuelle offene Aufgaben
```

Der Agent darf NICHT mit seiner Arbeit beginnen, ohne INDEX.js gelesen zu haben.

### 1.2 Session-Ende

```js
idx.update({
  agent:   "<agent-name>",   // z.B. "frontend", "testing"
  done:    [                 // Abgeschlossene Punkte (vollständige Sätze)
    "Renamed all hardcoded color classes in ThemeSettings.tsx",
    "Added missing --ss-border-subtle token to Nacht theme"
  ],
  next:    [                 // Was als nächstes getan werden muss
    "CustomThemeCreator still uses bg-gray-900 — needs fix",
    "Test coverage for useThemeStore below 60% — add tests"
  ],
  changed: [                 // Alle geänderten Dateipfade (relativ zu root)
    "client/src/components/Settings/ThemeSettings.tsx",
    "client/src/index.css"
  ]
});
```

Das Update ist **obligatorisch**. Eine Session ohne abschließendes Update gilt als verloren.

---

## 2. Aufgaben-Format (Task-Protokoll)

Jeder Task hat eine einheitliche Struktur:

```
TASK-<ID>
Typ:       [feature | bugfix | refactor | test | build | security | db]
Priorität: [critical | high | medium | low]
Agent:     <zugewiesener Agent>
Status:    [open | in_progress | review | done | blocked]
Beschreibung:
  <Was genau zu tun ist>
Akzeptanzkriterien:
  - [ ] Kriterium 1
  - [ ] Kriterium 2
Abhängigkeiten:
  - TASK-<X> (muss vorher fertig sein)
Geänderte Dateien:
  - <Pfade nach Abschluss>
```

Beispiel:
```
TASK-042
Typ:       bugfix
Priorität: medium
Agent:     frontend
Status:    done
Beschreibung:
  Double title bar on Windows — Electron titlebar conflicts with native Windows frame.
Akzeptanzkriterien:
  - [x] frame: false in BrowserWindow config gesetzt
  - [x] Kein doppelter Titlebar sichtbar auf Windows 10/11
Geänderte Dateien:
  - electron/main.ts
```

---

## 3. Delegations-Regeln (Coordinator → Agenten)

| Aufgabentyp | Primärer Agent | Sekundär (Review) |
|---|---|---|
| React-Komponente erstellen/ändern | Frontend | Testing |
| CSS / Theme / Token | Frontend | — |
| Electron IPC / Main Process | Backend | Security |
| Audio Engine | Backend | Testing |
| Vitest Unit Tests | Testing | — |
| Playwright E2E | Testing | Builder |
| Build-Skripte, Vite-Config | Builder | Backend |
| Drizzle Schema / Migration | Database | Backend |
| IPC-Sicherheitsaudit | Security | Backend |
| Code-Debt abbauen | Refactor | Frontend/Backend |
| Neue Abhängigkeit hinzufügen | Builder | Security |

---

## 4. Konflikt-Protokoll

Wenn zwei Agenten dieselbe Datei bearbeiten müssen:

1. **Datei-Ownership prüfen** in `INDEX.js → files[pfad].ownedBy`
2. Wenn kein Owner: Der zuerst aktive Agent setzt `ownedBy`
3. Wenn Owner existiert: Der andere Agent öffnet einen Task mit Status `blocked` und wartet
4. Nach Abschluss: Owner-Agent gibt Datei frei (setzt `ownedBy: null`)
5. Coordinator dokumentiert den Konflikt im workLog

---

## 5. Bug-Reporting-Format

Neue Bugs werden direkt in `INDEX.js → bugs` eingetragen:

```js
idx.bugs["BUG-XXX"] = {
  title:    "Kurze Beschreibung",
  severity: "critical | high | medium | low | ux",
  details:  "Vollständige Beschreibung: Schritte zur Reproduktion, Ursache, Auswirkung",
  fixed:    false,
  foundBy:  "<agent-name>",
  fixedBy:  null,
  fixedIn:  null   // Commit-Hash oder Datum wenn gefixt
};
```

Gefixte Bugs:
```js
idx.bugs["BUG-003"].fixed   = true;
idx.bugs["BUG-003"].fixedBy = "backend";
idx.bugs["BUG-003"].fixedIn = "2026-05-12";
```

Bugs werden **nie gelöscht** — nur als `fixed: true` markiert.

---

## 6. Kommunikationsstil

- **Keine Redundanz**: Agenten schreiben nur neue Informationen in das Log, keine Wiederholungen
- **Präzise Dateipfade**: Immer relativ zu Projekt-Root (z.B. `client/src/App.tsx`, nie `./App.tsx`)
- **Aktive Formulierung**: "Fixed BUG-003" nicht "BUG-003 was fixed"
- **Klare Next-Steps**: `next[]` enthält konkrete, handlungsfähige Punkte — keine Phrasen wie "weitere Tests schreiben"
- **Zeitstempel automatisch**: `idx.update()` setzt Timestamp automatisch — nicht manuell eintragen

---

## 7. Eskalations-Hierarchie

```
Testing    → meldet Bug  →  Coordinator
Security   → meldet Risiko → Coordinator
Alle       → Blocker      → Coordinator → Priorisierung
Coordinator → Critical Bug → Security + Backend (gleichzeitig)
```

Bei `critical`-Bugs stoppt der Coordinator alle anderen Tasks bis zur Lösung.

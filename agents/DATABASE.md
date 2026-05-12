# DATABASE — Agent-Profil

## Rolle

Der Database-Agent ist verantwortlich für alle persistenten Datenspeicher: Drizzle ORM Schema-Design, Migrationen, Query-Optimierung und Datenmodellierung. Er koordiniert, welche Daten in einer Datenbank gespeichert werden und welche im localStorage / .synth-Format verbleiben.

---

## Kernfähigkeiten

### Drizzle ORM
- Schema-Definition in TypeScript (typsicher, kein Magic-String SQL)
- Migration-Management mit `drizzle-kit`
- Query-Builder: `db.select().from().where().orderBy()`
- Transactions: atomare Multi-Table-Operationen
- Relation-Definitions: `relations()` für Foreign Keys

### Persistenz-Ebenen in Synthstudio

```
┌─────────────────────────────────────────────────────┐
│ Ebene 1: .synth JSON-Dateien                        │
│   Was: Komplette Projekte (Patterns, Mixer, Scenes)  │
│   Wo:  useProjectStore.ts → Electron file dialog    │
│   Format: JSON, verwaltet von useProjectStore        │
├─────────────────────────────────────────────────────┤
│ Ebene 2: localStorage                               │
│   Was: Settings, Themes, Keyboard Bindings           │
│   Wo:  Browser + Electron (über sessionStorage)      │
│   Stores: useThemeStore, useKeyboardBindingsStore    │
├─────────────────────────────────────────────────────┤
│ Ebene 3: Drizzle ORM (optional, DATABASE_URL)       │
│   Was: User-Accounts, Cloud-Sync, Shared Projects   │
│   Wo:  Server-seitig, braucht DATABASE_URL Env-Var  │
│   Kommando: pnpm db:push (Migrationen anwenden)     │
└─────────────────────────────────────────────────────┘
```

### Drizzle Setup

```bash
# Voraussetzung: DATABASE_URL in .env
pnpm db:push      # Schema auf DB anwenden (Development)
pnpm db:migrate   # Migrationen generieren (Production)
pnpm db:studio    # Drizzle Studio (visueller DB-Browser)
```

---

## Arbeitsweise

### Neues Schema erstellen

```typescript
// db/schema.ts
import { pgTable, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  data:      jsonb('data').notNull(),           // .synth-Format als JSON
  userId:    text('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const users = pgTable('users', {
  id:    text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name:  text('name')
});
```

### Migration durchführen

```bash
# 1. Schema ändern in db/schema.ts
# 2. Migration generieren:
pnpm drizzle-kit generate
# 3. Migration anwenden:
pnpm db:push   # dev: direkt pushen
# oder
pnpm db:migrate  # prod: geordnete Migration
# 4. INDEX.js aktualisieren
```

### Query-Muster

```typescript
// Lesen
const project = await db.select()
  .from(projects)
  .where(eq(projects.id, projectId))
  .limit(1);

// Schreiben (Upsert)
await db.insert(projects)
  .values({ id, name, data })
  .onConflictDoUpdate({
    target: projects.id,
    set: { data, updatedAt: new Date() }
  });

// Transaction (atomic)
await db.transaction(async (tx) => {
  await tx.update(projects).set({ name }).where(eq(projects.id, id));
  await tx.insert(auditLog).values({ action: 'rename', projectId: id });
});
```

### .synth-Format → DB-Migration

Das bestehende `.synth` JSON-Format bleibt kompatibel. Bei DB-Speicherung:
```typescript
// .synth als JSON in jsonb-Column speichern
const synthData = JSON.parse(fs.readFileSync('project.synth', 'utf-8'));
await db.insert(projects).values({ id: uuid(), data: synthData, name: synthData.name });
```

---

## Datenmodell-Prinzipien

- **Niemals** Geschäftslogik in SQL — nur Datenhaltung
- **Migrations nie löschen** — Drizzle verfolgt die Migration-History
- **jsonb für flexible Strukturen** (z.B. Pattern-Daten) statt rigider Column-Schemas
- **Optimistische Locking** bei Cloud-Sync: `version`-Column für Konflikt-Erkennung
- **Soft-Delete**: `deletedAt timestamp` statt physisches Löschen

---

## Offline-First-Strategie

Synthstudio ist primär eine Offline-App. Datenbankanbindung ist optional:

```
Offline-Modus:    .synth-Dateien + localStorage (immer funktionsfähig)
Online-Modus:     Zusätzlich DB-Sync (wenn DATABASE_URL gesetzt)
Konflikt-Resolution: Last-Write-Wins oder drei-Wege-Merge via version-Column
```

---

## Verantwortliche Dateien

```
db/
├── schema.ts          # Drizzle Schema-Definitionen
├── index.ts           # DB-Verbindung und Export
└── migrations/        # Generierte Migrations-Dateien (nie manuell editieren)

.env                   # DATABASE_URL (nicht committen!)
.env.example           # Template (committen)
drizzle.config.ts      # Drizzle-Kit Konfiguration
```

---

## Qualitätscheckliste

- [ ] Kein SQL-Injection-Risiko (Drizzle parametrisiert automatisch)
- [ ] Alle Migrations in `/db/migrations/` vorhanden und committet
- [ ] `pnpm db:push` erfolgreich auf Development-DB
- [ ] Transactions für alle multi-step Schreiboperationen
- [ ] `DATABASE_URL` in `.env.example` dokumentiert (ohne echten Wert)
- [ ] Offline-Modus ohne DATABASE_URL weiterhin vollständig funktional

---

## Session-Ende Beispiel

```js
idx.update({
  agent:   "database",
  done:    [
    "Added projects table schema with jsonb data column",
    "Created migration 0001_add_projects.sql",
    "Implemented upsert query for cloud-sync in useProjectStore.ts"
  ],
  next:    [
    "Add user authentication table (users, sessions)",
    "Implement conflict resolution for concurrent edits"
  ],
  changed: [
    "db/schema.ts",
    "db/index.ts",
    "db/migrations/0001_add_projects.sql",
    "drizzle.config.ts"
  ]
});
```

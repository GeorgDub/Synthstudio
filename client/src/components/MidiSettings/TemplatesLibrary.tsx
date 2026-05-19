/**
 * Synthstudio – TemplatesLibrary.tsx (v3.121.0)
 *
 * Browsable Library für MIDI-Hardware-Templates. Drei Tabs:
 *   1. "Hardware" — eingebaute Templates (13×) mit Kategorie-Filter
 *   2. "My Templates" — User-defined Templates (save/load/rename/delete)
 *   3. "Import/Export" — JSON-Roundtrip für Community-Sharing
 *
 * Wird vom MidiSettings-Panel als Dialog geöffnet. Isomorph: nutzt nur
 * Web-APIs (Blob, URL.createObjectURL, FileReader) — kein Electron-Bridge
 * nötig.
 *
 * Semantische Tailwind-Klassen (--ss-* tokens), keine hardcoded Farben.
 */
import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import type {
  MidiMapping,
  MidiNoteMapping,
} from "@/hooks/useMidi";
import {
  HARDWARE_TEMPLATES,
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  getTemplatesByCategory,
  type HardwareTemplate,
  type HardwareTemplateCategory,
} from "@/utils/midiHardwareTemplates";
import {
  useMidiTemplateStore,
  markRecentlyUsed,
  exportTemplateToJson,
  importTemplateFromJson,
} from "@/store/useMidiTemplateStore";
import {
  useUserMidiTemplates,
  saveUserMidiTemplate,
  deleteUserMidiTemplate,
  renameUserMidiTemplate,
  type UserMidiTemplate,
} from "@/store/useUserMidiTemplatesStore";
import {
  templateToMappings,
  getMidiTemplate,
} from "@/utils/midiTemplates";
import { toast } from "@/store/useToastStore";

interface TemplatesLibraryProps {
  /** Aktuelle Parts für partResolver (Note-Mapping-Label-Generierung). */
  parts: Array<{ id: string; name: string }>;
  /** Aktive CC + Note Mappings — für Save-Current-as-Template. */
  currentCcMappings: MidiMapping[];
  /** Aktive Note Mappings. */
  currentNoteMappings: MidiNoteMapping[];
  /** Optional: Name des aktiven Geräts (für Save-Default + Hinweise). */
  activeDeviceName?: string | null;
  /** Callback wenn ein Template angewendet werden soll. */
  onApplyMappings: (
    cc: MidiMapping[],
    notes: MidiNoteMapping[],
    sourceLabel: string,
  ) => void;
  /** Dialog schließen. */
  onClose: () => void;
}

type LibraryTab = "hardware" | "user" | "io";

const COMMUNITY_REPO_URL =
  "https://github.com/GeorgDub/Synthstudio-templates";

export function TemplatesLibrary(props: TemplatesLibraryProps): React.ReactElement {
  const {
    parts,
    currentCcMappings,
    currentNoteMappings,
    activeDeviceName,
    onApplyMappings,
    onClose,
  } = props;

  const [activeTab, setActiveTab] = useState<LibraryTab>("hardware");
  const [categoryFilter, setCategoryFilter] = useState<HardwareTemplateCategory | "all">("all");
  const [saveName, setSaveName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<HardwareTemplate | null>(null);

  const userTemplates = useUserMidiTemplates();
  const { recentlyUsed } = useMidiTemplateStore();

  const visibleTemplates = useMemo(
    () => getTemplatesByCategory(categoryFilter),
    [categoryFilter],
  );

  const recentTemplates = useMemo(() => {
    const items: Array<{ id: string; name: string; kind: "hardware" | "user" }> = [];
    for (const id of recentlyUsed) {
      const hw = HARDWARE_TEMPLATES.find((t) => t.id === id);
      if (hw) {
        items.push({ id: hw.id, name: hw.name, kind: "hardware" });
        continue;
      }
      const user = userTemplates.find((t) => t.id === id);
      if (user) {
        items.push({ id: user.id, name: user.name, kind: "user" });
      }
    }
    return items;
  }, [recentlyUsed, userTemplates]);

  // ─── Apply-Helpers ──────────────────────────────────────────────────────

  function applyHardwareTemplate(t: HardwareTemplate) {
    // Hardware-Templates haben part-N partIds. Auf reale Part-IDs übersetzen.
    const partResolver = (id: string) => {
      const partIndex = parseInt(id.replace("part-", ""), 10);
      return parts[partIndex]?.name ?? parts[partIndex]?.id;
    };
    const tpl = getMidiTemplate(t.id);
    if (!tpl) {
      toast(`Template "${t.name}" nicht in MIDI_TEMPLATES gefunden.`, { kind: "error" });
      return;
    }
    const { cc, notes } = templateToMappings(tpl, partResolver);
    const resolvedNotes = notes.map((n) => {
      const partIndex = parseInt(n.partId.replace("part-", ""), 10);
      const realPart = parts[partIndex];
      return {
        ...n,
        partId: realPart?.id ?? n.partId,
        label: realPart?.name ?? n.label,
      };
    });
    onApplyMappings(cc, resolvedNotes, t.name);
    markRecentlyUsed(t.id);
    toast(`Template „${t.name}" geladen (${cc.length} CC + ${resolvedNotes.length} Notes)`, {
      kind: "success",
    });
  }

  function applyUserTemplate(t: UserMidiTemplate) {
    onApplyMappings(t.ccMappings, t.noteMappings, t.name);
    markRecentlyUsed(t.id);
    toast(`Template „${t.name}" geladen`, { kind: "success" });
  }

  function applyImported(t: HardwareTemplate) {
    // Importiertes Template direkt anwenden + in User-Templates speichern.
    // HardwareTemplate.ccMappings/noteMappings haben kein label-Feld (Omit) —
    // wir generieren simple Default-Labels für die Persistenz.
    saveUserMidiTemplate({
      name: t.name,
      deviceName: t.manufacturer,
      ccMappings: t.ccMappings.map((m) => ({ ...m, label: `CC ${m.cc}` })),
      noteMappings: t.noteMappings.map((m) => ({ ...m, label: `Note ${m.note}` })),
    });
    setImportPreview(null);
    setImportError(null);
    toast(`Template „${t.name}" importiert und gespeichert.`, { kind: "success" });
  }

  // ─── Save Current as User-Template ──────────────────────────────────────

  function handleSaveCurrent() {
    const name = saveName.trim();
    if (!name) {
      toast("Bitte einen Namen eingeben.", { kind: "warning" });
      return;
    }
    if (currentCcMappings.length === 0 && currentNoteMappings.length === 0) {
      toast("Kein aktuelles Mapping zum Speichern.", { kind: "warning" });
      return;
    }
    saveUserMidiTemplate({
      name,
      deviceName: activeDeviceName ?? undefined,
      ccMappings: currentCcMappings,
      noteMappings: currentNoteMappings,
    });
    setSaveName("");
    toast(`Template „${name}" gespeichert.`, { kind: "success" });
  }

  // ─── Export Current to JSON ─────────────────────────────────────────────

  function handleExportCurrent() {
    if (currentCcMappings.length === 0 && currentNoteMappings.length === 0) {
      toast("Kein aktuelles Mapping zum Exportieren.", { kind: "warning" });
      return;
    }
    const exportT: HardwareTemplate = {
      id: `user-${Date.now()}`,
      name: activeDeviceName ?? "Mein MIDI-Setup",
      manufacturer: activeDeviceName ?? "User",
      category: "controller",
      description: `Exportiert am ${new Date().toLocaleString("de-DE")}`,
      ccMappings: currentCcMappings.map(({ label: _label, ...rest }) => rest),
      noteMappings: currentNoteMappings.map(({ label: _label, ...rest }) => rest),
    };
    const json = exportTemplateToJson(exportT);
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(activeDeviceName ?? "midi-template").replace(/[^\p{L}\p{N}\-_ ]/gu, "").replace(/\s+/g, "-") || "midi-template"}.synthtpl.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exportiert: ${a.download}`, { kind: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Export-Fehler: ${msg}`, { kind: "error" });
    }
  }

  // ─── Import JSON ─────────────────────────────────────────────────────────

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      const result = importTemplateFromJson(text);
      if (!result.ok) {
        setImportError(result.error);
        setImportPreview(null);
        return;
      }
      setImportError(null);
      setImportPreview(result.template);
      if (result.warnings && result.warnings.length > 0) {
        toast(`Import mit Warnings: ${result.warnings.join(" / ")}`, { kind: "warning", duration: 6000 });
      }
    };
    reader.onerror = () => {
      setImportError("Datei konnte nicht gelesen werden.");
      setImportPreview(null);
    };
    reader.readAsText(file);
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-2xl bg-bg-panel border border-border-color rounded-xl shadow-2xl flex flex-col"
        data-testid="templates-library"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden>📚</span>
            <h2 className="text-base font-semibold text-text-primary">
              MIDI-Templates Library
            </h2>
            <span className="text-[10px] text-text-dim ml-2">
              {HARDWARE_TEMPLATES.length} Hardware · {userTemplates.length} eigene
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text-primary"
            aria-label="Schliessen"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab-Bar */}
        <div className="flex border-b border-border-color px-3">
          {[
            { id: "hardware" as const, label: `Hardware (${HARDWARE_TEMPLATES.length})` },
            { id: "user" as const, label: `My Templates (${userTemplates.length})` },
            { id: "io" as const, label: "Import / Export" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "text-accent-primary border-accent-primary"
                  : "text-text-muted border-transparent hover:text-text-primary"
              }`}
              data-testid={`tpl-library-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 max-h-[60vh]">
          {/* Recently-Used Strip (alle Tabs) */}
          {recentTemplates.length > 0 && (
            <div className="mb-4 p-2 bg-bg-elevated/40 border border-border-subtle rounded">
              <div className="text-[10px] uppercase tracking-wider text-text-dim mb-1">
                Zuletzt verwendet
              </div>
              <div className="flex flex-wrap gap-1.5" data-testid="tpl-library-recent">
                {recentTemplates.map((r) => (
                  <span
                    key={r.id}
                    className="px-2 py-0.5 text-[11px] rounded bg-bg-elevated text-text-muted border border-border-subtle"
                    title={r.kind === "hardware" ? "Hardware-Template" : "User-Template"}
                  >
                    {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {activeTab === "hardware" && (
            <HardwareTab
              templates={visibleTemplates}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              onApply={applyHardwareTemplate}
            />
          )}
          {activeTab === "user" && (
            <UserTab
              userTemplates={userTemplates}
              currentCcCount={currentCcMappings.length}
              currentNoteCount={currentNoteMappings.length}
              saveName={saveName}
              setSaveName={setSaveName}
              onSaveCurrent={handleSaveCurrent}
              onApply={applyUserTemplate}
              activeDeviceName={activeDeviceName ?? undefined}
            />
          )}
          {activeTab === "io" && (
            <IoTab
              currentCcCount={currentCcMappings.length}
              currentNoteCount={currentNoteMappings.length}
              importError={importError}
              importPreview={importPreview}
              onExportCurrent={handleExportCurrent}
              onImportFile={handleImportFile}
              onConfirmImport={applyImported}
              onCancelImport={() => {
                setImportPreview(null);
                setImportError(null);
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-color flex items-center justify-between">
          <a
            href={COMMUNITY_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-text-dim hover:text-accent-primary"
          >
            Community-Templates: {COMMUNITY_REPO_URL}
          </a>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-bg-elevated hover:bg-bg-elevated/80 text-xs text-text-primary rounded"
          >
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Hardware Tab ───────────────────────────────────────────────────────────

interface HardwareTabProps {
  templates: HardwareTemplate[];
  categoryFilter: HardwareTemplateCategory | "all";
  setCategoryFilter: (c: HardwareTemplateCategory | "all") => void;
  onApply: (t: HardwareTemplate) => void;
}

function HardwareTab(props: HardwareTabProps): React.ReactElement {
  const { templates, categoryFilter, setCategoryFilter, onApply } = props;
  return (
    <div className="space-y-3">
      {/* Category Filter Chips */}
      <div className="flex flex-wrap gap-1.5" data-testid="tpl-library-category-chips">
        <CategoryChip
          active={categoryFilter === "all"}
          label={`Alle (${HARDWARE_TEMPLATES.length})`}
          onClick={() => setCategoryFilter("all")}
        />
        {ALL_CATEGORIES.map((cat) => {
          const count = HARDWARE_TEMPLATES.filter((t) => t.category === cat).length;
          return (
            <CategoryChip
              key={cat}
              active={categoryFilter === cat}
              label={`${CATEGORY_LABELS[cat]} (${count})`}
              onClick={() => setCategoryFilter(cat)}
            />
          );
        })}
      </div>

      {/* Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {templates.map((t) => (
          <div
            key={t.id}
            className="border border-border-color rounded-lg p-3 bg-bg-elevated/50 hover:border-accent-primary/40 transition-colors"
            data-testid={`tpl-library-hw-${t.id}`}
          >
            <div className="flex items-start gap-2">
              <span className="text-2xl flex-shrink-0" aria-hidden>
                {t.iconEmoji ?? "🎹"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-text-primary truncate">
                    {t.name}
                  </span>
                </div>
                <div className="text-[10px] text-text-dim mt-0.5">
                  {t.manufacturer} · {CATEGORY_LABELS[t.category]}
                </div>
                <p className="text-[11px] text-text-muted mt-1 leading-snug line-clamp-2">
                  {t.description}
                </p>
                <div className="flex gap-2 mt-2 text-[10px] text-text-dim">
                  <span>{t.ccMappings.length} CC</span>
                  <span>·</span>
                  <span>{t.noteMappings.length} Notes</span>
                </div>
                {t.tips && t.tips.length > 0 && (
                  <details className="mt-2 text-[11px]">
                    <summary className="text-text-dim cursor-pointer hover:text-accent-secondary">
                      Tipps ({t.tips.length})
                    </summary>
                    <ul className="mt-1 pl-3 list-disc space-y-0.5 text-text-muted">
                      {t.tips.map((tip, i) => (
                        <li key={i}>{tip}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Template „${t.name}" anwenden?\n\nDas ersetzt alle aktuellen Mappings.`,
                      )
                    ) {
                      onApply(t);
                    }
                  }}
                  className="mt-2 px-3 py-1 bg-accent-primary text-bg-base hover:bg-accent-primary/80 text-xs font-medium rounded"
                  data-testid={`tpl-library-apply-${t.id}`}
                >
                  Anwenden
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {templates.length === 0 && (
        <div className="text-center py-8 text-text-dim text-xs">
          Keine Templates in dieser Kategorie.
        </div>
      )}
    </div>
  );
}

function CategoryChip(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={props.onClick}
      className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
        props.active
          ? "bg-accent-primary text-bg-base"
          : "bg-bg-elevated text-text-muted hover:text-text-primary border border-border-subtle"
      }`}
    >
      {props.label}
    </button>
  );
}

// ─── User Tab ───────────────────────────────────────────────────────────────

interface UserTabProps {
  userTemplates: UserMidiTemplate[];
  currentCcCount: number;
  currentNoteCount: number;
  saveName: string;
  setSaveName: (v: string) => void;
  onSaveCurrent: () => void;
  onApply: (t: UserMidiTemplate) => void;
  activeDeviceName?: string;
}

function UserTab(props: UserTabProps): React.ReactElement {
  const {
    userTemplates,
    currentCcCount,
    currentNoteCount,
    saveName,
    setSaveName,
    onSaveCurrent,
    onApply,
    activeDeviceName,
  } = props;

  return (
    <div className="space-y-3">
      {/* Save Current */}
      <div className="border border-accent-secondary/30 rounded-lg p-3 bg-accent-secondary/10">
        <div className="text-xs font-medium text-accent-secondary mb-2 uppercase tracking-wider">
          Aktuelles Mapping speichern
        </div>
        <div className="text-xs text-text-dim mb-2">
          {currentCcCount} CC + {currentNoteCount} Notes als wiederverwendbares Template ablegen.
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={activeDeviceName ? `${activeDeviceName}-Setup` : "Mein MIDI-Setup"}
            className="flex-1 px-2 py-1.5 bg-bg-elevated border border-border-color rounded text-xs text-text-primary focus:outline-none focus:border-accent-secondary"
            data-testid="tpl-library-save-name"
          />
          <button
            onClick={onSaveCurrent}
            className="px-3 py-1.5 bg-accent-secondary text-bg-base hover:bg-accent-secondary/80 text-xs rounded font-medium"
            data-testid="tpl-library-save-btn"
          >
            Speichern
          </button>
        </div>
      </div>

      {/* User Templates List */}
      {userTemplates.length === 0 ? (
        <div className="text-center py-6 text-text-dim text-xs">
          Noch keine eigenen Templates. Speichere ein Mapping mit dem Formular oben.
        </div>
      ) : (
        <div className="space-y-1.5">
          {userTemplates.map((t) => (
            <div
              key={t.id}
              className="border border-accent-primary/40 rounded p-2 bg-accent-primary/5"
              data-testid={`tpl-library-user-${t.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary truncate">
                      {t.name}
                    </span>
                    <span className="text-[10px] text-text-dim flex-shrink-0">
                      {new Date(t.updatedAt).toLocaleString("de-DE", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  {t.deviceName && (
                    <div className="text-[10px] text-text-dim mt-0.5">{t.deviceName}</div>
                  )}
                  <div className="flex gap-3 text-[10px] text-text-dim mt-1">
                    <span>{t.ccMappings.length} CC</span>
                    <span>·</span>
                    <span>{t.noteMappings.length} Notes</span>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `Template "${t.name}" laden?\n\nDas ersetzt alle aktuellen Mappings.`,
                        )
                      ) {
                        onApply(t);
                      }
                    }}
                    className="px-2 py-1 text-xs rounded bg-accent-primary text-bg-base hover:bg-accent-primary/80"
                  >
                    Laden
                  </button>
                  <button
                    onClick={() => {
                      const newName = window.prompt("Neuer Name:", t.name);
                      if (newName && newName.trim().length > 0) {
                        renameUserMidiTemplate(t.id, newName);
                      }
                    }}
                    className="px-1.5 py-1 text-[10px] text-text-dim hover:text-text-primary"
                    title="Umbenennen"
                  >
                    Umbenennen
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Template "${t.name}" löschen?`)) {
                        deleteUserMidiTemplate(t.id);
                        toast(`Template „${t.name}" gelöscht`, { kind: "warning" });
                      }
                    }}
                    className="px-1.5 py-1 text-[10px] text-text-dim hover:text-accent-danger"
                    title="Löschen"
                  >
                    Löschen
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Import/Export Tab ──────────────────────────────────────────────────────

interface IoTabProps {
  currentCcCount: number;
  currentNoteCount: number;
  importError: string | null;
  importPreview: HardwareTemplate | null;
  onExportCurrent: () => void;
  onImportFile: (f: File) => void;
  onConfirmImport: (t: HardwareTemplate) => void;
  onCancelImport: () => void;
}

function IoTab(props: IoTabProps): React.ReactElement {
  const {
    currentCcCount,
    currentNoteCount,
    importError,
    importPreview,
    onExportCurrent,
    onImportFile,
    onConfirmImport,
    onCancelImport,
  } = props;
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-3">
      {/* Export */}
      <div className="border border-border-color rounded-lg p-3 bg-bg-elevated/50">
        <div className="text-xs font-medium text-text-primary mb-1 uppercase tracking-wider">
          Export
        </div>
        <p className="text-[11px] text-text-muted mb-2">
          Speichert dein aktuelles MIDI-Mapping als JSON-Datei zum Teilen.
        </p>
        <div className="text-[10px] text-text-dim mb-2">
          Aktuelles Mapping: {currentCcCount} CC + {currentNoteCount} Notes
        </div>
        <button
          onClick={onExportCurrent}
          disabled={currentCcCount === 0 && currentNoteCount === 0}
          className="px-3 py-1.5 bg-accent-primary text-bg-base hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed text-xs rounded font-medium"
          data-testid="tpl-library-export-btn"
        >
          Aktuelles Mapping exportieren
        </button>
      </div>

      {/* Import */}
      <div className="border border-border-color rounded-lg p-3 bg-bg-elevated/50">
        <div className="text-xs font-medium text-text-primary mb-1 uppercase tracking-wider">
          Import
        </div>
        <p className="text-[11px] text-text-muted mb-2">
          Lade eine Community-Template-Datei (`.synthtpl.json`). Datei wird
          validiert, du siehst eine Vorschau bevor das Template gespeichert wird.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = "";
          }}
          data-testid="tpl-library-import-input"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 bg-accent-secondary text-bg-base hover:bg-accent-secondary/80 text-xs rounded font-medium"
          data-testid="tpl-library-import-btn"
        >
          JSON-Datei wählen
        </button>
        {importError && (
          <div className="mt-2 p-2 bg-accent-danger/10 border border-accent-danger/30 rounded text-[11px] text-accent-danger">
            {importError}
          </div>
        )}
        {importPreview && (
          <div className="mt-3 p-2 bg-accent-success/10 border border-accent-success/30 rounded">
            <div className="text-xs font-semibold text-text-primary">
              Vorschau: {importPreview.name}
            </div>
            <div className="text-[10px] text-text-dim mt-0.5">
              {importPreview.manufacturer} · {CATEGORY_LABELS[importPreview.category]} ·
              {" "}
              {importPreview.ccMappings.length} CC + {importPreview.noteMappings.length} Notes
            </div>
            <p className="text-[11px] text-text-muted mt-1">{importPreview.description}</p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onConfirmImport(importPreview)}
                className="px-3 py-1 bg-accent-success text-bg-base hover:bg-accent-success/80 text-xs rounded"
                data-testid="tpl-library-import-confirm"
              >
                Speichern
              </button>
              <button
                onClick={onCancelImport}
                className="px-3 py-1 bg-bg-elevated hover:bg-bg-elevated/80 text-xs text-text-primary rounded"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Community Hint */}
      <div className="p-3 bg-bg-elevated/30 rounded text-[11px] text-text-muted">
        <div className="font-medium text-text-primary mb-1">Community-Templates</div>
        Teile deine Setups oder lade Mappings anderer User unter{" "}
        <a
          href={COMMUNITY_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-primary hover:underline"
        >
          {COMMUNITY_REPO_URL}
        </a>
        .
      </div>
    </div>
  );
}

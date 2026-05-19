/**
 * Synthstudio – SamplePackBrowser (v3.106.0)
 *
 * Splice-style lokaler Sample-Pack-Manager:
 *  - Sidebar: Packs-Liste + Tag-Filter + Category-Filter + BPM-Range + Search
 *  - Main: Sample-Liste (category-gruppiert) mit Hover-Preview + Drag-Handle
 *  - Drag-to-Pad: dataTransfer payload `application/x-synthstudio-pack-sample`
 *
 * Browser-Fallback: <input type="file" webkitdirectory> für Folder-Pick.
 * Electron-Pfad: openFolderDialog → spätere main-process scan-Logik (nicht in
 * dieser Version implementiert; UI prepared).
 */

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  useSamplePackStore,
  type SamplePackSample,
  type SamplePackFilter,
} from "@/store/useSamplePackStore";
import {
  SAMPLE_CATEGORIES,
  type SampleCategory,
} from "@/utils/sampleClassifier";
import {
  scanFolderForSamples,
  fileListToScanInputs,
} from "@/components/SamplePackBrowser/importLogic";
import {
  previewSample,
  getSharedPreviewContext,
  type PreviewHandle,
} from "@/utils/samplePackPreview";
import { PACK_SAMPLE_DRAG_MIME } from "@/components/SamplePackBrowser/dropPayload";

// Re-export für Backwards-Compat (alte Imports aus DrumMachine).
export { PACK_SAMPLE_DRAG_MIME };

// ─── Icons (text-only — bleibt theme-konform) ────────────────────────────────

const CATEGORY_ICONS: Record<SampleCategory, string> = {
  kick: "🥁",
  snare: "🥁",
  "hihat-closed": "🎩",
  "hihat-open": "🎩",
  clap: "👏",
  cymbal: "🔔",
  perc: "🪘",
  loop: "🔁",
  bass: "🎸",
  synth: "🎹",
  vocal: "🎤",
  fx: "✨",
  unknown: "❓",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SamplePackBrowser({ className = "" }: { className?: string }) {
  const store = useSamplePackStore();

  // Filter-State
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [category, setCategory] = useState<SampleCategory | "all">("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [bpmMin, setBpmMin] = useState<number | null>(null);
  const [bpmMax, setBpmMax] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  // Import
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // v3.108.0: Electron-Detection — präferiert nativen Folder-Dialog wenn verfügbar.
  const isElectron = useMemo(() => {
    if (typeof window === "undefined") return false;
    const api = (window as unknown as { electronAPI?: { packChooseFolder?: unknown } }).electronAPI;
    return !!(api && typeof api.packChooseFolder === "function");
  }, []);

  // Hover-Preview (v3.107.0: echte Audio-Vorschau via AudioContext)
  const previewHandleRef = useRef<PreviewHandle | null>(null);
  const previewTokenRef = useRef(0);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // ── Filter-Resultat ──
  const filter: SamplePackFilter = useMemo(() => ({
    packId: selectedPackId,
    category,
    tags: selectedTags,
    bpmMin,
    bpmMax,
    query,
  }), [selectedPackId, category, selectedTags, bpmMin, bpmMax, query]);

  const filteredSamples = useMemo(
    () => store.filterSamples(filter),
    [store, filter],
  );

  // ── Tag-Liste (top 30) ──
  const allTags = useMemo(() => store.getAllTags().slice(0, 30), [store]);

  // ── Gruppieren nach Kategorie ──
  const grouped = useMemo(() => {
    const map = new Map<SampleCategory, SamplePackSample[]>();
    for (const s of filteredSamples) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const ai = SAMPLE_CATEGORIES.indexOf(a[0]);
      const bi = SAMPLE_CATEGORIES.indexOf(b[0]);
      return ai - bi;
    });
  }, [filteredSamples]);

  // ── Import-Handler (Electron-Pfad, v3.108.0) ──
  //
  // Flow:
  //  1. packChooseFolder() → User wählt Ordner via OS-Dialog (oder Cancel).
  //  2. packRegisterRoot(absPath) — main fügt zur Allow-List hinzu.
  //  3. packScanFolder(absPath) — main scannt rekursiv (max 5000 files,
  //     max 4 depth, Audio-Whitelist, kein Symlink-Follow).
  //  4. scanFolderForSamples(scan.files) → klassifiziert + extrahiert Tags+BPM.
  //  5. store.addPack(name, root, scanned, { absolutePaths }) — absolutePath
  //     pro Sample persistiert in localStorage.
  const handleElectronImport = useCallback(async () => {
    if (typeof window === "undefined") return;
    const api = (window as unknown as {
      electronAPI?: {
        packChooseFolder?: () => Promise<{ canceled: boolean; filePaths: string[] }>;
        packRegisterRoot?: (p: string) => Promise<{ success: boolean; root?: string; error?: string }>;
        packScanFolder?: (p: string) => Promise<{
          success: boolean;
          root?: string;
          files?: Array<{ relPath: string; absolutePath: string; sizeBytes: number }>;
          truncated?: boolean;
          error?: string;
        }>;
      };
    }).electronAPI;
    if (!api || !api.packChooseFolder || !api.packRegisterRoot || !api.packScanFolder) {
      setImportError("Electron-API nicht verfügbar.");
      return;
    }
    setImportBusy(true);
    setImportError(null);
    try {
      const pick = await api.packChooseFolder();
      if (pick.canceled || pick.filePaths.length === 0) {
        return;
      }
      const absRoot = pick.filePaths[0];
      const reg = await api.packRegisterRoot(absRoot);
      if (!reg.success || !reg.root) {
        setImportError(reg.error ?? "Root konnte nicht registriert werden.");
        return;
      }
      const scan = await api.packScanFolder(reg.root);
      if (!scan.success || !scan.files) {
        setImportError(scan.error ?? "Scan fehlgeschlagen.");
        return;
      }
      // ScanInput[] aus IPC-Files bauen.
      const inputs = scan.files.map((f) => ({ relPath: f.relPath, sizeBytes: f.sizeBytes }));
      const scanned = scanFolderForSamples(inputs);
      if (scanned.length === 0) {
        setImportError("Keine Audio-Dateien gefunden.");
        return;
      }
      // absolutePath pro scanned.id zuordnen via relPath-Match.
      const absByRelPath = new Map<string, string>();
      for (const f of scan.files) absByRelPath.set(f.relPath, f.absolutePath);
      const absolutePaths = new Map<string, string>();
      for (const s of scanned) {
        const abs = absByRelPath.get(s.relPath);
        if (abs) absolutePaths.set(s.id, abs);
      }
      // Pack-Name: letztes Segment des absoluten Pfads.
      const segs = reg.root.split(/[/\\]/).filter((p) => p.length > 0);
      const name = segs.length > 0 ? segs[segs.length - 1] : "Pack";
      store.addPack(name, reg.root, scanned, { absolutePaths });
      if (scan.truncated) {
        setImportError("Pack-Limit erreicht — nur die ersten 5000 Dateien wurden importiert.");
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  }, [store]);

  // ── Import-Handler (Browser-Fallback) ──
  const handleFolderInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const filesArr = Array.from(files);
      const inputs = fileListToScanInputs(filesArr);
      const scanned = scanFolderForSamples(inputs);
      if (scanned.length === 0) {
        setImportError("Keine Audio-Dateien gefunden.");
        return;
      }
      // Pack-Name: erstes Verzeichnis-Segment vom relativen Pfad
      const first = filesArr[0] as unknown as { webkitRelativePath?: string };
      const rootPath = first.webkitRelativePath?.split(/[/\\]/)[0] ?? "Pack";
      // v3.107.0: Browser-Memory File-Handles via relPath → scanned.id matchen,
      // damit getSampleData() später blob-bytes ausliefern kann.
      const fileHandles = new Map<string, File>();
      const byRelPath = new Map<string, File>();
      for (const f of filesArr) {
        const rel = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
        byRelPath.set(rel, f);
      }
      for (const s of scanned) {
        const file = byRelPath.get(s.relPath);
        if (file) fileHandles.set(s.id, file);
      }
      store.addPack(rootPath, rootPath, scanned, { fileHandles });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }, [store]);

  // ── Hover-Preview (v3.107.0 — echte Audio-Vorschau) ──
  const stopActivePreview = useCallback(() => {
    if (previewHandleRef.current) {
      try { previewHandleRef.current.stop(); } catch { /* ignore */ }
      previewHandleRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback((sample: SamplePackSample) => {
    setPreviewId(sample.id);
    // Vorherige Preview cancellen.
    stopActivePreview();
    const token = ++previewTokenRef.current;
    void (async () => {
      const data = await store.getSampleData(sample.id);
      if (!data) return; // kein Handle/Pfad → silent.
      const ctx = getSharedPreviewContext();
      if (!ctx) return;
      // Wenn währenddessen ein neuer Hover startete, abbrechen.
      if (previewTokenRef.current !== token) return;
      // AudioContext braucht User-Gesture — resume() ist no-op wenn schon running.
      try { await ctx.resume(); } catch { /* ignore */ }
      if (previewTokenRef.current !== token) return;
      const handle = await previewSample(data, ctx, { durationMs: 1500, gain: 0.7 });
      // Neue Preview während decode gestartet? → diese sofort stoppen.
      if (previewTokenRef.current !== token) {
        handle.stop();
        return;
      }
      previewHandleRef.current = handle;
    })();
  }, [store, stopActivePreview]);

  const handleMouseLeave = useCallback(() => {
    setPreviewId(null);
    previewTokenRef.current++;
    stopActivePreview();
  }, [stopActivePreview]);

  // Cleanup Audio on unmount
  useEffect(() => {
    return () => {
      previewTokenRef.current++;
      stopActivePreview();
    };
  }, [stopActivePreview]);

  // ── Drag-Start ──
  const handleDragStart = useCallback((e: React.DragEvent, sample: SamplePackSample) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(PACK_SAMPLE_DRAG_MIME, JSON.stringify({
      sampleId: sample.id,
      packId: sample.packId,
      filename: sample.filename,
      relPath: sample.relPath,
    }));
    e.dataTransfer.setData("text/plain", sample.filename);
  }, []);

  // ── Tag-Toggle ──
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  // ── Stats ──
  const totalSamples = useMemo(() => store.getAllSamples().length, [store]);

  return (
    <div
      className={`flex h-full bg-bg-base text-text-primary ${className}`}
      data-testid="sample-pack-browser"
    >
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 border-r border-border-color bg-bg-panel flex flex-col overflow-hidden">
        {/* Import-Button */}
        <div className="p-3 border-b border-border-color flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              // v3.108.0: Electron → nativer Folder-Dialog + main-scan,
              //           Browser → webkitdirectory File-Input-Fallback.
              if (isElectron) {
                void handleElectronImport();
              } else {
                folderInputRef.current?.click();
              }
            }}
            disabled={importBusy}
            data-testid="pack-import-folder"
            className="w-full px-3 py-2 text-xs font-medium rounded bg-accent-primary/20 border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-50 disabled:cursor-wait"
          >
            {importBusy ? "Importiere..." : "📁 Ordner importieren"}
          </button>
          <input
            ref={folderInputRef}
            type="file"
            // webkitdirectory ist nicht im React-TS-Typing — wir nutzen any-cast unten
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            multiple
            onChange={handleFolderInput}
            className="hidden"
            data-testid="pack-folder-input"
          />
          {importError && (
            <p className="mt-2 text-[10px] text-accent-danger" role="alert">
              {importError}
            </p>
          )}
        </div>

        {/* Packs-Liste */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-dim border-b border-border-subtle">
            Packs ({store.packs.length})
          </div>
          <button
            type="button"
            onClick={() => setSelectedPackId(null)}
            data-testid="pack-select-all"
            className={[
              "w-full text-left px-3 py-2 text-xs border-l-2",
              selectedPackId === null
                ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                : "border-transparent text-text-muted hover:bg-bg-elevated",
            ].join(" ")}
          >
            🗂 Alle Packs <span className="text-text-dim">({totalSamples})</span>
          </button>
          {store.packs.map((p) => (
            <div key={p.id} className="flex items-center group">
              <button
                type="button"
                onClick={() => setSelectedPackId(p.id)}
                data-testid={`pack-select-${p.id}`}
                className={[
                  "flex-1 text-left px-3 py-2 text-xs border-l-2 truncate",
                  selectedPackId === p.id
                    ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                    : "border-transparent text-text-muted hover:bg-bg-elevated",
                ].join(" ")}
                title={p.rootPath}
              >
                {p.name} <span className="text-text-dim">({p.samples.length})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Pack "${p.name}" entfernen?`)) {
                    store.removePack(p.id);
                    if (selectedPackId === p.id) setSelectedPackId(null);
                  }
                }}
                data-testid={`pack-remove-${p.id}`}
                className="opacity-0 group-hover:opacity-100 px-2 text-text-dim hover:text-accent-danger"
                title="Pack entfernen"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Filter-Bereich */}
        <div className="border-t border-border-color px-3 py-2 flex-shrink-0 overflow-y-auto" style={{ maxHeight: "50%" }}>
          {/* Search */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suche..."
            data-testid="pack-search"
            className="w-full px-2 py-1 text-xs bg-bg-elevated border border-border-color rounded text-text-primary placeholder:text-text-dim mb-2"
          />

          {/* Category */}
          <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1">
            Kategorie
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as SampleCategory | "all")}
            data-testid="pack-filter-category"
            className="w-full px-2 py-1 text-xs bg-bg-elevated border border-border-color rounded text-text-primary mb-2"
          >
            <option value="all">Alle</option>
            {SAMPLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* BPM-Range */}
          <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1">
            BPM: {bpmMin ?? "—"} bis {bpmMax ?? "—"}
          </label>
          <div className="flex gap-1 mb-2">
            <input
              type="number"
              min={40}
              max={300}
              value={bpmMin ?? ""}
              onChange={(e) => setBpmMin(e.target.value ? parseInt(e.target.value, 10) : null)}
              placeholder="min"
              data-testid="pack-filter-bpm-min"
              className="w-full px-2 py-1 text-xs bg-bg-elevated border border-border-color rounded text-text-primary placeholder:text-text-dim"
            />
            <input
              type="number"
              min={40}
              max={300}
              value={bpmMax ?? ""}
              onChange={(e) => setBpmMax(e.target.value ? parseInt(e.target.value, 10) : null)}
              placeholder="max"
              data-testid="pack-filter-bpm-max"
              className="w-full px-2 py-1 text-xs bg-bg-elevated border border-border-color rounded text-text-primary placeholder:text-text-dim"
            />
          </div>

          {/* Tags */}
          <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1">
            Tags ({selectedTags.length} aktiv)
          </label>
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  data-testid={`pack-filter-tag-${tag}`}
                  className={[
                    "px-2 py-0.5 text-[10px] rounded border",
                    active
                      ? "bg-accent-primary/30 border-accent-primary text-accent-primary"
                      : "bg-bg-elevated border-border-color text-text-muted hover:border-accent-primary",
                  ].join(" ")}
                >
                  {tag}
                </button>
              );
            })}
            {allTags.length === 0 && (
              <span className="text-[10px] text-text-dim italic">
                Keine Tags — Pack importieren
              </span>
            )}
          </div>
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              data-testid="pack-filter-tags-clear"
              className="mt-2 text-[10px] text-text-dim hover:text-accent-primary"
            >
              Tags zurücksetzen
            </button>
          )}
        </div>
      </aside>

      {/* ── Main: Sample-Liste ───────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">
            Sample-Pack-Browser
          </h2>
          <span className="text-xs text-text-dim" data-testid="pack-results-count">
            {filteredSamples.length} Samples
          </span>
        </div>

        {filteredSamples.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-dim text-sm">
            {store.packs.length === 0
              ? "Noch keine Packs importiert — Sidebar → „Ordner importieren\""
              : "Keine Samples entsprechen den Filtern."}
          </div>
        )}

        {grouped.map(([cat, samples]) => (
          <section key={cat} className="mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
              {CATEGORY_ICONS[cat]} {cat} <span className="text-text-dim">({samples.length})</span>
            </h3>
            <ul className="space-y-0.5">
              {samples.map((s) => (
                <li
                  key={s.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, s)}
                  onMouseEnter={() => handleMouseEnter(s)}
                  onMouseLeave={handleMouseLeave}
                  data-testid={`pack-sample-${s.id}`}
                  className={[
                    "group flex items-center gap-2 px-2 py-1.5 rounded text-xs",
                    "bg-bg-panel border border-border-subtle hover:border-accent-primary cursor-grab active:cursor-grabbing",
                    previewId === s.id ? "ring-1 ring-accent-secondary" : "",
                  ].join(" ")}
                >
                  <span className="text-text-dim flex-shrink-0" title="Drag&Drop auf Pad">☰</span>
                  <span className="flex-shrink-0">{CATEGORY_ICONS[s.category]}</span>
                  <span className="flex-1 truncate text-text-primary" title={s.relPath}>
                    {s.filename}
                  </span>
                  {s.bpm !== null && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-accent-secondary/20 text-accent-secondary font-mono">
                      {s.bpm} BPM
                    </span>
                  )}
                  {s.tags.length > 0 && (
                    <span className="flex-shrink-0 hidden sm:flex gap-1">
                      {s.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="px-1 py-0.5 text-[9px] rounded bg-bg-elevated text-text-muted"
                        >
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                  {s.duration !== null && (
                    <span className="flex-shrink-0 text-[10px] text-text-dim font-mono">
                      {s.duration.toFixed(2)}s
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

      </main>
    </div>
  );
}

export default SamplePackBrowser;

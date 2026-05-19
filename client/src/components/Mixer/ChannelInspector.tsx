/**
 * Synthstudio – ChannelInspector
 *
 * Per-Kanal-Inspector mit Insert FX Chain, 16-Band-EQ, Sidechain-Compressor und
 * Transient Shaper. Aus `MixerView.tsx` extrahiert (post-v1.34.0) damit der
 * Inspector unabhängig vom Mixer in der Main-Oberfläche bleibt — speziell wenn
 * der Mixer als Popup-Fenster abgepinnt ist.
 *
 * Props:
 *  - `part`: aktuell selektierter Kanal (oder undefined wenn keiner gewählt)
 *  - `parts`: alle Kanäle (für Sidechain-Quellen-Picker)
 *  - `mixer`: MixerStore + Actions
 *  - `className`: optional override (default `w-80 shrink-0`)
 */
import React, { useState, useCallback } from "react";
import type { PartData, PatternData } from "@/audio/AudioEngine";
import type { MixerState, MixerActions } from "@/store/useMixerStore";
import { MIXER_FX_TYPES, summarizeEqBands, type MixerFxType } from "@/utils/mixerFx";
// v3.44.0 (TASK-239 Phase 1) / v3.45.0 Multi-Slot Chain: Plugin-Slot UI
import {
  getPlugins as getRegisteredPlugins,
  getPlugin as getPluginManifest,
  getDefaultParams as getPluginDefaultParams,
  clampPluginParam,
} from "@/audio/PluginRegistry";
import { MAX_PLUGIN_SLOTS_PER_CHANNEL, type MixerPluginSlot } from "@/store/useMixerStore";
// v3.46: Plugin-Chain Preset Save/Load (schließt v3.45 Caveat 4)
// v3.47: + JSON-Sharing Export/Import (closes v3.46-Caveat)
import {
  usePluginChainPresetStore,
  addPluginChainPreset,
  removePluginChainPreset,
  cloneSlotsFromPreset,
  exportPresetAsJson,
  exportAllPresetsAsJson,
  importPresetFromJson,
} from "@/store/usePluginChainPresetStore";
import { extractPatch, type Patch } from "@/utils/patchSerialize";
import { savePatch, usePatchStore } from "@/store/usePatchStore";
import { toast } from "@/store/useToastStore";
import { useMidiContext } from "@/context/MidiContext";
import {
  useMidiNoteOutStore,
  setMidiNoteOutEnabled,
  setPartMidiOutConfig,
  clearPartMidiOutConfig,
  applyElectribeDrumMap,
} from "@/store/useMidiNoteOutStore";
import {
  noteNameFromNumber,
  DEFAULT_NOTE_DURATION_MS,
} from "@/audio/MidiNoteOut";
import { ELECTRIBE_2_DRUM_MAP } from "@/utils/midiTemplates";
import {
  bounceChannelToBuffer,
  computeBounceDurationSec,
  defaultStemFilename,
  resolveBounceBars,
  BOUNCE_WARN_DURATION_SEC,
  downloadAudioInBrowser,
  type BounceLengthMode,
  type BounceFormat,
} from "@/utils/channelBounce";
import {
  SUPPORTED_OGG_BITRATES_BPS,
  DEFAULT_OGG_BITRATE_BPS,
} from "@/utils/audioCompressEncoder";
import { useElectron } from "../../../../electron/useElectron";
import { useConfirm } from "@/components/common/ConfirmDialog";

export interface ChannelInspectorProps {
  part: PartData | undefined;
  parts: PartData[];
  mixer: MixerState & MixerActions;
  className?: string;
  /**
   * Optional: aktiviert "Apply Patch"-UI im Inspector (v2.21). Wenn nicht
   * gesetzt, bleibt nur Save-Patch ohne Apply-Loop (back-compat zu v2.20).
   */
  onApplyPatch?: (partId: string, patch: Patch, options?: { replaceFx?: boolean }) => void;
  /**
   * TASK-241 / v2.94.0: Per-Channel WAV-Bounce (Stem-Export).
   * Wenn `pattern` UND `bpm` gesetzt, erscheint die "Bounce to WAV"-Section.
   * Ohne diese Props bleibt das Feature ausgeblendet (back-compat zu v2.93).
   */
  pattern?: PatternData;
  bpm?: number;
  projectName?: string;
}

// v3.47.0: Hilfsfunktionen für JSON-Preset-Download (Plugin-Chain).
// Liegen außerhalb der React-Komponente damit sie auch in Tests testbar sind
// (siehe tests/features/plugin-preset-share.test.ts — UI-Code wird dort nicht
// importiert, nur die Pure-Helpers).
function downloadPluginPresetJson(json: string, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke etwas später damit Safari den Download starten kann.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error("[ChannelInspector] Preset-Download-Fehler:", err);
  }
}

function sanitizePresetFilename(presetId: string, json: string): string {
  // Versuche den Namen aus dem Envelope zu extrahieren — fallback auf ID.
  try {
    const parsed = JSON.parse(json) as { preset?: { name?: string } };
    const name = parsed?.preset?.name;
    if (typeof name === "string" && name.trim().length > 0) {
      const cleaned = name
        .trim()
        .replace(/[^a-z0-9-_]+/gi, "_")
        .slice(0, 60);
      return `${cleaned}.synthpreset.json`;
    }
  } catch {
    /* ignore — fallback below */
  }
  const safe = presetId.replace(/[^a-z0-9-_.]/gi, "_");
  return `${safe}.synthpreset.json`;
}

export function ChannelInspector({ part, parts, mixer, className, onApplyPatch, pattern, bpm, projectName }: ChannelInspectorProps) {
  const baseClass = className ?? "w-80 shrink-0";
  // Save-Patch-Affordance (v2.20): Inline-Form damit der Name in einem
  // schmalen Inspector-Strip ohne Modal eingegeben werden kann.
  const [savePatchOpen, setSavePatchOpen] = useState(false);
  const [patchName, setPatchName] = useState("");
  const [patchIncludeFx, setPatchIncludeFx] = useState(true);
  // Apply-Patch (v2.21): kollapsible Library-Liste mit Apply-Buttons.
  const [applyPatchOpen, setApplyPatchOpen] = useState(false);
  const [applyReplaceFx, setApplyReplaceFx] = useState(true);
  const { patches } = usePatchStore();
  // v2.33: Suche/Filter im Apply-Dropdown (gleiche Library, ≤200 Patches).
  const [applyQuery, setApplyQuery] = useState("");
  const filteredApplyPatches = React.useMemo(() => {
    const q = applyQuery.trim().toLowerCase();
    if (!q) return patches;
    return patches.filter(p => {
      if (p.name.toLowerCase().includes(q)) return true;
      if ((p.sourceType ?? "").toLowerCase().includes(q)) return true;
      if (p.tags?.some(t => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [patches, applyQuery]);

  if (!part) {
    return (
      <aside className={`${baseClass} border-l border-border-color bg-bg-panel p-4 text-xs text-text-dim`}>
        Kanal im Mixer auswählen
      </aside>
    );
  }

  const chain = mixer.insertChains[part.id] ?? [];
  const eqBands = mixer.eq16[part.id] ?? [];
  const eqSummary = summarizeEqBands(eqBands);
  const sidechain = mixer.sidechains[part.id];
  const transient = mixer.transientShapers[part.id];

  const openSavePatch = () => {
    setPatchName(part.name);
    setPatchIncludeFx(true);
    setSavePatchOpen(true);
    setApplyPatchOpen(false);
  };
  const commitSavePatch = () => {
    const name = patchName.trim() || part.name;
    const patch = extractPatch(part, name, { includeFx: patchIncludeFx });
    savePatch(patch);
    toast(`Patch „${patch.name}" gespeichert`, { kind: "success" });
    setSavePatchOpen(false);
  };
  const handleApplyPatch = (patch: Patch) => {
    if (!onApplyPatch) return;
    onApplyPatch(part.id, patch, { replaceFx: applyReplaceFx });
    toast(`Patch „${patch.name}" auf ${part.name} angewendet`, { kind: "success" });
    setApplyPatchOpen(false);
  };

  const sourceTypeLabel = (t?: string): string => {
    switch (t) {
      case "wavetable": return "Wavetable";
      case "fm":        return "FM";
      case "granular":  return "Granular";
      case "sample":    return "Sample";
      default:          return "—";
    }
  };

  return (
    <aside className={`${baseClass} border-l border-border-color bg-bg-panel overflow-y-auto`}>
      <div className="sticky top-0 z-10 border-b border-border-color bg-bg-panel px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-text-dim">Channel Inspector</div>
            <div className="truncate text-sm font-semibold text-text-primary">{part.name}</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onApplyPatch && patches.length > 0 && (
              <button
                type="button"
                onClick={() => { setApplyPatchOpen(o => !o); setSavePatchOpen(false); }}
                className={`px-2 py-1 text-[10px] rounded border ${
                  applyPatchOpen
                    ? "border-accent-primary text-accent-primary"
                    : "border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary"
                }`}
                title={`Patch aus Library (${patches.length}) auf diesen Kanal anwenden`}
                data-testid="channel-apply-patch"
              >
                📂 Apply ({patches.length})
              </button>
            )}
            <button
              type="button"
              onClick={openSavePatch}
              className="px-2 py-1 text-[10px] rounded border border-border-color text-text-muted hover:text-accent-secondary hover:border-accent-secondary"
              title="Aktuellen Sound als Patch in die Library speichern"
              data-testid="channel-save-patch"
            >
              💾 Save Patch
            </button>
          </div>
        </div>
        {applyPatchOpen && onApplyPatch && (
          <div className="mt-2 p-2 rounded border border-accent-primary/60 bg-accent-primary/10" data-testid="channel-apply-patch-list">
            <label className="flex items-center gap-2 text-[10px] text-text-muted cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={applyReplaceFx}
                onChange={e => setApplyReplaceFx(e.target.checked)}
                className="accent-accent-primary"
              />
              FX-Chain ersetzen (sonst nur Sound)
            </label>
            <input
              type="text"
              value={applyQuery}
              onChange={e => setApplyQuery(e.target.value)}
              placeholder="Filter…"
              className="w-full mb-2 text-[10px] bg-bg-base border border-border-color rounded px-2 py-1 text-text-primary placeholder:text-text-dim"
              data-testid="channel-apply-patch-search"
            />
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredApplyPatches.length === 0 && (
                <div className="text-center text-[10px] text-text-dim py-2">
                  Kein Patch matcht „{applyQuery}".
                </div>
              )}
              {filteredApplyPatches.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleApplyPatch(p)}
                  className="w-full text-left px-2 py-1 rounded bg-bg-base/50 hover:bg-accent-primary/20 border border-transparent hover:border-accent-primary/50"
                  data-testid={`channel-apply-patch-${p.id}`}
                  title={`${sourceTypeLabel(p.sourceType)}${p.fx ? " +FX" : ""} — ${new Date(p.createdAt).toLocaleString()}`}
                >
                  <div className="text-xs text-text-primary truncate">{p.name}</div>
                  <div className="text-[9px] text-text-dim">
                    {sourceTypeLabel(p.sourceType)}{p.fx ? " · +FX" : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {savePatchOpen && (
          <div className="mt-2 p-2 rounded border border-accent-secondary/60 bg-accent-secondary/10 space-y-2" data-testid="channel-save-patch-form">
            <input
              type="text"
              autoFocus
              value={patchName}
              onChange={e => setPatchName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") commitSavePatch();
                if (e.key === "Escape") setSavePatchOpen(false);
              }}
              placeholder="Patch-Name"
              className="w-full bg-bg-base text-text-primary text-xs px-2 py-1 rounded border border-border-color"
              data-testid="channel-save-patch-name"
            />
            <label className="flex items-center gap-2 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={patchIncludeFx}
                onChange={e => setPatchIncludeFx(e.target.checked)}
                className="accent-accent-secondary"
              />
              FX-Chain mit speichern
            </label>
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setSavePatchOpen(false)}
                className="px-2 py-1 text-[10px] rounded text-text-muted hover:text-text-primary"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={commitSavePatch}
                className="px-2 py-1 text-[10px] rounded bg-accent-secondary text-bg-base hover:bg-accent-secondary/80"
                data-testid="channel-save-patch-commit"
              >
                Speichern
              </button>
            </div>
          </div>
        )}
      </div>

      <section className="border-b border-border-color p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Insert FX Chain</span>
          <select
            aria-label="Insert FX hinzufügen"
            value=""
            onChange={e => {
              if (!e.target.value) return;
              mixer.addInsertFx(part.id, e.target.value as MixerFxType);
              e.target.value = "";
            }}
            className="rounded bg-bg-panel px-2 py-1 text-[10px] text-text-primary border border-border-color"
          >
            <option value="">Add FX</option>
            {MIXER_FX_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          {chain.length === 0 && (
            <div className="rounded border border-dashed border-border-color px-2 py-3 text-center text-[10px] text-text-dim">
              Keine Inserts
            </div>
          )}
          {chain.map((slot, index) => (
            <div
              key={slot.id}
              className={[
                "flex items-center gap-1 rounded border px-2 py-1.5",
                slot.enabled ? "border-border-color bg-bg-panel/70" : "border-border-color bg-bg-base text-text-dim",
              ].join(" ")}
            >
              <button
                type="button"
                title="Bypass"
                onClick={() => mixer.toggleInsertFx(part.id, slot.id)}
                className={slot.enabled ? "text-[10px] text-accent-secondary" : "text-[10px] text-text-dim"}
              >
                ON
              </button>
              <span className="min-w-0 flex-1 truncate text-[11px] text-text-primary">{slot.name}</span>
              <button type="button" title="Nach oben" onClick={() => mixer.moveInsertFx(part.id, index, index - 1)} className="text-[10px] text-text-dim hover:text-text-primary">Up</button>
              <button type="button" title="Nach unten" onClick={() => mixer.moveInsertFx(part.id, index, index + 1)} className="text-[10px] text-text-dim hover:text-text-primary">Dn</button>
              <button type="button" title="Entfernen" onClick={() => mixer.removeInsertFx(part.id, slot.id)} className="text-[10px] text-accent-danger hover:text-accent-danger/80">X</button>
            </div>
          ))}
        </div>
      </section>

      {/* v3.45.0: AudioWorklet-Plugin-Chain (max 4 Slots, seriell) */}
      {/* v3.46.0: + Save/Load Preset (closes v3.45 Caveat 4) */}
      <PluginChainSection
        partId={part.id}
        slots={mixer.pluginSlots[part.id] ?? []}
        onAddSlot={(pluginId) => {
          const manifest = getPluginManifest(pluginId);
          if (!manifest) return;
          mixer.addPluginSlot(part.id, {
            pluginId,
            params: getPluginDefaultParams(manifest),
            bypassed: false,
          });
        }}
        onRemoveSlot={(index) => mixer.removePluginSlot(part.id, index)}
        onMoveSlot={(from, to) => mixer.movePluginSlot(part.id, from, to)}
        onChangePlugin={(index, pluginId) => {
          const manifest = getPluginManifest(pluginId);
          if (!manifest) return;
          mixer.setPluginSlotPlugin(part.id, index, {
            pluginId,
            params: getPluginDefaultParams(manifest),
            bypassed: false,
          });
        }}
        onChangeParam={(index, paramId, value) => {
          mixer.setPluginSlotParam(part.id, index, paramId, value);
        }}
        onToggleBypass={(index) => {
          const slots = mixer.pluginSlots[part.id] ?? [];
          const slot = slots[index];
          if (!slot) return;
          mixer.setPluginSlotBypassed(part.id, index, !slot.bypassed);
        }}
        onApplyPreset={(presetId) => {
          const slotsToApply = cloneSlotsFromPreset(presetId);
          if (!slotsToApply) return;
          // Replace-Strategie: erst aktuelle Chain leeren, dann Preset
          // anhängen. Wir nutzen movePluginSlot/removePluginSlot weil das
          // bestehende Multi-Slot-Diff-Sync sauber bleibt.
          const current = mixer.pluginSlots[part.id] ?? [];
          for (let i = current.length - 1; i >= 0; i--) {
            mixer.removePluginSlot(part.id, i);
          }
          for (const slot of slotsToApply) {
            mixer.addPluginSlot(part.id, slot);
          }
          toast(`Plugin-Chain-Preset angewendet (${slotsToApply.length} Slots)`, { kind: "success" });
        }}
        onSavePreset={(name) => {
          const slots = mixer.pluginSlots[part.id] ?? [];
          if (slots.length === 0) {
            toast("Chain ist leer — kein Preset zum Speichern", { kind: "info" });
            return false;
          }
          const id = addPluginChainPreset(name, slots);
          if (id) {
            toast(`Plugin-Chain-Preset „${name}" gespeichert`, { kind: "success" });
            return true;
          }
          toast("Preset konnte nicht gespeichert werden", { kind: "error" });
          return false;
        }}
        onRemovePreset={(id) => {
          if (removePluginChainPreset(id)) {
            toast("Preset entfernt", { kind: "success" });
          }
        }}
        onExportPreset={(id) => {
          // v3.47: Single-Preset JSON-Download
          const json = exportPresetAsJson(id);
          if (!json) {
            toast("Preset nicht gefunden", { kind: "error" });
            return;
          }
          downloadPluginPresetJson(json, sanitizePresetFilename(id, json));
          toast("Preset exportiert", { kind: "success" });
        }}
        onExportAllPresets={() => {
          // v3.47: Bulk-Export aller Presets
          const json = exportAllPresetsAsJson();
          downloadPluginPresetJson(
            json,
            `synthstudio-plugin-presets-${new Date().toISOString().slice(0, 10)}.synthpreset.json`,
          );
          toast("Alle Presets exportiert", { kind: "success" });
        }}
        onImportPresets={(file) => {
          // v3.47: JSON-Import via File-Picker
          void file.text().then((text) => {
            const result = importPresetFromJson(text);
            if (result.success) {
              const count = result.importedIds.length;
              const skipped = result.duplicatesSkipped > 0
                ? ` (${result.duplicatesSkipped} Duplikat${result.duplicatesSkipped === 1 ? "" : "e"} übersprungen)`
                : "";
              toast(`${count} Preset${count === 1 ? "" : "s"} importiert${skipped}`, {
                kind: "success",
              });
              // Warnings (z.B. Missing Plugin) als info-toast nachreichen
              for (const w of result.warnings.slice(0, 3)) {
                toast(w, { kind: "info" });
              }
            } else {
              const firstError = result.errors[0] ?? "Import fehlgeschlagen";
              toast(firstError, { kind: "error" });
            }
          }).catch((err) => {
            console.error("[ChannelInspector] Preset-Import-Fehler:", err);
            toast("Datei konnte nicht gelesen werden", { kind: "error" });
          });
        }}
      />

      <section className="border-b border-border-color p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Parametric EQ 16</span>
          <button
            type="button"
            onClick={() => mixer.resetEqBands(part.id)}
            className="rounded bg-bg-elevated px-2 py-1 text-[10px] text-text-muted hover:text-text-primary"
          >
            Reset
          </button>
        </div>
        <div className="flex h-24 items-end gap-1">
          {eqBands.map((band, index) => (
            <div key={band.frequency} className="flex flex-1 flex-col items-center gap-1">
              <input
                aria-label={`EQ Band ${band.frequency} Hz`}
                type="range"
                min={-24}
                max={24}
                step={0.5}
                value={band.gain}
                onChange={e => mixer.setEqBandGain(part.id, index, parseFloat(e.target.value))}
                className="h-16 w-2 accent-accent-primary"
                style={{ writingMode: "vertical-lr", direction: "rtl", appearance: "slider-vertical" as React.CSSProperties["appearance"] }}
                title={`${band.frequency} Hz: ${band.gain.toFixed(1)} dB`}
              />
              <span className="text-[7px] text-text-dim">{index + 1}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[9px] text-text-dim">
          <span>Low {eqSummary.low.toFixed(1)} dB</span>
          <span>Mid {eqSummary.mid.toFixed(1)} dB</span>
          <span>High {eqSummary.high.toFixed(1)} dB</span>
        </div>
      </section>

      <section className="border-b border-border-color p-3">
        <label className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
          <input
            type="checkbox"
            checked={sidechain?.enabled ?? false}
            onChange={e => mixer.setSidechain(part.id, { enabled: e.target.checked })}
            className="accent-accent-primary"
          />
          Sidechain Compressor
        </label>
        <select
          aria-label="Sidechain Quelle"
          value={sidechain?.sourcePartId ?? ""}
          onChange={e => mixer.setSidechain(part.id, { sourcePartId: e.target.value || null })}
          className="mb-2 w-full rounded border border-border-color bg-bg-panel px-2 py-1 text-xs text-text-primary"
        >
          <option value="">Quelle wählen</option>
          {parts.filter(p => p.id !== part.id).map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <ControlRow label="Amount" value={sidechain?.amount ?? 0.5} min={0} max={1} step={0.01} onChange={v => mixer.setSidechain(part.id, { amount: v })} />
        <ControlRow label="Attack" value={sidechain?.attack ?? 0.01} min={0.001} max={1} step={0.001} onChange={v => mixer.setSidechain(part.id, { attack: v })} />
        <ControlRow label="Release" value={sidechain?.release ?? 0.18} min={0.01} max={2} step={0.01} onChange={v => mixer.setSidechain(part.id, { release: v })} />
      </section>

      <section className="border-b border-border-color p-3">
        <label className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
          <input
            type="checkbox"
            checked={transient?.enabled ?? false}
            onChange={e => mixer.setTransientShaper(part.id, { enabled: e.target.checked })}
            className="accent-accent-primary"
          />
          Transient Shaper
        </label>
        <ControlRow label="Attack" value={transient?.attack ?? 0} min={-1} max={1} step={0.01} onChange={v => mixer.setTransientShaper(part.id, { attack: v })} />
        <ControlRow label="Sustain" value={transient?.sustain ?? 0} min={-1} max={1} step={0.01} onChange={v => mixer.setTransientShaper(part.id, { sustain: v })} />
        <ControlRow label="Mix" value={transient?.mix ?? 1} min={0} max={1} step={0.01} onChange={v => mixer.setTransientShaper(part.id, { mix: v })} />
      </section>

      {/* TASK-241 / v2.94: Per-Channel WAV-Bounce (Stem-Export) */}
      {/* v3.42: insertChain wird durchgereicht damit User-Inserts (Bitcrusher/RingMod/Transient) im Bounce greifen. */}
      {pattern && bpm !== undefined && (
        <PartBounceSection
          part={part}
          pattern={pattern}
          bpm={bpm}
          projectName={projectName ?? "Synthstudio"}
          insertChain={chain}
        />
      )}

      {/* TASK-240 / v2.92: MIDI-Note-Output (KORG Electribe als Sound-Modul) */}
      <PartMidiOutSection partId={part.id} partName={part.name} parts={parts} />
    </aside>
  );
}

/**
 * Per-Channel WAV-Bounce (TASK-241 / v2.94.0).
 *
 * Rendert genau diesen einen Channel via OfflineAudioContext und speichert
 * ihn als WAV-Datei — Electron via `audio:save-recording` IPC, im Browser
 * als Blob-Download.
 */
function PartBounceSection({
  part,
  pattern,
  bpm,
  projectName,
  insertChain,
}: {
  part: PartData;
  pattern: PatternData;
  bpm: number;
  projectName: string;
  /** v3.42: User-konfigurierte Insert-Chain (Bitcrusher/RingMod/Transient). */
  insertChain?: import("@/utils/mixerFx").MixerFxSlot[];
}) {
  const electron = useElectron();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BounceLengthMode>("currentPattern");
  const [bars, setBars] = useState(4);
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(44100);
  const [stereo, setStereo] = useState(true);
  const [filenameStem, setFilenameStem] = useState("");
  const [isBouncing, setIsBouncing] = useState(false);
  const [bounceMsg, setBounceMsg] = useState<string | null>(null);
  // v3.84.0 — Format + Bitrate (WAV default, OGG-Opus optional).
  const [format, setFormat] = useState<BounceFormat>("wav");
  const [bitrate, setBitrate] = useState<number>(DEFAULT_OGG_BITRATE_BPS);

  // Vorausschau-Dauer berechnen
  const resolved = resolveBounceBars({ mode, bars });
  const effectiveBpm = pattern.bpm ?? bpm;
  const previewDuration = computeBounceDurationSec(resolved, pattern.stepCount, effectiveBpm, 0.5);

  const defaultFilename = defaultStemFilename(projectName, part.name);
  // v3.84.0: Filename-Default folgt dem gewählten Format. Bei explizitem
  // User-Stem ohne Endung wird sie aus dem Format abgeleitet; mit Endung
  // bleibt der User-Wunsch unverändert (Edge-Case: User schreibt ".wav"
  // obwohl Format='ogg' gewählt — wir respektieren das, der Save-Pfad
  // gleicht es ggf. an actualFormat-Endung an).
  const formatExt: ".wav" | ".ogg" = format === "ogg-opus" ? ".ogg" : ".wav";
  const formatDefault = format === "ogg-opus"
    ? defaultFilename.replace(/\.wav$/i, ".ogg")
    : defaultFilename;
  const finalFilename = filenameStem
    ? (/\.(wav|ogg)$/i.test(filenameStem) ? filenameStem : `${filenameStem}${formatExt}`)
    : formatDefault;

  const handleBounce = useCallback(async () => {
    if (isBouncing) return;
    if (previewDuration > BOUNCE_WARN_DURATION_SEC) {
      const ok = await confirm({
        title: `Lange Render-Dauer (${Math.round(previewDuration)}s). Fortfahren?`,
        confirmLabel: "Fortfahren",
      });
      if (!ok) return;
    }
    setIsBouncing(true);
    setBounceMsg("Lade Sample-Buffer…");
    try {
      // Sample-Buffer vorladen (separater AudioContext — bewusst kurzlebig,
      // wird nach dem decode wieder freigegeben). Ein Buffer pro Channel.
      let sampleBuffer: AudioBuffer | null = null;
      if (part.sampleUrl) {
        const tmpCtx = new AudioContext();
        try {
          const resp = await fetch(part.sampleUrl);
          const ab = await resp.arrayBuffer();
          sampleBuffer = await tmpCtx.decodeAudioData(ab);
        } catch (err) {
          console.warn("[Bounce] Sample-Buffer load failed", err);
        } finally {
          await tmpCtx.close().catch(() => {});
        }
      }

      setBounceMsg("Rendere Channel…");
      // v3.42: User-konfigurierte Insert-Chain durchreichen (Bitcrusher/
      // RingMod/Transient-Shaper). Closes v3.41-Caveat.
      // v3.84.0: Format-aware Bounce (WAV oder OGG-Opus via WebCodecs).
      const out = await bounceChannelToBuffer(part, pattern, {
        length: { mode, bars },
        bpm,
        sampleRate,
        channels: stereo ? 2 : 1,
        sampleBuffer,
        insertChain: insertChain ?? null,
        format,
        bitrate,
      });

      // Filename an actualFormat anpassen (z.B. silent-Fallback OGG→WAV).
      const adjustedFilename = (() => {
        if (out.actualFormat === "ogg-opus" && !/\.ogg$/i.test(finalFilename)) {
          return finalFilename.replace(/\.wav$/i, "") + ".ogg";
        }
        if (out.actualFormat === "wav" && !/\.wav$/i.test(finalFilename)) {
          return finalFilename.replace(/\.ogg$/i, "") + ".wav";
        }
        return finalFilename;
      })();

      setBounceMsg(`Speichere ${out.actualFormat === "ogg-opus" ? "OGG" : "WAV"}…`);
      if (electron.isElectron) {
        // Electron-Save: nutzt den existierenden audio:save-recording IPC.
        // Filename wird nochmals gesäubert weil das IPC streng nur
        // [A-Za-z0-9._-]+ akzeptiert.
        const safeFilename = adjustedFilename.replace(/[^A-Za-z0-9._-]/g, "_");
        const result = await electron.saveRecording(safeFilename, out.data);
        if (result.success) {
          toast(`Stem gespeichert: ${result.filePath ?? safeFilename}`, { kind: "success" });
          setBounceMsg(null);
          setOpen(false);
        } else {
          toast(`Save fehlgeschlagen: ${result.error ?? "unbekannt"}`, { kind: "error" });
          setBounceMsg(`Fehler: ${result.error ?? "unbekannt"}`);
        }
      } else {
        // Browser: Blob-Download mit korrektem MIME-Typ
        downloadAudioInBrowser(out.data, adjustedFilename, out.mimeType);
        toast(`Stem heruntergeladen: ${adjustedFilename}`, { kind: "success" });
        setBounceMsg(null);
        setOpen(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Bounce fehlgeschlagen: ${msg}`, { kind: "error" });
      setBounceMsg(`Fehler: ${msg}`);
    } finally {
      setIsBouncing(false);
    }
  }, [part, pattern, mode, bars, bpm, sampleRate, stereo, finalFilename, isBouncing, previewDuration, electron, insertChain, format, bitrate, confirm]);

  return (
    <section className="border-t border-border-color p-3" data-testid="channel-inspector-bounce-section">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full text-left text-[10px] uppercase tracking-widest ${open ? "text-accent-primary" : "text-text-dim hover:text-text-primary"} mb-2`}
        data-testid="channel-bounce-toggle"
      >
        🎬 Bounce to {format === "ogg-opus" ? "OGG" : "WAV"} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="space-y-2">
          <div className="flex gap-1 flex-wrap">
            {(["currentPattern", "currentLoop", "customBars"] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  mode === m
                    ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                    : "border-border-color text-text-dim hover:text-text-primary"
                }`}
                data-testid={`channel-bounce-mode-${m}`}
              >
                {m === "currentPattern" ? "Pattern" : m === "currentLoop" ? "Loop" : "Custom"}
              </button>
            ))}
          </div>

          {(mode === "currentLoop" || mode === "customBars") && (
            <label className="flex items-center gap-2 text-[10px] text-text-dim">
              <span>Bars:</span>
              <input
                type="number"
                min={1}
                max={64}
                value={bars}
                onChange={e => setBars(Math.max(1, Math.min(64, parseInt(e.target.value, 10) || 1)))}
                className="w-16 bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary"
                data-testid="channel-bounce-bars"
              />
            </label>
          )}

          <div className="flex items-center gap-2 text-[10px] text-text-dim">
            <label className="flex items-center gap-1">
              <span>Hz:</span>
              <select
                value={sampleRate}
                onChange={e => setSampleRate(Number(e.target.value) as 44100 | 48000)}
                className="bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary"
                data-testid="channel-bounce-sr"
              >
                <option value={44100}>44100</option>
                <option value={48000}>48000</option>
              </select>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={stereo}
                onChange={e => setStereo(e.target.checked)}
                className="accent-accent-primary"
                data-testid="channel-bounce-stereo"
              />
              Stereo
            </label>
          </div>

          {/* v3.84.0 — Format-Selector (WAV / OGG-Opus) */}
          <div className="flex items-center gap-2 text-[10px] text-text-dim" data-testid="channel-bounce-format-group">
            <label className="flex items-center gap-1">
              <span>Format:</span>
              <select
                value={format}
                onChange={e => setFormat(e.target.value as BounceFormat)}
                className="bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary"
                data-testid="channel-bounce-format-select"
              >
                <option value="wav">WAV</option>
                <option value="ogg-opus">OGG (Opus)</option>
              </select>
            </label>
            {format === "ogg-opus" && (
              <label className="flex items-center gap-1" data-testid="channel-bounce-bitrate-group">
                <span>Kbps:</span>
                <select
                  value={bitrate}
                  onChange={e => setBitrate(Number(e.target.value))}
                  className="bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary"
                  data-testid="channel-bounce-bitrate-select"
                >
                  {SUPPORTED_OGG_BITRATES_BPS.map(bps => (
                    <option key={bps} value={bps}>{bps / 1000}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <input
            type="text"
            value={filenameStem}
            onChange={e => setFilenameStem(e.target.value)}
            placeholder={formatDefault}
            className="w-full bg-bg-base border border-border-color rounded px-2 py-1 text-[10px] text-text-primary placeholder:text-text-dim"
            data-testid="channel-bounce-filename"
          />

          <div className="text-[10px] text-text-dim flex justify-between">
            <span>Dauer: {previewDuration.toFixed(1)}s</span>
            {previewDuration > BOUNCE_WARN_DURATION_SEC && (
              <span className="text-accent-danger">⚠ Lang</span>
            )}
          </div>

          <button
            type="button"
            onClick={handleBounce}
            disabled={isBouncing}
            className="w-full px-3 py-1.5 text-[11px] rounded bg-accent-primary text-white hover:opacity-80 disabled:opacity-40 font-bold transition-opacity"
            data-testid="channel-bounce-start"
          >
            {isBouncing ? "Bouncing…" : `⬇ Bounce ${format === "ogg-opus" ? "OGG" : "WAV"}`}
          </button>

          {bounceMsg && (
            <div className="text-[10px] text-text-muted" data-testid="channel-bounce-status">
              {bounceMsg}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Per-Part MIDI-Note-Output-Picker (TASK-240 / v2.92).
 *
 * Erlaubt dem User, einen Drum-Part auf ein externes MIDI-Gerät (Output +
 * Channel + Note) zu routen. Bei jedem Step-Trigger schickt AudioEngine dann
 * Note-On / Note-Off — parallel oder ANSTATT der lokalen Sample-Wiedergabe.
 *
 * Komplettiert die KORG-Bidir-Brücke (Clock-Out kam mit v2.83).
 */
function PartMidiOutSection({
  partId,
  partName,
  parts,
}: {
  partId: string;
  partName: string;
  parts: PartData[];
}) {
  const midi = useMidiContext();
  const noteOut = useMidiNoteOutStore();
  const cfg = noteOut.configs[partId];
  const outputDevices = midi?.outputDevices ?? [];

  // Defaults für "neu konfigurieren": Channel 10 (=ch 9), Note 36 (GM Kick).
  const channel = cfg?.channel ?? 9;
  const note = cfg?.note ?? 36;
  const noteDurationMs = cfg?.noteDurationMs ?? DEFAULT_NOTE_DURATION_MS;
  const localSoundEnabled = cfg?.localSoundEnabled ?? true;
  const outputId = cfg?.outputId ?? "";

  const updateCfg = (patch: Partial<typeof cfg & { outputId: string }>) => {
    const resolvedOutputId = patch.outputId ?? outputId;
    if (!resolvedOutputId) return;
    setPartMidiOutConfig(partId, {
      outputId: resolvedOutputId,
      channel: patch.channel ?? channel,
      note: patch.note ?? note,
      noteDurationMs: patch.noteDurationMs ?? noteDurationMs,
      localSoundEnabled: patch.localSoundEnabled ?? localSoundEnabled,
    });
  };

  const handleApplyElectribeTemplate = () => {
    if (!outputId) {
      toast("Bitte zuerst ein MIDI-Output-Gerät wählen", { kind: "info" });
      return;
    }
    const partIds = parts.map(p => p.id);
    applyElectribeDrumMap(partIds, outputId);
    toast(`Electribe-2-Drum-Map auf ${partIds.length} Parts angewendet`, { kind: "success" });
  };

  return (
    <section className="p-3" data-testid="channel-inspector-midi-out-section">
      <label className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">
        <input
          type="checkbox"
          checked={noteOut.enabled}
          onChange={e => setMidiNoteOutEnabled(e.target.checked)}
          className="accent-accent-primary"
          data-testid="midi-note-out-global-enable"
        />
        MIDI-Note-Out (extern triggern)
      </label>

      {outputDevices.length === 0 && (
        <p className="mb-2 rounded border border-border-color bg-bg-elevated p-2 text-[10px] text-text-dim">
          Keine MIDI-Output-Geräte erkannt. Schließe ein MIDI-Interface an oder
          aktiviere Web-MIDI in den Browser-Einstellungen.
        </p>
      )}

      <label className="mb-2 block text-[10px] text-text-muted">
        Output-Gerät
        <select
          aria-label={`MIDI-Output für ${partName}`}
          value={outputId}
          onChange={e => {
            const next = e.target.value;
            if (!next) {
              clearPartMidiOutConfig(partId);
            } else {
              updateCfg({ outputId: next });
            }
          }}
          className="mt-1 w-full rounded border border-border-color bg-bg-panel px-2 py-1 text-xs text-text-primary"
          data-testid="midi-note-out-device-select"
        >
          <option value="">— keiner (lokales Sample) —</option>
          {outputDevices.map(d => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>

      {cfg && (
        <>
          <label className="mb-2 block text-[10px] text-text-muted">
            MIDI-Channel (1-16)
            <select
              aria-label={`MIDI-Channel für ${partName}`}
              value={channel}
              onChange={e => updateCfg({ channel: parseInt(e.target.value, 10) })}
              className="mt-1 w-full rounded border border-border-color bg-bg-panel px-2 py-1 text-xs text-text-primary"
              data-testid="midi-note-out-channel-select"
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  Ch {i + 1}{i === 9 ? " (Drum/GM)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="mb-2 block text-[10px] text-text-muted">
            Note ({noteNameFromNumber(note)} = {note})
            <input
              type="range"
              min={0}
              max={127}
              step={1}
              value={note}
              onChange={e => updateCfg({ note: parseInt(e.target.value, 10) })}
              className="mt-1 w-full accent-accent-primary"
              data-testid="midi-note-out-note-slider"
              aria-label={`MIDI-Note für ${partName}`}
            />
          </label>

          <label className="mb-2 block text-[10px] text-text-muted">
            Note-Länge: {noteDurationMs} ms
            <input
              type="range"
              min={10}
              max={2000}
              step={10}
              value={noteDurationMs}
              onChange={e => updateCfg({ noteDurationMs: parseInt(e.target.value, 10) })}
              className="mt-1 w-full accent-accent-primary"
              data-testid="midi-note-out-duration-slider"
            />
          </label>

          <label className="mb-2 flex items-center gap-2 text-[10px] text-text-muted">
            <input
              type="checkbox"
              checked={localSoundEnabled}
              onChange={e => updateCfg({ localSoundEnabled: e.target.checked })}
              className="accent-accent-primary"
              data-testid="midi-note-out-local-sound-toggle"
            />
            Lokalen Sound zusätzlich spielen (Layer)
          </label>

          <button
            type="button"
            onClick={() => clearPartMidiOutConfig(partId)}
            className="mb-2 w-full rounded border border-border-color px-2 py-1 text-[10px] text-text-muted hover:text-accent-danger hover:border-accent-danger"
            data-testid="midi-note-out-clear"
          >
            MIDI-Out für diesen Part entfernen
          </button>
        </>
      )}

      <button
        type="button"
        onClick={handleApplyElectribeTemplate}
        disabled={!outputId}
        className="w-full rounded border border-border-color px-2 py-1 text-[10px] text-text-muted hover:text-accent-primary hover:border-accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
        title={ELECTRIBE_2_DRUM_MAP.description}
        data-testid="midi-note-out-apply-electribe"
      >
        Electribe-Template anwenden (alle Parts)
      </button>
    </section>
  );
}

function ControlRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-1.5 grid grid-cols-[56px_1fr_42px] items-center gap-2 text-[10px] text-text-dim">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="accent-accent-primary"
      />
      <span className="text-right font-mono">{value.toFixed(2)}</span>
    </label>
  );
}

// ─── v3.45.0 — Plugin-Chain Section (Multi-Slot, max 4) ───────────────────
// v3.46.0: + Save/Load-Preset Sub-UI

interface PluginChainSectionProps {
  partId: string;
  slots: MixerPluginSlot[];
  onAddSlot: (pluginId: string) => void;
  onRemoveSlot: (index: number) => void;
  onMoveSlot: (from: number, to: number) => void;
  onChangePlugin: (index: number, pluginId: string) => void;
  onChangeParam: (index: number, paramId: string, value: number) => void;
  onToggleBypass: (index: number) => void;
  /** v3.46: Wendet ein Preset (id) als komplette neue Chain an. */
  onApplyPreset: (presetId: string) => void;
  /** v3.46: Speichert die aktuelle Chain unter einem Namen. Liefert true bei Erfolg. */
  onSavePreset: (name: string) => boolean;
  /** v3.46: Entfernt ein User-Preset. */
  onRemovePreset: (presetId: string) => void;
  /** v3.47: Exportiert ein einzelnes Preset als JSON-Download. */
  onExportPreset: (presetId: string) => void;
  /** v3.47: Bulk-Export aller Presets als JSON-Bundle. */
  onExportAllPresets: () => void;
  /** v3.47: Triggert File-Picker für JSON-Import. */
  onImportPresets: (file: File) => void;
}

function PluginChainSection({
  partId,
  slots,
  onAddSlot,
  onRemoveSlot,
  onMoveSlot,
  onChangePlugin,
  onChangeParam,
  onToggleBypass,
  onApplyPreset,
  onSavePreset,
  onRemovePreset,
  onExportPreset,
  onExportAllPresets,
  onImportPresets,
}: PluginChainSectionProps) {
  const plugins = React.useMemo(() => getRegisteredPlugins(), []);
  const canAddMore = slots.length < MAX_PLUGIN_SLOTS_PER_CHANNEL;
  const [addOpen, setAddOpen] = useState(false);
  // v3.46: Preset-UI State
  const { presets } = usePluginChainPresetStore();
  const [presetSaveOpen, setPresetSaveOpen] = useState(false);
  const [presetLoadOpen, setPresetLoadOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  // v3.47: hidden <input type=file> für Import
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const handleSavePreset = useCallback(() => {
    const ok = onSavePreset(presetName);
    if (ok) {
      setPresetSaveOpen(false);
      setPresetName("");
    }
  }, [onSavePreset, presetName]);
  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);
  const handleImportFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) onImportPresets(f);
      // input value zurücksetzen damit derselbe Dateiname erneut wählbar bleibt
      e.target.value = "";
    },
    [onImportPresets],
  );

  return (
    <section className="border-b border-border-color p-3" data-testid={`channel-plugin-chain-${partId}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">
          Plugin-Chain ({slots.length}/{MAX_PLUGIN_SLOTS_PER_CHANNEL})
        </span>
        <div className="flex items-center gap-1">
          {/* v3.46: Load Preset */}
          <button
            type="button"
            onClick={() => {
              setPresetLoadOpen((o) => !o);
              setPresetSaveOpen(false);
              setAddOpen(false);
            }}
            className={`rounded border px-2 py-1 text-[10px] ${
              presetLoadOpen
                ? "border-accent-primary text-accent-primary"
                : "border-border-color text-text-dim hover:text-text-primary"
            }`}
            title={`Plugin-Chain-Preset laden (${presets.length} verfügbar)`}
            data-testid={`channel-plugin-load-preset-${partId}`}
          >
            📂 Load
          </button>
          {/* v3.46: Save Preset */}
          <button
            type="button"
            onClick={() => {
              setPresetSaveOpen((o) => !o);
              setPresetLoadOpen(false);
              setAddOpen(false);
            }}
            disabled={slots.length === 0}
            className={`rounded border px-2 py-1 text-[10px] ${
              presetSaveOpen
                ? "border-accent-secondary text-accent-secondary"
                : "border-border-color text-text-dim hover:text-text-primary"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title="Aktuelle Chain als Preset speichern"
            data-testid={`channel-plugin-save-preset-${partId}`}
          >
            💾 Save
          </button>
          {canAddMore && !addOpen && (
            <button
              type="button"
              onClick={() => {
                setAddOpen(true);
                setPresetSaveOpen(false);
                setPresetLoadOpen(false);
              }}
              className="rounded border border-accent-secondary px-2 py-1 text-[10px] text-accent-secondary hover:bg-bg-elevated"
              data-testid={`channel-plugin-add-${partId}`}
            >
              + Add Plugin
            </button>
          )}
        </div>
      </div>

      {presetSaveOpen && (
        <div
          className="mb-2 p-2 rounded border border-accent-secondary/60 bg-accent-secondary/10 space-y-2"
          data-testid={`channel-plugin-save-preset-form-${partId}`}
        >
          <input
            type="text"
            autoFocus
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSavePreset();
              if (e.key === "Escape") setPresetSaveOpen(false);
            }}
            placeholder="Preset-Name"
            className="w-full bg-bg-base text-text-primary text-xs px-2 py-1 rounded border border-border-color"
            data-testid={`channel-plugin-save-preset-name-${partId}`}
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setPresetSaveOpen(false)}
              className="px-2 py-1 text-[10px] rounded text-text-muted hover:text-text-primary"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleSavePreset}
              disabled={!presetName.trim()}
              className="px-2 py-1 text-[10px] rounded bg-accent-secondary text-bg-base hover:bg-accent-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid={`channel-plugin-save-preset-commit-${partId}`}
            >
              Speichern
            </button>
          </div>
        </div>
      )}

      {presetLoadOpen && (
        <div
          className="mb-2 p-2 rounded border border-accent-primary/60 bg-accent-primary/10"
          data-testid={`channel-plugin-load-preset-list-${partId}`}
        >
          {/* v3.47: Bulk-Import/Export Toolbar */}
          <div className="mb-2 flex items-center justify-between gap-1">
            <span className="text-[10px] text-text-dim">
              {presets.length} Preset{presets.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onExportAllPresets}
                disabled={presets.length === 0}
                title="Alle Presets als JSON-Bundle exportieren"
                className="rounded border border-border-color px-2 py-1 text-[10px] text-text-dim hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid={`channel-plugin-export-all-${partId}`}
              >
                📋 Export All
              </button>
              <button
                type="button"
                onClick={handleImportClick}
                title="Preset(s) aus JSON-Datei importieren"
                className="rounded border border-border-color px-2 py-1 text-[10px] text-text-dim hover:text-text-primary"
                data-testid={`channel-plugin-import-${partId}`}
              >
                ⬆ Import
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,.synthpreset.json,application/json"
                onChange={handleImportFileChange}
                className="hidden"
                data-testid={`channel-plugin-import-input-${partId}`}
              />
            </div>
          </div>

          {presets.length === 0 && (
            <div className="text-center text-[10px] text-text-dim py-2">
              Keine Presets gespeichert.
            </div>
          )}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {presets.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-1 rounded bg-bg-base/50 border border-transparent hover:border-accent-primary/50"
              >
                <button
                  type="button"
                  onClick={() => {
                    onApplyPreset(p.id);
                    setPresetLoadOpen(false);
                  }}
                  className="flex-1 text-left px-2 py-1"
                  data-testid={`channel-plugin-load-preset-${partId}-${p.id}`}
                  title={`${p.slots.length} Slot(s) — ${
                    p.builtIn ? "Built-In" : new Date(p.createdAt).toLocaleString()
                  }`}
                >
                  <div className="text-xs text-text-primary truncate">
                    {p.name}
                    {p.builtIn ? (
                      <span className="ml-1 text-[9px] text-text-dim">(Built-In)</span>
                    ) : null}
                  </div>
                  <div className="text-[9px] text-text-dim">
                    {p.slots.length} Slot{p.slots.length === 1 ? "" : "s"}
                  </div>
                </button>
                {/* v3.47: Per-Preset Export */}
                <button
                  type="button"
                  onClick={() => onExportPreset(p.id)}
                  title="Preset als JSON-Datei exportieren"
                  className="px-2 py-1 text-[10px] text-text-dim hover:text-accent-primary"
                  data-testid={`channel-plugin-export-preset-${partId}-${p.id}`}
                >
                  ⬇
                </button>
                {!p.builtIn && (
                  <button
                    type="button"
                    onClick={() => onRemovePreset(p.id)}
                    title="Preset entfernen"
                    className="px-2 py-1 text-[10px] text-accent-danger hover:text-accent-danger/80"
                    data-testid={`channel-plugin-remove-preset-${partId}-${p.id}`}
                  >
                    X
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {addOpen && canAddMore && (
        <div className="mb-2 flex items-center gap-2">
          <select
            aria-label="Plugin auswählen"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) {
                onAddSlot(id);
                setAddOpen(false);
              }
            }}
            className="flex-1 rounded bg-bg-panel px-2 py-1 text-[10px] text-text-primary border border-border-color"
            data-testid={`channel-plugin-add-select-${partId}`}
          >
            <option value="">Plugin wählen…</option>
            {plugins.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.builtIn ? "(Built-In)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAddOpen(false)}
            className="rounded border border-border-color px-2 py-1 text-[10px] text-text-dim hover:text-text-primary"
          >
            Abbruch
          </button>
        </div>
      )}

      {slots.length === 0 && !addOpen && (
        <div className="rounded border border-dashed border-border-color px-2 py-3 text-center text-[10px] text-text-dim">
          Kein Plugin geladen
        </div>
      )}

      <div className="space-y-2">
        {slots.map((slot, index) => (
          <PluginSlotItem
            key={`${index}-${slot.pluginId}`}
            partId={partId}
            slot={slot}
            index={index}
            isFirst={index === 0}
            isLast={index === slots.length - 1}
            availablePlugins={plugins}
            onChangePlugin={(pluginId) => onChangePlugin(index, pluginId)}
            onChangeParam={(paramId, value) => onChangeParam(index, paramId, value)}
            onToggleBypass={() => onToggleBypass(index)}
            onRemove={() => onRemoveSlot(index)}
            onMoveUp={() => onMoveSlot(index, index - 1)}
            onMoveDown={() => onMoveSlot(index, index + 1)}
          />
        ))}
      </div>
    </section>
  );
}

interface PluginSlotItemProps {
  partId: string;
  slot: MixerPluginSlot;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  availablePlugins: ReturnType<typeof getRegisteredPlugins>;
  onChangePlugin: (pluginId: string) => void;
  onChangeParam: (paramId: string, value: number) => void;
  onToggleBypass: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function PluginSlotItem({
  partId,
  slot,
  index,
  isFirst,
  isLast,
  availablePlugins,
  onChangePlugin,
  onChangeParam,
  onToggleBypass,
  onRemove,
  onMoveUp,
  onMoveDown,
}: PluginSlotItemProps) {
  const manifest = getPluginManifest(slot.pluginId);

  return (
    <div
      className="rounded border border-border-subtle bg-bg-elevated p-2"
      data-testid={`channel-plugin-slot-${partId}-${index}`}
    >
      <div className="mb-2 flex items-center gap-1">
        <span className="text-[9px] text-text-dim font-mono">#{index + 1}</span>
        <select
          aria-label={`Plugin Slot ${index + 1}`}
          value={slot.pluginId}
          onChange={(e) => onChangePlugin(e.target.value)}
          className="flex-1 rounded bg-bg-panel px-2 py-1 text-[10px] text-text-primary border border-border-color"
          data-testid={`channel-plugin-select-${partId}-${index}`}
        >
          {availablePlugins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} {p.builtIn ? "(Built-In)" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onToggleBypass}
          className={`px-2 py-1 text-[10px] rounded border ${
            slot.bypassed
              ? "border-text-dim text-text-dim"
              : "border-accent-secondary text-accent-secondary"
          }`}
          title="Bypass — Plugin überspringen (5ms click-free)"
          data-testid={`channel-plugin-bypass-${partId}-${index}`}
        >
          {slot.bypassed ? "OFF" : "ON"}
        </button>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          title="Nach oben"
          className="text-[10px] text-text-dim hover:text-text-primary disabled:opacity-30"
          data-testid={`channel-plugin-up-${partId}-${index}`}
        >
          Up
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          title="Nach unten"
          className="text-[10px] text-text-dim hover:text-text-primary disabled:opacity-30"
          data-testid={`channel-plugin-down-${partId}-${index}`}
        >
          Dn
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Entfernen"
          className="text-[10px] text-accent-danger hover:text-accent-danger/80"
          data-testid={`channel-plugin-remove-${partId}-${index}`}
        >
          X
        </button>
      </div>

      {manifest && (
        <div className="space-y-1">
          {manifest.paramSchema.map((def) => {
            const raw = slot.params[def.id] ?? def.default;
            const clamped = clampPluginParam(manifest, def.id, raw);
            return (
              <ControlRow
                key={def.id}
                label={def.label}
                value={clamped}
                min={def.min}
                max={def.max}
                step={def.step ?? 0.01}
                onChange={(v) => onChangeParam(def.id, v)}
              />
            );
          })}
          <div className="mt-1 text-[9px] text-text-dim">
            {manifest.name} v{manifest.version}
          </div>
        </div>
      )}

      {!manifest && (
        <div className="rounded border border-dashed border-accent-danger px-2 py-2 text-[10px] text-accent-danger">
          Plugin „{slot.pluginId}" nicht gefunden — neu installiert?
        </div>
      )}
    </div>
  );
}

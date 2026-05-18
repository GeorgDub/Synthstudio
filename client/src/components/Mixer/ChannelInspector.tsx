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
import React, { useState } from "react";
import type { PartData } from "@/audio/AudioEngine";
import type { MixerState, MixerActions } from "@/store/useMixerStore";
import { MIXER_FX_TYPES, summarizeEqBands, type MixerFxType } from "@/utils/mixerFx";
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
}

export function ChannelInspector({ part, parts, mixer, className, onApplyPatch }: ChannelInspectorProps) {
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

      {/* TASK-240 / v2.92: MIDI-Note-Output (KORG Electribe als Sound-Modul) */}
      <PartMidiOutSection partId={part.id} partName={part.name} parts={parts} />
    </aside>
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

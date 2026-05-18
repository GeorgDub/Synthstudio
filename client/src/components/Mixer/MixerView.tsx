/**
 * Synthstudio – MixerView.tsx
 *
 * Dedizierter Mixer mit Channel-Strips für alle DrumMachine-Kanäle.
 * Features:
 * - Vertikaler Fader (Volume 0–1, mit dB-Anzeige)
 * - Pan-Regler (-1..+1)
 * - Mute / Solo Buttons
 * - VU-Meter (animiert via requestAnimationFrame)
 * - Send-Level zu globalem Reverb + Delay-Bus
 * - Master-Fader rechts
 */

import React, { useEffect, useRef, useCallback, useState } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { MixerState, MixerActions } from "@/store/useMixerStore";
import { AudioEngine } from "@/audio/AudioEngine";
import type { PartData } from "@/audio/AudioEngine";
// MIXER_FX_TYPES / summarizeEqBands / MixerFxType wurden mit dem extrahierten
// ChannelInspector verschoben (siehe components/Mixer/ChannelInspector.tsx).
import { ExportPanel } from "./ExportPanel";
import { AudioTrackStrip, computePeaksFromBuffer } from "./AudioTrackStrip";
import { LiveInputStrip } from "./LiveInputStrip";
import {
  useLiveInputStore,
  addLiveInputChannel,
  MAX_LIVE_INPUT_CHANNELS,
} from "@/store/useLiveInputStore";
// TASK-232-FOLLOWUP / v2.98: Live-Input (USB-Audio-In) ist ein Pro-Feature.
import { ProLockBadge } from "@/components/License/ProLockBadge";
import { PRO_FEATURE_USB_AUDIO_IN } from "@/utils/proFeatures";
import {
  useAudioTrackStore,
  addAudioTrack,
  getRuntimeState,
  setRuntimeWaveform,
  markBroken,
  getAllAudioTracks,
  countTimestretchTracks,
  MAX_AUDIO_TRACKS,
  MAX_TIMESTRETCH_TRACKS,
  type AudioTrackChannelData,
} from "@/store/useAudioTrackStore";
import { useElectron } from "../../../../electron/useElectron";
import { useMidiLearn } from "@/hooks/useMidiLearn";

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function volToDb(vol: number): string {
  if (vol <= 0) return "-∞";
  const db = 20 * Math.log10(Math.max(0.001, vol));
  return (db >= 0 ? "+" : "") + db.toFixed(1) + " dB";
}

function vuColor(level: number): string {
  if (level > 0.9) return "#ef4444"; // rot – Clip
  if (level > 0.7) return "#f59e0b"; // gelb – heiß
  return "var(--theme-accent, #06b6d4)"; // Cyan/Theme-Farbe
}

// ─── Spectrum Display ─────────────────────────────────────────────────────────

function SpectrumDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    // Sync canvas resolution to CSS size via ResizeObserver
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
    });
    ro.observe(canvas);
    canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;

    let rafId: number;
    let dataArray: Float32Array<ArrayBuffer> | null = null;

    // Read CSS vars once per frame (cheap, prevents CSS-var string in fillStyle)
    const getCssColor = (varName: string, fallback: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;

    const draw = () => {
      const analyser = AudioEngine.getOutputAnalyser();
      if (!analyser) { rafId = requestAnimationFrame(draw); return; }

      if (!dataArray || dataArray.length !== analyser.frequencyBinCount) {
        dataArray = new Float32Array(analyser.frequencyBinCount) as Float32Array<ArrayBuffer>;
      }
      analyser.getFloatFrequencyData(dataArray);

      const w = canvas.width;
      const h = canvas.height;
      const dpr = window.devicePixelRatio;

      // Background (resolved CSS var, not "var(...)" string — canvas doesn't parse CSS vars)
      ctx2d.fillStyle = getCssColor("--ss-bg-base", "#0a0a0a");
      ctx2d.fillRect(0, 0, w, h);

      // dB grid lines: -72, -48, -24, 0
      const DB_FLOOR = -96; // bottom of display range
      const dbLines = [-72, -48, -24, 0];
      ctx2d.strokeStyle = "rgba(255,255,255,0.07)";
      ctx2d.lineWidth = dpr;
      for (const db of dbLines) {
        const y = h - ((db - DB_FLOOR) / (-DB_FLOOR)) * h;
        ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(w, y); ctx2d.stroke();
      }

      const accentPrimary   = getCssColor("--ss-accent-primary",   "#f59e0b");
      const accentSecondary = getCssColor("--ss-accent-secondary",  "#06b6d4");
      const accentDanger    = getCssColor("--ss-accent-danger",     "#f43f5e");

      // Only display the perceptually relevant bins (0 – 14 kHz ≈ 70% of Nyquist)
      const displayBins = Math.floor(dataArray.length * 0.65);
      const barW = Math.max(dpr, (w / displayBins) - dpr * 0.5);

      for (let i = 0; i < displayBins; i++) {
        const db = dataArray[i]; // Float32: -Infinity..0 dB
        if (!isFinite(db)) continue;
        const norm = Math.max(0, Math.min(1, (db - DB_FLOOR) / (-DB_FLOOR)));
        if (norm < 0.001) continue;
        const barH = norm * h;
        const x = (i / displayBins) * w;

        // Color: bass → secondary, mids → primary, clip → danger
        const t = i / displayBins;
        let color = t < 0.25 ? accentSecondary : accentPrimary;
        if (norm > 0.92) color = accentDanger; // near-clip red

        ctx2d.fillStyle = color;
        ctx2d.globalAlpha = 0.7 + norm * 0.3;
        ctx2d.fillRect(x, h - barH, barW, barH);
      }
      ctx2d.globalAlpha = 1;
      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafId); ro.disconnect(); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-20 rounded block"
    />
  );
}

// ─── VU-Meter ────────────────────────────────────────────────────────────────

function VuMeter({ level }: { level: number }) {
  const NUM_SEGMENTS = 16;
  return (
    <div className="flex flex-col-reverse gap-px h-32 w-3">
      {Array.from({ length: NUM_SEGMENTS }, (_, i) => {
        const threshold = (i + 1) / NUM_SEGMENTS;
        const active = level >= threshold;
        const color =
          i >= 14 ? "#ef4444" :
          i >= 11 ? "#f59e0b" :
          "var(--theme-accent, #06b6d4)";
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-opacity duration-75"
            style={{
              backgroundColor: active ? color : "#1e293b",
              opacity: active ? 1 : 0.3,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Mixer-Kanal ─────────────────────────────────────────────────────────────

interface MixerChannelProps {
  partId: string;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  sendReverb: number;
  sendDelay: number;
  peakLevel: number;
  selected?: boolean;
  isMaster?: boolean;
  onSelect?: () => void;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  onMuteToggle: () => void;
  /** Solo-Toggle. event.shiftKey wechselt zwischen Default und additive Verhalten (FOLLOWUP-102-3). */
  onSoloToggle: (e: { shiftKey: boolean }) => void;
  onSendChange: (bus: "reverb" | "delay", v: number) => void;
}

function MixerChannel({
  partId, name, volume, pan, muted, soloed,
  sendReverb, sendDelay, peakLevel,
  selected, isMaster, onSelect,
  onVolumeChange, onPanChange, onMuteToggle, onSoloToggle, onSendChange,
}: MixerChannelProps) {
  const labelColor = muted ? "text-text-dim" : soloed ? "text-accent-success" : "text-text-primary";

  // v1.87: Right-click MIDI-Learn auf Volume / Pan / Mute / Solo pro Channel.
  // Für Master-Channel nutzen wir 'masterVolume' statt 'volume', da der
  // Master keinen partId hat (oder einen speziellen).
  const volumeLearn = useMidiLearn(
    isMaster
      ? { type: "masterVolume" }
      : { type: "volume", partId, partName: name },
  );
  const panLearn = useMidiLearn({ type: "pan", partId, partName: name });
  const muteLearn = useMidiLearn({ type: "mute", partId, partName: name });
  const soloLearn = useMidiLearn({ type: "solo", partId, partName: name });
  // v2.1: Reverb/Delay-Sends bindbar via Rechtsklick
  const sendRevLearn = useMidiLearn({ type: "send", partId, partName: name, bus: "reverb" });
  const sendDlyLearn = useMidiLearn({ type: "send", partId, partName: name, bus: "delay" });

  return (
    <div
      onClick={onSelect}
      className={[
        "flex flex-col items-center gap-1 px-2 py-2 select-none",
        "border-r border-border-color last:border-r-0 cursor-pointer",
        isMaster ? "bg-bg-panel/60 border-l border-border-color pl-3" : "",
        selected ? "bg-accent-secondary/15 ring-1 ring-accent-secondary/60 ring-inset" : "",
        muted ? "opacity-50" : "",
      ].join(" ")}
      style={{ minWidth: isMaster ? "64px" : "52px" }}
    >
      {/* Kanalname */}
      <span
        className={`text-[9px] font-medium uppercase tracking-wide truncate w-full text-center ${labelColor}`}
        title={name}
      >
        {name}
      </span>

      {/* VU-Meter + Fader nebeneinander */}
      <div className="flex items-end gap-1 h-32">
        <VuMeter level={peakLevel} />

        {/* Vertikaler Fader — v1.87: right-click MIDI-Learn */}
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          onContextMenu={volumeLearn.onContextMenu}
          className="h-32 w-3 accent-accent-primary cursor-pointer"
          style={{ writingMode: "vertical-lr", direction: "rtl", appearance: "slider-vertical" as React.CSSProperties["appearance"] }}
          title={`${volToDb(volume)} · Rechtsklick: MIDI-Learn${volumeLearn.isMapped ? ` · CC${volumeLearn.mappedCC}` : ""}`}
        />
        {volumeLearn.menu}
      </div>

      {/* dB-Anzeige + Mapped-Badge */}
      <span className="text-[8px] text-text-dim font-mono">
        {volToDb(volume)}
        {volumeLearn.isMapped && (
          <span className="ml-1 text-accent-secondary">·CC{volumeLearn.mappedCC}</span>
        )}
      </span>

      {/* Pan-Regler — v1.87: right-click MIDI-Learn */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-text-dim uppercase">Pan</span>
        <input
          type="range"
          min={-1} max={1} step={0.01}
          value={pan}
          onChange={e => onPanChange(parseFloat(e.target.value))}
          onContextMenu={isMaster ? undefined : panLearn.onContextMenu}
          className="w-full accent-accent-primary cursor-pointer"
          title={`${pan === 0 ? "C" : pan > 0 ? `R ${Math.round(pan * 100)}` : `L ${Math.round(-pan * 100)}`}${!isMaster && panLearn.isMapped ? ` · CC${panLearn.mappedCC}` : ""}`}
        />
        <span className="text-[8px] text-text-dim font-mono">
          {pan === 0 ? "C" : pan > 0 ? `R${Math.round(pan * 100)}` : `L${Math.round(-pan * 100)}`}
          {!isMaster && panLearn.isMapped && (
            <span className="ml-1 text-accent-secondary">·CC{panLearn.mappedCC}</span>
          )}
        </span>
        {!isMaster && panLearn.menu}
      </div>

      {/* Mute / Solo */}
      {!isMaster && (
        <div className="flex gap-1 relative">
          <button
            onClick={onMuteToggle}
            onContextMenu={muteLearn.onContextMenu}
            title={`Mute (M)${muteLearn.isMapped ? ` · CC${muteLearn.mappedCC}` : ""} · Rechtsklick: MIDI-Learn`}
            className={[
              "relative w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
              muted
                ? "bg-accent-secondary text-bg-base"
                : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-accent-secondary",
            ].join(" ")}
          >
            M
            {muteLearn.isMapped && (
              <span className="absolute -top-1 -right-1 text-[7px] font-mono bg-accent-secondary text-bg-base px-0.5 rounded leading-tight">·</span>
            )}
          </button>
          <button
            onClick={(e) => onSoloToggle({ shiftKey: e.shiftKey })}
            onContextMenu={soloLearn.onContextMenu}
            title={`Solo (S)${soloLearn.isMapped ? ` · CC${soloLearn.mappedCC}` : ""} · Rechtsklick: MIDI-Learn — Shift+Click = additiv`}
            className={[
              "relative w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
              soloed
                ? "bg-accent-success text-bg-base"
                : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-accent-success",
            ].join(" ")}
          >
            S
            {soloLearn.isMapped && (
              <span className="absolute -top-1 -right-1 text-[7px] font-mono bg-accent-secondary text-bg-base px-0.5 rounded leading-tight">·</span>
            )}
          </button>
          {muteLearn.menu}
          {soloLearn.menu}
        </div>
      )}

      {/* Send-Regler (nur für normale Kanäle) — v2.1 mit Rechtsklick MIDI-Learn */}
      {!isMaster && (
        <div className="flex flex-col gap-1 w-full mt-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[7px] text-accent-secondary uppercase">
              Rev{sendRevLearn.isMapped && <span className="ml-0.5 font-mono">·CC{sendRevLearn.mappedCC}</span>}
            </span>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={sendReverb}
              onChange={e => onSendChange("reverb", parseFloat(e.target.value))}
              onContextMenu={sendRevLearn.onContextMenu}
              className="w-full accent-accent-secondary cursor-pointer"
              title={`Reverb Send${sendRevLearn.isMapped ? ` · CC${sendRevLearn.mappedCC}` : ""} · Rechtsklick: MIDI-Learn`}
            />
            {sendRevLearn.menu}
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[7px] text-accent-primary uppercase">
              Dly{sendDlyLearn.isMapped && <span className="ml-0.5 font-mono">·CC{sendDlyLearn.mappedCC}</span>}
            </span>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={sendDelay}
              onChange={e => onSendChange("delay", parseFloat(e.target.value))}
              onContextMenu={sendDlyLearn.onContextMenu}
              className="w-full accent-accent-primary cursor-pointer"
              title={`Delay Send${sendDlyLearn.isMapped ? ` · CC${sendDlyLearn.mappedCC}` : ""} · Rechtsklick: MIDI-Learn`}
            />
            {sendDlyLearn.menu}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Channel Inspector ───────────────────────────────────────────────────────
// Extracted to client/src/components/Mixer/ChannelInspector.tsx post-v1.34.0.
// App.tsx rendert den Inspector jetzt als Geschwister-Komponente neben
// MixerView, damit er unabhängig vom Mixer-Popup-Status sichtbar bleibt.

// ─── MixerView ───────────────────────────────────────────────────────────────

interface MixerViewProps {
  dm: DrumMachineState & DrumMachineActions;
  mixer: MixerState & MixerActions;
  samples?: import("@/store/useProjectStore").Sample[];
  bpm?: number;
  projectName?: string;
  className?: string;
}

export function MixerView({ dm, mixer, samples = [], bpm = 120, projectName = "Synthstudio", className = "" }: MixerViewProps) {
  const pattern = dm.getActivePattern();
  const parts = pattern?.parts ?? [];
  const selectedPart = parts.find(part => part.id === mixer.selectedChannelId) ?? parts[0];

  // ── Audio-Tracks (externe Vocals/Songs) ────────────────────────────────────
  // Hook-Aufruf abonniert den Store: bei add/remove/update + runtime-Änderungen
  // (peaks/broken) wird MixerView neu gerendert und die Strips bekommen
  // frische `runtime`-Snapshots via getRuntimeState().
  const audioTrackStore = useAudioTrackStore();
  const audioTracks = audioTrackStore.tracks;
  const liveInputStore = useLiveInputStore();
  const liveInputChannels = liveInputStore.channels;
  const electron = useElectron();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // Engine-Getter einmalig setzen damit Transport-Play alle registrierten Tracks startet
  useEffect(() => {
    AudioEngine.setAudioTracksGetter(() => getAllAudioTracks());
  }, []);

  // Auto-fade Error-Toast
  useEffect(() => {
    if (!addError) return;
    const id = setTimeout(() => setAddError(null), 3000);
    return () => clearTimeout(id);
  }, [addError]);

  // Lädt eine einzelne Audio-Datei (Electron-Pfad oder Browser-File) als Track.
  const ingestAudioFile = useCallback(
    async (source: { kind: "path"; path: string; name: string; size?: number } | { kind: "file"; file: File }) => {
      // Filename-Stem als Default-Name
      const rawName = source.kind === "path" ? source.name : source.file.name;
      const stemName = rawName.replace(/\.[^.]+$/, "").slice(0, 40) || "Audio Track";
      const filePath = source.kind === "path" ? source.path : source.file.name;
      const fileName = rawName;
      const fileSize = source.kind === "path" ? source.size : source.file.size;

      let trackId: string;
      try {
        trackId = addAudioTrack({
          name: stemName,
          filePath,
          fileName,
          fileSize,
          volume: 1,
          pan: 0,
          muted: false,
          soloed: false,
          sends: { reverb: 0, delay: 0 },
          syncMode: "free",
        });
      } catch (err) {
        setAddError(
          err instanceof Error && err.message.includes("Maximum")
            ? `Max ${MAX_AUDIO_TRACKS} audio tracks reached`
            : "Konnte Audio-Track nicht anlegen",
        );
        return;
      }

      // Buffer laden + Peaks + Engine registrieren
      try {
        const buf =
          source.kind === "path"
            ? await AudioEngine.loadAudioTrack(trackId, source.path)
            : await AudioEngine.loadAudioTrack(trackId, source.file);

        if (!buf) {
          markBroken(trackId, true);
          return;
        }

        const newTrack: AudioTrackChannelData = {
          id: trackId,
          name: stemName,
          filePath,
          fileName,
          fileSize,
          volume: 1,
          pan: 0,
          muted: false,
          soloed: false,
          sends: { reverb: 0, delay: 0 },
          syncMode: "free",
        };
        AudioEngine.registerAudioTrack(newTrack);

        // Peaks: bevorzugt via Electron, sonst client-side downsample
        let peaks: Float32Array | undefined;
        if (electron.isElectron && source.kind === "path") {
          try {
            const res = await electron.analyzeWaveform(source.path, 200);
            const r = res as { success?: boolean; peaks?: number[] };
            if (r.success && Array.isArray(r.peaks)) {
              peaks = Float32Array.from(r.peaks);
            }
          } catch { /* ignore – fallback below */ }
        }
        if (!peaks) peaks = computePeaksFromBuffer(buf, 200);
        setRuntimeWaveform(trackId, buf.duration, peaks);
      } catch (err) {
        console.warn("[MixerView] ingestAudioFile error:", err);
        markBroken(trackId, true);
      }
    },
    [electron],
  );

  const handleAddAudioTrack = useCallback(async () => {
    if (audioTracks.length >= MAX_AUDIO_TRACKS) {
      setAddError(`Max ${MAX_AUDIO_TRACKS} audio tracks reached`);
      return;
    }
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: "Audio-Tracks importieren",
        filters: [
          {
            name: "Audio",
            extensions: ["wav", "mp3", "ogg", "flac", "aif", "aiff", "m4a"],
          },
        ],
        multiSelections: true,
      });
      if (result.canceled || result.filePaths.length === 0) return;
      for (const p of result.filePaths) {
        if (getAllAudioTracks().length >= MAX_AUDIO_TRACKS) {
          setAddError(`Max ${MAX_AUDIO_TRACKS} audio tracks reached`);
          break;
        }
        const name = p.split(/[\\/]/).pop() ?? p;
        await ingestAudioFile({ kind: "path", path: p, name });
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [audioTracks.length, electron, ingestAudioFile]);

  const handleBrowserFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ""; // Reset für erneute Selektion derselben Datei
      for (const f of files) {
        if (getAllAudioTracks().length >= MAX_AUDIO_TRACKS) {
          setAddError(`Max ${MAX_AUDIO_TRACKS} audio tracks reached`);
          break;
        }
        await ingestAudioFile({ kind: "file", file: f });
      }
    },
    [ingestAudioFile],
  );

  // VU-Meter Animation via requestAnimationFrame
  // (vereinfacht: setzt peakLevel via AnalyserNode wenn verfügbar)
  const analyserMap = useRef<Map<string, AnalyserNode>>(new Map());
  const rafRef = useRef<number>(0);

  const updateVu = useCallback(() => {
    analyserMap.current.forEach((analyser, partId) => {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      mixer.setChannelPeakLevel(partId, Math.min(1, peak));
    });
    rafRef.current = requestAnimationFrame(updateVu);
  }, [mixer]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateVu);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateVu]);

  // Kanäle im Mixer-Store sicherstellen
  useEffect(() => {
    parts.forEach(p => mixer.ensureChannel(p.id));
  }, [parts, mixer]);

  useEffect(() => {
    if (!mixer.selectedChannelId && parts[0]) {
      mixer.setSelectedChannel(parts[0].id);
    }
  }, [parts, mixer]);

  const handleVolumeChange = useCallback((partId: string, vol: number) => {
    dm.setPartVolume(partId, vol);
    AudioEngine.setChannelVolume(partId, vol);
  }, [dm]);

  const handlePanChange = useCallback((partId: string, pan: number) => {
    dm.setPartPan(partId, pan);
    AudioEngine.setChannelPan(partId, pan);
  }, [dm]);

  const handleSendChange = useCallback((partId: string, bus: "reverb" | "delay", level: number) => {
    mixer.setChannelSend(partId, bus, level);
    AudioEngine.setChannelSend(partId, bus, level);
  }, [mixer]);

  const handleMasterVolume = useCallback((vol: number) => {
    mixer.setMasterVolume(vol);
    AudioEngine.setMasterVolume(vol);
  }, [mixer]);

  // Sidechain-Einstellungen an AudioEngine weitergeben wenn sie sich ändern
  useEffect(() => {
    Object.entries(mixer.sidechains).forEach(([partId, sc]) => {
      AudioEngine.setSidechainSettings(partId, sc);
    });
  }, [mixer.sidechains]);

  const handleReturnVolume = useCallback((id: "reverb" | "delay", vol: number) => {
    mixer.setReturnTrackVolume(id, vol);
    AudioEngine.setReturnTrackVolume(id, mixer.returnTracks[id].muted ? 0 : vol);
  }, [mixer]);

  const handleReturnMuted = useCallback((id: "reverb" | "delay", muted: boolean) => {
    mixer.setReturnTrackMuted(id, muted);
    AudioEngine.setReturnTrackVolume(id, muted ? 0 : mixer.returnTracks[id].volume);
  }, [mixer]);

  const [showSpectrum, setShowSpectrum] = useState(true);
  const [busCompEnabled, setBusCompEnabled] = useState(false);
  const [busCompSettings, setBusCompSettings] = useState({
    threshold: -18, ratio: 4, attack: 0.005, release: 0.1, makeup: 0,
  });

  // Bus Compressor synchronisieren
  useEffect(() => {
    AudioEngine.setBusCompressor({ enabled: busCompEnabled, ...busCompSettings });
  }, [busCompEnabled, busCompSettings]);

  // Insert Chains an AudioEngine weitergeben wenn sie sich ändern
  useEffect(() => {
    Object.entries(mixer.insertChains).forEach(([partId, chain]) => {
      AudioEngine.applyInsertChain(partId, chain as Array<{type: string; params: Record<string, number|string|boolean>; enabled: boolean}>);
    });
  }, [mixer.insertChains]);

  // v3.44.0 (TASK-239 Phase 1): Plugin-Slots an AudioEngine weitergeben.
  // applyPluginSlot ist defensive — bei null wird der Slot entfernt, bei
  // unbekannter pluginId wird gewarnt aber nichts crasht.
  useEffect(() => {
    Object.entries(mixer.pluginSlots).forEach(([partId, slot]) => {
      AudioEngine.applyPluginSlot(partId, slot ?? null);
    });
  }, [mixer.pluginSlots]);

  // Param-Updates aus dem Store werden direkt an die laufende Plugin-Instanz
  // weitergegeben damit Slider-Drag keine Re-Wiring-Latenz verursacht.
  useEffect(() => {
    Object.entries(mixer.pluginSlots).forEach(([partId, slot]) => {
      if (!slot) return;
      for (const [paramId, value] of Object.entries(slot.params)) {
        AudioEngine.setPluginParam(partId, paramId, value);
      }
    });
  }, [mixer.pluginSlots]);

  return (
    <div className={`relative flex flex-col h-full bg-bg-base overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-color bg-bg-panel flex-wrap">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Mixer</span>
        <span className="text-[10px] text-text-dim">{parts.length} Kanäle</span>

        {/* Add Audio Track (Vocals/Songs) */}
        <button
          type="button"
          onClick={handleAddAudioTrack}
          disabled={audioTracks.length >= MAX_AUDIO_TRACKS}
          aria-label="Audio Track hinzufügen"
          title={
            audioTracks.length >= MAX_AUDIO_TRACKS
              ? `Max ${MAX_AUDIO_TRACKS} audio tracks reached`
              : "Audio-Datei (Vocals, Song) als Track laden"
          }
          className="px-2 py-0.5 text-[10px] rounded border border-accent-secondary/50 text-accent-secondary bg-accent-secondary/10 hover:bg-accent-secondary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Audio Track
          <span className="ml-1 text-text-dim">
            ({audioTracks.length}/{MAX_AUDIO_TRACKS})
          </span>
        </button>

        {/* Add Live-Input (USB-Audio von KORG-Hardware etc., TASK-233 / v2.85) */}
        <button
          type="button"
          onClick={() => {
            if (liveInputChannels.length >= MAX_LIVE_INPUT_CHANNELS) {
              setAddError(`Max ${MAX_LIVE_INPUT_CHANNELS} Live-Input-Kanäle erreicht`);
              return;
            }
            try {
              addLiveInputChannel();
            } catch (err) {
              setAddError(err instanceof Error ? err.message : "Konnte Live-Input nicht anlegen");
            }
          }}
          disabled={liveInputChannels.length >= MAX_LIVE_INPUT_CHANNELS}
          data-testid="mixer-add-live-input"
          aria-label="Live-Input hinzufügen"
          title={
            liveInputChannels.length >= MAX_LIVE_INPUT_CHANNELS
              ? `Max ${MAX_LIVE_INPUT_CHANNELS} Live-Input-Kanäle erreicht`
              : "USB-Audio-Eingang als Mixer-Channel (Outboard-FX-Modus)"
          }
          className="px-2 py-0.5 text-[10px] rounded border border-accent-primary/50 text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          + Live Input
          <span className="ml-1 text-text-dim">
            ({liveInputChannels.length}/{MAX_LIVE_INPUT_CHANNELS})
          </span>
          <ProLockBadge feature={PRO_FEATURE_USB_AUDIO_IN} />
        </button>

        {/* Time-Stretch Counter (TASK-121) – nur sichtbar, wenn Audio-Tracks existieren */}
        {audioTracks.length > 0 && (() => {
          const tsCount = countTimestretchTracks();
          const tsColor =
            tsCount >= MAX_TIMESTRETCH_TRACKS
              ? "text-accent-danger"
              : tsCount >= MAX_TIMESTRETCH_TRACKS - 1
                ? "text-accent-secondary"
                : "text-text-dim";
          return (
            <span
              data-testid="timestretch-counter"
              className={`text-[10px] font-mono ml-2 ${tsColor}`}
              title={
                tsCount >= MAX_TIMESTRETCH_TRACKS
                  ? `Limit erreicht: ${tsCount}/${MAX_TIMESTRETCH_TRACKS} Time-Stretch-Tracks aktiv (CPU-Schutz).`
                  : `Aktive Time-Stretch-Tracks: ${tsCount}/${MAX_TIMESTRETCH_TRACKS}`
              }
            >
              Time-Stretch: {tsCount}/{MAX_TIMESTRETCH_TRACKS}
            </span>
          );
        })()}

        {/* Hidden file input (Browser-Fallback) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a"
          multiple
          onChange={handleBrowserFileInput}
          className="hidden"
          aria-hidden="true"
        />

        {/* Bus Compressor Toggle */}
        <button
          onClick={() => setBusCompEnabled(p => !p)}
          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${busCompEnabled ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-color text-text-dim hover:text-text-primary"}`}
          title="Bus Kompressor (Drum Bus)"
        >
          🗜 Bus Comp
        </button>

        <button
          onClick={() => setShowSpectrum(p => !p)}
          className={`ml-auto px-2 py-0.5 text-[10px] rounded border transition-colors ${showSpectrum ? "border-accent-secondary text-accent-secondary" : "border-border-color text-text-dim hover:text-text-primary"}`}
          title="Spectrum Analyzer ein/ausblenden"
        >
          ▶▶ Spectrum
        </button>

        {/* Pin / Detach (Multi-Window-Workspace, post-v1.26.0). Nur Electron.
            Öffnet den Mixer in einem eigenen Fenster für Multi-Monitor-Workflow. */}
        {electron.isElectron && (
          <button
            type="button"
            onClick={() => electron.openMixerWindow?.()}
            data-testid="mixer-open-in-window"
            className="px-2 py-0.5 text-[10px] rounded border border-border-color text-text-dim hover:text-accent-primary hover:border-accent-primary transition-colors"
            title="Mixer in eigenes Fenster abkoppeln"
          >
            📌 Pin
          </button>
        )}
      </div>

      {/* Bus Compressor Settings */}
      {busCompEnabled && (
        <div className="px-4 py-2 bg-bg-panel border-b border-border-color flex items-center gap-4 flex-wrap">
          <span className="text-[10px] font-bold text-accent-primary uppercase tracking-wide">Bus Comp</span>
          {(["threshold", "ratio", "attack", "release", "makeup"] as const).map(key => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-dim capitalize">{key}</span>
              <input type="range"
                min={key === "threshold" ? -60 : key === "ratio" ? 1 : key === "makeup" ? -6 : 0.001}
                max={key === "threshold" ? 0 : key === "ratio" ? 20 : key === "makeup" ? 12 : key === "attack" ? 0.1 : 1}
                step={key === "threshold" || key === "makeup" ? 0.5 : 0.001}
                value={busCompSettings[key]}
                onChange={e => setBusCompSettings(p => ({ ...p, [key]: Number(e.target.value) }))}
                className="w-16 accent-accent-primary"
              />
              <span className="text-[10px] font-mono text-text-muted w-10">
                {key === "threshold" || key === "makeup" ? `${busCompSettings[key].toFixed(1)}dB` :
                 key === "ratio" ? `${busCompSettings[key].toFixed(1)}:1` :
                 `${(busCompSettings[key] * 1000).toFixed(0)}ms`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Spectrum Analyzer */}
      {showSpectrum && (
        <div className="px-3 pt-2 pb-1 bg-bg-base border-b border-border-color">
          <SpectrumDisplay />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Channel Strips */}
        <div
          className="flex-1 overflow-x-auto overflow-y-hidden"
          onDragOver={(e) => {
            // Nur Audio-Dateien? Drop akzeptieren.
            const hasFiles = e.dataTransfer.types.includes("Files");
            if (hasFiles) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={async (e) => {
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length === 0) return;
            // Nur Audio-Dateien filtern – andere ans existing-Sample-Browser-Verhalten weiterreichen
            const audio = files.filter((f) => /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i.test(f.name) || f.type.startsWith("audio/"));
            if (audio.length === 0) return;
            e.preventDefault();
            e.stopPropagation();
            for (const f of audio) {
              if (getAllAudioTracks().length >= MAX_AUDIO_TRACKS) {
                setAddError(`Max ${MAX_AUDIO_TRACKS} audio tracks reached`);
                break;
              }
              await ingestAudioFile({ kind: "file", file: f });
            }
          }}
        >
          <div className="flex h-full items-stretch">
            {parts.map(part => {
              const ch = mixer.channels[part.id];
              return (
                <MixerChannel
                  key={part.id}
                  partId={part.id}
                  name={part.name}
                  volume={part.volume}
                  pan={part.pan}
                  muted={part.muted}
                  soloed={part.soloed}
                  sendReverb={ch?.sends.reverb ?? 0}
                  sendDelay={ch?.sends.delay ?? 0}
                  peakLevel={ch?.peakLevel ?? 0}
                  selected={selectedPart?.id === part.id}
                  onSelect={() => mixer.setSelectedChannel(part.id)}
                  onVolumeChange={vol => handleVolumeChange(part.id, vol)}
                  onPanChange={pan => handlePanChange(part.id, pan)}
                  onMuteToggle={() => dm.setPartMuted(part.id, !part.muted)}
                  onSoloToggle={(e) => dm.setPartSoloed(part.id, !part.soloed, !e.shiftKey)}
                  onSendChange={(bus, level) => handleSendChange(part.id, bus, level)}
                />
              );
            })}

            {/* Audio-Track Channel-Strips (Vocals/Songs) */}
            {audioTracks.map(track => (
              <AudioTrackStrip
                key={track.id}
                track={track}
                runtime={getRuntimeState(track.id)}
                isPlaying={AudioEngine.isPlaying}
              />
            ))}

            {/* Live-Input-Channel-Strips (USB-Audio von KORG etc., TASK-233) */}
            {liveInputChannels.map(ch => (
              <LiveInputStrip key={ch.id} channel={ch} />
            ))}

            {/* Master-Kanal */}
            <MixerChannel
              partId="__master__"
              name="Master"
              volume={mixer.masterVolume}
              pan={0}
              muted={false}
              soloed={false}
              sendReverb={0}
              sendDelay={0}
              peakLevel={0}
              isMaster
              onVolumeChange={handleMasterVolume}
              onPanChange={() => {}}
              onMuteToggle={() => {}}
              onSoloToggle={() => {}}
              onSendChange={() => {}}
            />
          </div>
        </div>

      </div>

      {/* Bus-Labels */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-1 border-t border-border-color bg-bg-panel">
        {(["reverb", "delay"] as const).map(id => {
          const track = mixer.returnTracks[id];
          return (
            <div key={id} className="flex items-center gap-2 text-[9px] uppercase tracking-wide">
              <button
                type="button"
                onClick={() => handleReturnMuted(id, !track.muted)}
                className={track.muted ? "text-text-dim" : id === "reverb" ? "text-accent-secondary" : "text-accent-primary"}
              >
                {track.muted ? "Muted" : track.name}
              </button>
              <input
                aria-label={`${track.name} Volume`}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={track.volume}
                onChange={e => handleReturnVolume(id, parseFloat(e.target.value))}
                className={id === "reverb" ? "w-24 accent-accent-secondary" : "w-24 accent-accent-primary"}
              />
            </div>
          );
        })}
      </div>

      {/* Export Panel */}
      {/* v3.42: insertChains wird durchgereicht damit Stem-Bounce die User-Inserts nutzt. */}
      <ExportPanel
        pattern={pattern}
        bpm={bpm}
        samples={samples}
        allPatterns={dm.patterns}
        projectName={projectName}
        insertChains={mixer.insertChains}
      />

      {/* Audio-Track Error Toast (z.B. Max-Limit) */}
      {addError && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-4 right-4 px-3 py-2 rounded border border-accent-danger/50 bg-bg-elevated text-accent-danger text-xs shadow-lg pointer-events-none"
        >
          {addError}
        </div>
      )}
    </div>
  );
}

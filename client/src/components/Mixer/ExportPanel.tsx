/**
 * Synthstudio – ExportPanel
 *
 * WAV/Stems Export-Panel im Mixer-View.
 * Rendert das Pattern via OfflineAudioContext und downloadet die Datei.
 */
import React, { useCallback, useState } from "react";
import { exportPattern, type ExportProgress } from "@/utils/wavExporter";
import { downloadMidiBundle } from "@/utils/midiExport";
import {
  bounceAllChannels,
  bundleStemResultsToZip,
  downloadAudioInBrowser,
  type BounceAllProgress,
} from "@/utils/channelBounce";
import {
  SUPPORTED_OGG_BITRATES_BPS,
  DEFAULT_OGG_BITRATE_BPS,
  type CompressFormat,
} from "@/utils/audioCompressEncoder";
import { useElectron } from "../../../../electron/useElectron";
import { toast } from "@/store/useToastStore";
import { requireProFeature, PRO_FEATURE_STEM_BOUNCE } from "@/utils/proFeatures";
import { ProLockBadge } from "@/components/License/ProLockBadge";
import type { PatternData } from "@/audio/AudioEngine";
import type { Sample } from "@/store/useProjectStore";
import type { MixerFxSlot } from "@/utils/mixerFx";

interface ExportPanelProps {
  pattern: PatternData | undefined;
  bpm: number;
  samples: Sample[];
  allPatterns?: PatternData[];
  projectName?: string;
  /**
   * v3.42: Pass-Through der User-konfigurierten Insert-Chains pro Part
   * (Bitcrusher/RingMod/Transient). Wird an bounceAllChannels durchgereicht
   * damit Stem-Bounce die richtige Fidelity erreicht.
   */
  insertChains?: Record<string, MixerFxSlot[]>;
}

export function ExportPanel({ pattern, bpm, samples, allPatterns = [], projectName = "Synthstudio", insertChains }: ExportPanelProps) {
  const [mode, setMode]       = useState<"master" | "stems">("master");
  const [bars, setBars]       = useState(4);
  const [sampleRate, setSr]   = useState<44100 | 48000>(44100);
  // v3.83.0 — Format-Auswahl (wav default backward-compat, ogg = Opus compressed)
  const [format, setFormat]   = useState<CompressFormat>("wav");
  const [bitrate, setBitrate] = useState<number>(DEFAULT_OGG_BITRATE_BPS);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  // TASK-241 / v2.94.0: Per-Channel Stem-Bounce (mit Pan + Filter + Volume).
  const electron = useElectron();
  const [isBouncingAll, setIsBouncingAll] = useState(false);
  const [bounceAllMsg, setBounceAllMsg] = useState<string | null>(null);
  // v3.85.0: ZIP-Bundle vs. Einzeldownloads. Default = ZIP für bessere UX.
  const [bundleAsZip, setBundleAsZip] = useState(true);

  const handleBounceAllStems = useCallback(async () => {
    if (!pattern || isBouncingAll) return;
    // TASK-232 (v2.97): Stem-Bounce ist ein Pro-Feature.
    if (!requireProFeature(PRO_FEATURE_STEM_BOUNCE)) return;
    setIsBouncingAll(true);
    setBounceAllMsg("Lade Sample-Buffer…");
    try {
      // Sample-Buffers vorladen
      const bufMap = new Map<string, AudioBuffer>();
      const ctx = new AudioContext();
      try {
        await Promise.all(
          pattern.parts
            .filter(p => p.sampleUrl)
            .map(async p => {
              try {
                const resp = await fetch(p.sampleUrl!);
                const ab = await resp.arrayBuffer();
                const buf = await ctx.decodeAudioData(ab);
                bufMap.set(p.sampleUrl!, buf);
              } catch { /* ignore */ }
            }),
        );
      } finally {
        await ctx.close().catch(() => {});
      }

      const results = await bounceAllChannels(
        pattern.parts,
        pattern,
        bufMap,
        {
          length: { mode: "currentLoop", bars },
          bpm,
          sampleRate,
          channels: 2,
          // v3.84.0: Format-Option (WAV oder OGG-Opus) durchreichen.
          format: format === "ogg" ? "ogg-opus" : "wav",
          bitrate,
        },
        projectName,
        (p: BounceAllProgress) => {
          if (p.phase === "rendering") {
            setBounceAllMsg(`Render ${p.current + 1}/${p.total}: ${p.channelName}…`);
          } else if (p.phase === "done") {
            setBounceAllMsg("Speichere…");
          } else if (p.phase === "error") {
            setBounceAllMsg(`Fehler bei ${p.channelName}: ${p.error}`);
          }
        },
        undefined, // OfflineCtxCtor — Default = globaler OfflineAudioContext
        // v3.42: insertChains-Map durchreichen damit User-Inserts wirken.
        insertChains ?? null,
      );

      // v3.85.0: Optional ZIP-Bundle aller Stems statt N Einzeldownloads.
      if (bundleAsZip && results.length > 0) {
        setBounceAllMsg("Bundle ZIP…");
        const bundle = await bundleStemResultsToZip(results, {
          projectName,
          format: format === "ogg" ? "ogg-opus" : "wav",
          sampleRate,
          bitrate: format === "ogg" ? bitrate : undefined,
        });
        const mb = (bundle.byteSize / (1024 * 1024)).toFixed(1);
        if (electron.isElectron) {
          const safe = bundle.filename.replace(/[^A-Za-z0-9._-]/g, "_");
          const res = await electron.saveRecording(safe, bundle.zip);
          if (res.success) {
            toast(`ZIP mit ${bundle.stemCount} Stems gespeichert (${mb} MB)`, { kind: "success" });
          } else {
            toast("ZIP-Speicherung fehlgeschlagen", { kind: "error" });
          }
        } else {
          downloadAudioInBrowser(bundle.zip, bundle.filename, "application/zip");
          toast(`ZIP mit ${bundle.stemCount} Stems erstellt (${mb} MB)`, { kind: "success" });
        }
      } else {
        // Legacy-Pfad: Einzeldownloads pro Channel.
        let savedCount = 0;
        for (const r of results) {
          if (electron.isElectron) {
            const safe = r.filename.replace(/[^A-Za-z0-9._-]/g, "_");
            const res = await electron.saveRecording(safe, r.data);
            if (res.success) savedCount++;
          } else {
            // v3.84.0: Format-aware Download — nutzt r.mimeType statt hardcoded audio/wav.
            downloadAudioInBrowser(r.data, r.filename, r.mimeType);
            savedCount++;
          }
        }
        toast(`${savedCount}/${results.length} Stems gespeichert`, { kind: "success" });
      }
      setBounceAllMsg(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Bounce All fehlgeschlagen: ${msg}`, { kind: "error" });
      setBounceAllMsg(`Fehler: ${msg}`);
    } finally {
      setIsBouncingAll(false);
    }
  }, [pattern, bars, bpm, sampleRate, projectName, electron, isBouncingAll, insertChains, format, bitrate, bundleAsZip]);

  const handleExport = useCallback(async () => {
    if (!pattern || isExporting) return;
    setIsExporting(true);
    setProgress({ phase: "rendering", progress: 0, message: "Vorbereitung…" });

    // Sample-Buffers vorladen
    const bufMap = new Map<string, AudioBuffer>();
    const ctx = new AudioContext();
    await Promise.all(
      pattern.parts
        .filter(p => p.sampleUrl)
        .map(async p => {
          try {
            const resp = await fetch(p.sampleUrl!);
            const ab   = await resp.arrayBuffer();
            const buf  = await ctx.decodeAudioData(ab);
            bufMap.set(p.sampleUrl!, buf);
          } catch { /* ignore unavailable samples */ }
        })
    );

    await exportPattern(
      pattern,
      bufMap,
      { mode, bars, bpm, sampleRate, bitDepth: 16, format, bitrate },
      setProgress,
    );
    setIsExporting(false);
  }, [pattern, isExporting, mode, bars, bpm, sampleRate, format, bitrate]);

  if (!pattern) return null;

  const pct = progress ? Math.round(progress.progress * 100) : 0;

  return (
    <div className="border-t border-border-color p-4 bg-bg-panel flex-shrink-0">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Export</span>

        {/* Modus */}
        <div className="flex gap-1">
          {(["master", "stems"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${mode === m ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-color text-text-dim hover:text-text-primary"}`}>
              {m === "master" ? "Master Mix" : "Stems"}
            </button>
          ))}
        </div>

        {/* Bars */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Bars:</span>
          <select value={bars} onChange={e => setBars(Number(e.target.value))}
            className="text-[10px] bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary">
            {[1,2,4,8,16].map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {/* Sample Rate */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Hz:</span>
          <select value={sampleRate} onChange={e => setSr(Number(e.target.value) as 44100 | 48000)}
            className="text-[10px] bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary">
            <option value={44100}>44100</option>
            <option value={48000}>48000</option>
          </select>
        </div>

        {/* v3.83.0 — Format-Selector (WAV / OGG-Opus) */}
        <div className="flex items-center gap-1" data-testid="export-format-group">
          <span className="text-[10px] text-text-dim">Format:</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as CompressFormat)}
            className="text-[10px] bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary"
            data-testid="export-format-select"
          >
            <option value="wav">WAV</option>
            <option value="ogg">OGG (Opus)</option>
          </select>
        </div>

        {/* v3.83.0 — Bitrate-Slider (nur sichtbar bei ogg) */}
        {format === "ogg" && (
          <div className="flex items-center gap-1" data-testid="export-bitrate-group">
            <span className="text-[10px] text-text-dim">Kbps:</span>
            <select
              value={bitrate}
              onChange={(e) => setBitrate(Number(e.target.value))}
              className="text-[10px] bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary"
              data-testid="export-bitrate-select"
            >
              {SUPPORTED_OGG_BITRATES_BPS.map((bps) => (
                <option key={bps} value={bps}>{bps / 1000}</option>
              ))}
            </select>
          </div>
        )}

        {/* Export Buttons */}
        <button onClick={handleExport} disabled={isExporting}
          className="px-3 py-1 text-[10px] rounded bg-accent-primary text-white hover:opacity-80 disabled:opacity-40 font-bold transition-opacity">
          {isExporting ? "Exportiere…" : format === "ogg" ? "⬇ OGG Export" : "⬇ WAV Export"}
        </button>
        <button
          onClick={() => downloadMidiBundle(allPatterns.length > 0 ? allPatterns : (pattern ? [pattern] : []), bpm, projectName)}
          disabled={!pattern}
          className="px-3 py-1 text-[10px] rounded bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/40 hover:bg-accent-secondary/30 disabled:opacity-40 font-bold transition-colors"
          title="Alle Patterns als MIDI-Bundle exportieren (.mid)"
        >
          🎵 MIDI Export
        </button>
        {/* v3.85.0 — Bundle-Modus Toggle: ZIP (default) oder Single-Files */}
        <div className="flex items-center gap-1" data-testid="export-bundle-mode-group">
          <span className="text-[10px] text-text-dim">Pack:</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setBundleAsZip(true)}
              className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                bundleAsZip
                  ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                  : "border-border-color text-text-dim hover:text-text-primary"
              }`}
              data-testid="export-bundle-zip"
              title="Alle Stems in einer ZIP-Datei bundeln (mit manifest.json)"
            >
              ZIP-Bundle
            </button>
            <button
              type="button"
              onClick={() => setBundleAsZip(false)}
              className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                !bundleAsZip
                  ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                  : "border-border-color text-text-dim hover:text-text-primary"
              }`}
              data-testid="export-bundle-single"
              title="Jeden Channel als separate Datei herunterladen"
            >
              Einzeldateien
            </button>
          </div>
        </div>

        {/* TASK-241 / v2.94.0: Per-Channel Stems mit Pan + Filter */}
        <button
          onClick={handleBounceAllStems}
          disabled={!pattern || isBouncingAll}
          className="relative px-3 py-1 text-[10px] rounded border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/10 disabled:opacity-40 font-bold transition-colors inline-flex items-center gap-1.5"
          title={`Per-Channel Stem-Bounce: jeden Channel separat als ${format === "ogg" ? "OGG" : "WAV"} (inkl. Pan, Volume, Filter)${bundleAsZip ? " — als ZIP-Bundle" : ""}`}
          data-testid="export-bounce-all-stems"
        >
          {isBouncingAll
            ? "Bouncing…"
            : `🎬 Bounce All Stems${format === "ogg" ? " (OGG)" : ""}${bundleAsZip ? " → ZIP" : ""}`}
          <ProLockBadge feature={PRO_FEATURE_STEM_BOUNCE} />
        </button>
      </div>
      {bounceAllMsg && (
        <div className="mt-2 text-[10px] text-text-muted" data-testid="export-bounce-all-status">
          {bounceAllMsg}
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-text-dim mb-1">
            <span>{progress.message}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1 bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: progress.phase === "error" ? "var(--ss-accent-danger)"
                  : progress.phase === "done"  ? "var(--ss-accent-success)"
                  : "var(--ss-accent-primary)",
              }} />
          </div>
          {progress.error && <div className="text-[10px] text-accent-danger mt-1">{progress.error}</div>}
        </div>
      )}
    </div>
  );
}

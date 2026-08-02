/**
 * client/src/utils/e2ExportGuide.ts
 *
 * v3.314 — Zuweisungsdatei für den Sequenzer→E2-Export.
 *
 * Der `.e2spat`/`.e2sallpat`-Export trägt Trigger, Velocity, Note, Volume,
 * Pan und Mute — aber NICHT: welches Sample auf welchem Part liegt (die E2S
 * nutzt ihre eigene Sample-Bank), und keine der Synthstudio-Channel-FX
 * (Filter/Distortion/Compressor/Delay/Reverb/EQ laufen in der WebAudio-Engine
 * und haben kein Byte-Feld im Pattern-Format). Diese Markdown-Datei listet
 * pro Part alles auf, was am Gerät von Hand nachgebaut werden muss —
 * analog zur FX-Zuweisung des ESX-Imports (v3.313).
 *
 * Reine TS-Logik (kein DOM) — testbar in Node.
 */

import type { PatternData, PartData, ChannelFx } from "../audio/AudioEngine";
import { synthVolumeToE2, synthPanToE2 } from "./electribePatternConvert";

/** Ein aktivierter Channel-FX als Zeile "Name (Params) — E2-Vorschlag". */
function fxLines(fx: ChannelFx | undefined): string[] {
  if (!fx) return [];
  const out: string[] = [];
  if (fx.filterEnabled) {
    const type =
      fx.filterType === "highpass"
        ? "HPF"
        : fx.filterType === "bandpass"
          ? "BPF"
          : fx.filterType === "notch"
            ? "Notch"
            : "LPF";
    out.push(
      `Filter ${type} @ ${Math.round(fx.filterFreq)} Hz, Q ${fx.filterQ.toFixed(1)}` +
        ` — E2: Part-Filter (${type === "HPF" ? "HPF" : "LPF"}-Typ, Cutoff/Reso)`
    );
  }
  if (fx.distortionEnabled) {
    out.push(
      `Distortion (Drive ${Math.round(fx.distortionAmount)}) — E2: IFX Distortion`
    );
  }
  if (fx.compressorEnabled) {
    out.push(
      `Compressor (Thr ${fx.compressorThreshold} dB, Ratio ${fx.compressorRatio}:1)` +
        ` — E2: IFX Compressor`
    );
  }
  if (fx.delayEnabled) {
    out.push(
      `Delay (${(fx.delayTime * 1000).toFixed(0)} ms, FB ${(fx.delayFeedback * 100).toFixed(0)} %,` +
        ` Mix ${(fx.delayMix * 100).toFixed(0)} %) — E2: IFX BPM Sync Delay / Tape Echo`
    );
  }
  if (fx.reverbEnabled) {
    out.push(
      `Reverb (Decay ${fx.reverbDecay.toFixed(1)} s, Mix ${(fx.reverbMix * 100).toFixed(0)} %)` +
        ` — E2: MFX Hall/Plate + MFX-Send AN`
    );
  }
  if (fx.eqEnabled) {
    out.push(
      `EQ (Low ${fx.eqLow > 0 ? "+" : ""}${fx.eqLow} / Mid ${fx.eqMid > 0 ? "+" : ""}${fx.eqMid}` +
        ` / High ${fx.eqHigh > 0 ? "+" : ""}${fx.eqHigh} dB) — E2: IFX 2-Band EQ`
    );
  }
  return out;
}

function partHasActivity(part: PartData | undefined): boolean {
  return !!part && (part.steps ?? []).some((s) => s?.active);
}

function sourceLabel(part: PartData): string {
  if (part.sampleName) return part.sampleName;
  if (part.sourceType && part.sourceType !== "sample")
    return `[${part.sourceType}-Synth]`;
  return "—";
}

/**
 * Baut die Zuweisungs-Markdown für einen Sequenzer→E2-Export.
 * `patterns` = die exportierten Patterns in Bank-Reihenfolge (Slot 1..n).
 */
export function buildE2ExportGuide(
  patterns: PatternData[],
  opts?: { title?: string }
): string {
  const lines: string[] = [];
  lines.push(`# ${opts?.title ?? "Synthstudio → E2 Sampler"} — Zuweisung`);
  lines.push("");
  lines.push(
    "Das Pattern-Format trägt Trigger/Velocity/Note/Volume/Pan/Mute. NICHT"
  );
  lines.push(
    "übertragen werden: Sample-Zuordnung (die E2S spielt ihre eigene Bank)"
  );
  lines.push(
    "und die Synthstudio-Channel-FX. Diese Liste zum Nachbauen am Gerät:"
  );
  lines.push("");

  let any = false;
  patterns.forEach((pattern, idx) => {
    const parts = (pattern.parts ?? []).filter(partHasActivity);
    if (parts.length === 0) return;
    any = true;
    const bpm = typeof pattern.bpm === "number" ? ` · ${pattern.bpm} BPM` : "";
    lines.push(`## Pattern ${idx + 1}${pattern.name ? ` „${pattern.name}"` : ""}${bpm}`);
    lines.push("");
    lines.push("| Part | Sound | Level (E2) | Pan (E2) | Nachbauen |");
    lines.push("|---:|---|---:|---:|---|");
    (pattern.parts ?? []).forEach((part, pi) => {
      if (!partHasActivity(part)) return;
      const fx = fxLines(part.fx);
      const extra: string[] = [...fx];
      if (part.stretchRatio && part.stretchRatio !== 1)
        extra.push(`Time-Stretch ×${part.stretchRatio}`);
      if (part.microTiming)
        extra.push(`Micro-Timing ${part.microTiming > 0 ? "+" : ""}${part.microTiming} ms`);
      lines.push(
        `| ${pi + 1} | ${sourceLabel(part)} | ${synthVolumeToE2(part.volume)} | ` +
          `${synthPanToE2(part.pan)} | ${extra.length ? extra.join("; ") : "—"} |`
      );
    });
    lines.push("");
  });

  if (!any) {
    lines.push("_Keine Parts mit aktiven Steps im Export._");
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Bietet die Zuweisung als `.md`-Download an (Browser UND Electron — beide
 * rendern in Chromium, der Anchor-Download funktioniert in beiden). Ohne DOM
 * (Node-Testkontext) ein No-op, damit die reine Guide-Logik testbar bleibt.
 */
export function downloadGuideMarkdown(filename: string, text: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

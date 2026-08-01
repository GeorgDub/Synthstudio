/**
 * esxToE2sBank.ts — Direkt-Converter KORG ESX-1 (.esx) → Electribe 2 Sampler.
 *
 * Produziert aus einem geparsten ESX-1-Backup beides zum Import auf die E2S:
 *   - `.e2sallpat` Pattern-Bank (250 Slots), Parts auf User-Sample-Nummern (501+)
 *     repointet → spielen direkt die mit-konvertierten Samples.
 *   - `.all` Sample-Bank: die von den Patterns genutzten Samples, nummeriert ab
 *     501 (OSC_0index +0x08 + +0x56), korrekt mit WAV_dataSize/playLogPeriod/UFix.
 *
 * Reine TS-Logik (kein DOM) — die UI (EsxToE2sConverter) lädt nur die ESX-Datei
 * und bietet die zurückgegebenen Bytes als Download an.
 *
 * Verknüpfung Pattern↔Sample über die ESX-Sample-Slot-ID (Part.sampleId ==
 * EsxSample.index). Nur Samples, die ein Part mit aktiven Steps triggert, werden
 * exportiert; bei Überschreiten des E2S-Sample-RAMs (~270s mono) werden die
 * überzähligen weggelassen (Report) — das verhindert den "Import-Fehler".
 */

import { esxFxTypeName } from "./esxParser";
import type { EsxBank, EsxPattern, EsxSample } from "./esxParser";
import { buildE2sBank, type E2sSlotInput } from "./e2sBankBuilder";
import { buildE2AllPatFile } from "../e2sExport";
import { verifyE2AllpatBank } from "./e2AllpatVerify";
import type { E2PatternInput } from "../electribePatternBuilder";

/** E2S User-Sample-Nummerierung beginnt bei 501 (Factory 1..~500). */
export const E2S_USER_SAMPLE_BASE = 501;
/** Sicherer Mono-Sekunden-Deckel fürs Sample-RAM (Hardware ~270s mono). */
export const E2S_SAMPLE_SECONDS_CAP = 260;
/** MIDI-Note für "keine Tonhöhenänderung" (C5). */
const E2_BASE_NOTE = 0x48;

export interface EsxToE2sResult {
  /** .e2sallpat-Bytes (4 161 792). */
  allpat: Uint8Array;
  /** .all-Sample-Bank-Bytes. */
  all: Uint8Array;
  /** Mapping/Anleitung (Markdown). */
  mapping: string;
  stats: {
    patterns: number;
    samples: number;
    droppedSamples: number;
    audioSeconds: number;
    activeParts: number;
    linkedParts: number;
  };
}

export interface EsxToE2sOptions {
  userSampleBase?: number;
  secondsCap?: number;
}

/** Linearer Mono-Resampler (dependency-frei). */
function resampleMono(pcm: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(pcm.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = pcm[i0] * (1 - frac) + pcm[i1] * frac;
  }
  return out;
}

function esxStepLengthToE2(lengthSteps: number): 16 | 32 | 64 {
  return lengthSteps === 32 ? 32 : lengthSteps === 64 ? 64 : 16;
}

/**
 * Konvertiert ein geparstes ESX-1-Backup in E2S-Bank-Dateien.
 */
export function convertEsxToE2sBank(
  esx: EsxBank,
  opts: EsxToE2sOptions = {},
): EsxToE2sResult {
  const base = opts.userSampleBase ?? E2S_USER_SAMPLE_BASE;
  const secondsCap = opts.secondsCap ?? E2S_SAMPLE_SECONDS_CAP;

  // 1) Nicht-leere Patterns (Name ODER mind. ein aktiver Step), max 250.
  const selected = esx.patterns
    .filter(
      (p) =>
        (p.name && p.name.trim().length > 0) ||
        p.parts.some((pt) => pt.steps.some((s) => s.active)),
    )
    .slice(0, 250);

  // 2) Nur Samples, die ein Part mit aktiven Steps triggert.
  const usedIndices = new Set<number>();
  for (const p of selected) {
    for (const part of p.parts) {
      if (part.steps.some((s) => s.active)) usedIndices.add(part.sampleId);
    }
  }

  // 3) Sample-Liste aufbauen, gedeckelt aufs Sample-RAM (mono-Sekunden).
  //    Mono = Sekunden, Stereo = 2× (interner Speicher-Daumenwert).
  const sampleMap = new Map<number, { hwNumber: number; name: string }>();
  const slots: E2sSlotInput[] = [];
  let audioSeconds = 0;
  let droppedSamples = 0;
  let nextSlot = 0;
  for (const s of esx.monoSamples as EsxSample[]) {
    if (!usedIndices.has(s.index)) continue;
    if (nextSlot >= 250) {
      droppedSamples++;
      continue;
    }
    const seconds = s.sampleRate > 0 ? s.frames / s.sampleRate : 0;
    if (audioSeconds + seconds > secondsCap) {
      droppedSamples++;
      continue;
    }
    const targetRate = s.sampleRate === 48000 ? 48000 : 44100;
    const pcm = resampleMono(s.pcmData, s.sampleRate, targetRate);
    const name = (s.name && s.name.trim()) || `ESX ${s.index}`;
    const hwNumber = base + nextSlot;
    sampleMap.set(s.index, { hwNumber, name });
    slots.push({
      slotIndex: nextSlot,
      sampleNumber: hwNumber,
      category: 17, // "User"
      name,
      pcmData: pcm,
      sampleRate: targetRate,
      channels: 1,
    });
    audioSeconds += seconds;
    nextSlot++;
  }

  // 4) Patterns → E2PatternInput, Parts auf die User-Nummern repointen.
  let activeParts = 0;
  let linkedParts = 0;
  const e2Inputs: E2PatternInput[] = selected.map((p: EsxPattern) => {
    const stepLength = esxStepLengthToE2(p.lengthSteps);
    const parts = p.parts.map((part) => {
      const active = part.steps.some((s) => s.active);
      const mapped = sampleMap.get(part.sampleId);
      if (active) {
        activeParts++;
        if (mapped) linkedParts++;
      }
      const note = Math.max(0, Math.min(127, E2_BASE_NOTE + (part.pitch ?? 0)));
      return {
        volume: part.volume,
        pan: part.pan,
        // v3.312: Amp-EG-Zeit (ESX egtime) mitnehmen — sonst stehen alle
        // E2-Parts auf Decay 127 und kurze perkussive Hüllkurven gehen
        // verloren (Gerätebefund: Mix klingt anders als auf der ESX).
        egTime: part.egTime,
        sampleId: mapped ? mapped.hwNumber : undefined,
        // v3.288: Mute-Zustand aus dem ESX-Pattern in den E2-Export übernehmen.
        muted: part.muted === true,
        steps: part.steps.map((s) => ({
          active: !!s.active,
          velocity: typeof s.velocity === "number" ? s.velocity : undefined,
          accent: !!s.accent,
          note,
        })),
      };
    });
    return { name: p.name || "ESX Pattern", bpm: p.bpm, stepLength, parts };
  });

  // 5) Bytes bauen. v3.307: Struktur-Validierung gegen die stock-verifizierten
  // Invarianten — eine fehlerhafte Bank verlässt diesen Converter nicht mehr.
  const allpat = new Uint8Array(buildE2AllPatFile(e2Inputs));
  const verdict = verifyE2AllpatBank(allpat);
  if (!verdict.ok) {
    throw new Error(
      `ESX→E2S: gebaute .e2sallpat verletzt Bank-Invarianten — ${verdict.errors
        .slice(0, 3)
        .join("; ")}${verdict.errors.length > 3 ? ` (+${verdict.errors.length - 3} weitere)` : ""}`
    );
  }
  const all = new Uint8Array(buildE2sBank(slots).buffer);

  // 6) Mapping/Anleitung.
  const lines: string[] = [];
  lines.push("# ESX → KORG Electribe 2 Sampler — Import-Anleitung");
  lines.push("");
  lines.push(`Quelle: ${esx.source}`);
  lines.push("");
  lines.push("## Dateien");
  lines.push("- `*.all` → auf SD-Karte (Sample-Ordner), am Gerät importieren. User-Samples ab " + base + ".");
  lines.push("- `*.e2sallpat` → Pattern-Bank importieren. Parts zeigen bereits auf die Nummern.");
  lines.push("");
  lines.push(`## Stats`);
  lines.push(`- Patterns: ${selected.length}`);
  lines.push(`- Samples: ${slots.length} (${audioSeconds.toFixed(1)}s, Limit ~${secondsCap}s)` + (droppedSamples ? `, ${droppedSamples} wegen Speicher weggelassen` : ""));
  lines.push(`- Aktive Parts: ${activeParts}, davon mit Sample verlinkt: ${linkedParts}`);
  lines.push("");
  lines.push("## Sample-Liste (Geräte-Nr. → Name → ESX-Index)");
  lines.push("");
  lines.push("| Geräte-# | Name | ESX-Index |");
  lines.push("|---:|---|---:|");
  for (const [esxIdx, m] of [...sampleMap.entries()].sort((a, b) => a[1].hwNumber - b[1].hwNumber)) {
    lines.push(`| ${m.hwNumber} | ${m.name} | ${esxIdx} |`);
  }

  // v3.313: FX-Zuweisung — die ESX routet Parts insert-artig durch ihre 3
  // Master-FX; auf der E2S muss das pro Part von Hand (IFX) nachgebaut werden.
  // Ohne diese Liste klingen die betroffenen Parts trocken/leiser als im
  // Original (Geraetebefund 2026-08-01). v3.315: Regler-Labels statt roher
  // Edit1/Edit2-Zahlen; EQ als Low/High relativ zur Mitte (2-Band, KEIN Mid).
  const CHAIN_LABEL = ["keine Kette", "FX1→FX2", "FX2→FX3", "FX1→FX2→FX3"];
  // Edit1/Edit2-Beschriftungen lt. ESX-1-Manual; Typen ohne gesichertes
  // Label (Grain Shifter, Talking Mod) bleiben bei "Edit1/Edit2".
  const EDIT_LABELS: Record<number, [string, string]> = {
    0: ["Time", "Level"],
    1: ["Beat", "Depth"],
    2: ["Time", "Depth"],
    3: ["Time", "Depth"],
    5: ["Speed", "Depth"],
    6: ["Speed", "Depth"],
    7: ["Freq", "Balance"],
    9: ["Pitch", "Balance"],
    10: ["Sens", "Attack"],
    11: ["Gain", "Level"],
    12: ["Freq", "Balance"],
    14: ["Cutoff", "Reso"],
    15: ["Cutoff", "Reso"],
  };
  const eqBand = (val: number, band: string): string => {
    const d = val - 64; // 64 = Reglermitte = neutral
    const qual = Math.abs(d) <= 5 ? "≈neutral" : d > 0 ? "Boost" : "Cut";
    return `${band} ${d >= 0 ? "+" : ""}${d} (${qual})`;
  };
  const fxSlotDesc = (f: { fxType: number; edit1: number; edit2: number }): string => {
    if (f.fxType === 13) {
      // EQ: 2-Band — Edit1 = LOW, Edit2 = HIGH (ESX-1-Manual), kein Mid.
      return `EQ [${eqBand(f.edit1, "Low")} / ${eqBand(f.edit2, "High")}]`;
    }
    const lab = EDIT_LABELS[f.fxType];
    const name = esxFxTypeName(f.fxType);
    return lab
      ? `${name} [${lab[0]} ${f.edit1} / ${lab[1]} ${f.edit2}]`
      : `${name} [Edit1 ${f.edit1} / Edit2 ${f.edit2}]`;
  };
  const fxSections: string[] = [];
  selected.forEach((p, bankIdx) => {
    const routed = p.parts.filter(
      (pt) => pt.fxSend === true && pt.steps.some((s) => s.active)
    );
    if (routed.length === 0) return;
    const fxDesc = (p.fx ?? [])
      .map((f, i) => `FX${i + 1} = ${fxSlotDesc(f)}`)
      .join(" · ");
    fxSections.push(`### Pattern ${bankIdx + 1}${p.name ? ` „${p.name}"` : ""}`);
    fxSections.push(`Prozessoren: ${fxDesc} · Chain: ${CHAIN_LABEL[p.fxChain ?? 0]}`);
    for (const pt of routed) {
      const sel = typeof pt.fxSelect === "number" ? pt.fxSelect : 0;
      const fxSlot = (p.fx ?? [])[sel];
      const sample = sampleMap.get(pt.sampleId);
      const label = sample ? ` (${sample.hwNumber} ${sample.name})` : "";
      fxSections.push(
        `- Part ${pt.partIndex + 1}${label} → FX${sel + 1}: ` +
          (fxSlot ? fxSlotDesc(fxSlot) : `FX${sel + 1}`)
      );
    }
    fxSections.push("");
  });
  if (fxSections.length > 0) {
    lines.push("");
    lines.push("## FX-Zuweisung (am Gerät nachbauen)");
    lines.push("");
    lines.push(
      "Die ESX-1 schickt diese Parts DURCH ihre Master-FX (insert-artig — das"
    );
    lines.push(
      "macht sie lauter/dichter). Die E2S bekommt keine automatische"
    );
    lines.push(
      "FX-Zuweisung: pro Part am Gerät ein passendes IFX wählen und AN schalten,"
    );
    lines.push("sonst klingen genau diese Parts trockener/leiser als im Original.");
    lines.push("");
    lines.push(
      "**EQ-Lesehilfe:** Der ESX-EQ ist ein 2-Band-EQ — NUR Low und High, kein"
    );
    lines.push(
      "Mid. Werte relativ zur Reglermitte (±0 = neutral); am E2S das IFX"
    );
    lines.push(
      "„2band EQ“ verwenden (gleiche Logik). Andere FX: [Reglername Wert] ="
    );
    lines.push("ESX-Drehregler Edit1/Edit2 (0–127).");
    lines.push("");
    lines.push(...fxSections);
  }
  const mapping = lines.join("\n") + "\n";

  return {
    allpat,
    all,
    mapping,
    stats: {
      patterns: selected.length,
      samples: slots.length,
      droppedSamples,
      audioSeconds,
      activeParts,
      linkedParts,
    },
  };
}

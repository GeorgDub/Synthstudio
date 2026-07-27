/**
 * e2sSampleEdit.ts — reine PCM-Editier-Operationen für E2S-Samples.
 *
 * Oe2sSLE-Funktionen, die die eigentlichen PCM-Daten verändern (im Gegensatz zu
 * reinen Metadaten wie Name/Tune/Level). Rein + seiteneffektfrei → in Node
 * testbar; die UI (KorgBankEditor) ruft sie und schreibt das Ergebnis via
 * patchOpenedSlot zurück (setzt isDirty → Builder re-encoded).
 *
 * Konvention: `pcmData` ist Float32, bei Stereo interleaved L,R,L,R,…
 * (gleiche Konvention wie E2sSlot.pcmData / der Builder).
 */

export interface E2sTrimResult {
  /** Neue (geschnittene) PCM-Daten. */
  pcmData: Float32Array;
  /** Frames pro Channel nach dem Trim. */
  frames: number;
}

/**
 * Oe2sSLE „Trim": schneidet alles vor `startFrame` und nach `endFrame` weg
 * (beide inklusive). Liefert die neuen PCM-Daten + Frame-Zahl.
 *
 * Defensiv: Frames werden auf [0, totalFrames-1] geklemmt; ist `startFrame >
 * endFrame`, werden sie getauscht. Bei leerem/ungültigem Input kommt das
 * Original unverändert zurück (kein Throw).
 *
 * @param pcmData    Interleaved Float32-PCM.
 * @param channels   1 = mono, 2 = stereo.
 * @param startFrame Erster zu behaltender Frame (inklusive).
 * @param endFrame   Letzter zu behaltender Frame (inklusive).
 */
export function trimE2sSlotPcm(
  pcmData: Float32Array,
  channels: 1 | 2,
  startFrame: number,
  endFrame: number
): E2sTrimResult {
  const ch = channels === 2 ? 2 : 1;
  const totalFrames = Math.floor(pcmData.length / ch);
  if (totalFrames <= 0) {
    return { pcmData: new Float32Array(0), frames: 0 };
  }

  let s = Number.isFinite(startFrame) ? Math.floor(startFrame) : 0;
  let e = Number.isFinite(endFrame) ? Math.floor(endFrame) : totalFrames - 1;
  if (s > e) [s, e] = [e, s];
  s = Math.max(0, Math.min(s, totalFrames - 1));
  e = Math.max(0, Math.min(e, totalFrames - 1));

  // No-op-Fall: exakt das ganze Sample → Original-Referenz zurückgeben.
  if (s === 0 && e === totalFrames - 1) {
    return { pcmData, frames: totalFrames };
  }

  const sliceStart = s * ch;
  const sliceEnd = (e + 1) * ch;
  const out = pcmData.slice(sliceStart, sliceEnd);
  return { pcmData: out, frames: e - s + 1 };
}

/**
 * Oe2sSLE „Stereo → Mono": mischt ein interleaved Stereo-PCM auf einen Kanal.
 * Gewichte exakt wie Oe2sSLE `_convert_to_mono`: `wL = (1-mix)/2`, `wR = 1-wL`.
 *   - mix = 0   → wL = wR = 0.5 (zentriertes Mittel; sinnvoller Default)
 *   - mix = 1   → wL = 0, wR = 1 (nur rechter Kanal)
 * Die Gewichte summieren zu 1 → kein Clipping. Frame-Zahl bleibt gleich; nur
 * die PCM-Länge halbiert sich (2 → 1 Kanal). Nicht-Stereo → Original zurück.
 *
 * @param pcmData Interleaved L,R,L,R,… Float32-PCM.
 * @param mix     0..1 Pan-Mix (0 = zentriert). Wird auf [0,1] geklemmt.
 */
export function stereoToMonoE2s(pcmData: Float32Array, mix = 0): Float32Array {
  const n = Math.floor(pcmData.length / 2);
  if (n <= 0) return new Float32Array(0);
  const m = Number.isFinite(mix) ? Math.max(0, Math.min(1, mix)) : 0;
  const wL = (1 - m) / 2;
  const wR = 1 - wL;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = pcmData[i * 2] * wL + pcmData[i * 2 + 1] * wR;
  }
  return out;
}

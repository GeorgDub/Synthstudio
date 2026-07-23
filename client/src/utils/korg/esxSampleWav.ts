/**
 * esxSampleWav.ts — kodiert ESX-1-Samples (Float32 PCM) zu WAV-Bytes.
 *
 * Baustein, um beim „In Sequenzer laden" die ESX-Samples HÖRBAR zu machen:
 * jeder Part referenziert per `sampleId` einen Bank-Slot; dessen PCM wird hier
 * zu einer WAV-Datei kodiert, aus der der Caller eine Blob-URL macht und sie via
 * `setPartSample` an den Part hängt.
 *
 * Rein (kein DOM/Blob) → in Node testbar. Die Blob-URL-Erzeugung passiert im
 * Controller (Browser). Nutzt den bestehenden `encodeWav` (kein neuer Encoder).
 */

import { encodeWav } from "@/audio/wavEncoder";
import type { EsxBank, EsxSample } from "./esxParser";

const DEFAULT_SR = 44100;

/**
 * Kodiert ein ESX-Sample zu WAV. Mono → 1 Kanal; Stereo → deinterleaved 2
 * Kanäle. Liefert die WAV-Bytes (Header + PCM).
 */
export function encodeEsxSampleToWav(sample: EsxSample): Uint8Array {
  const sr = sample.sampleRate > 0 ? sample.sampleRate : DEFAULT_SR;
  if (sample.channels === 2) {
    const n = Math.floor(sample.pcmData.length / 2);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = sample.pcmData[i * 2];
      r[i] = sample.pcmData[i * 2 + 1];
    }
    return new Uint8Array(encodeWav([l, r], { sampleRate: sr, channels: 2 }));
  }
  return new Uint8Array(
    encodeWav([sample.pcmData], { sampleRate: sr, channels: 1 })
  );
}

/**
 * Baut eine Map `sampleId (Slot-Index) → WAV-Bytes` über alle nicht-leeren
 * Bank-Samples (mono + stereo). Leere/kaputte Samples werden übersprungen.
 * `part.sampleId` matcht `EsxSample.index` (siehe esxSampleLink).
 */
export function buildEsxSampleWavMap(bank: EsxBank): Map<number, Uint8Array> {
  const map = new Map<number, Uint8Array>();
  for (const s of [...bank.monoSamples, ...bank.stereoSamples]) {
    if (!s.pcmData || s.pcmData.length === 0) continue;
    try {
      map.set(s.index, encodeEsxSampleToWav(s));
    } catch {
      /* einzelnes Sample überspringen, Rest weiter kodieren */
    }
  }
  return map;
}

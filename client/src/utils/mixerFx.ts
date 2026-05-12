/**
 * Utilities for Phase B mixer state.
 *
 * These helpers stay pure so insert-chain editing, 16-band EQ defaults and
 * sidechain math can be tested without a browser AudioContext.
 */

export const MIXER_FX_TYPES = [
  "eq16",
  "compressor",
  "sidechain",
  "transient",
  "filter",
  "distortion",
  "bitcrusher",
  "ringmod",
  "chorus",
  "flanger",
  "delay",
  "reverb",
] as const;

export type MixerFxType = (typeof MIXER_FX_TYPES)[number];

export interface MixerFxSlot {
  id: string;
  type: MixerFxType;
  name: string;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export interface EqBand {
  frequency: number;
  gain: number;
  q: number;
}

export interface SidechainSettings {
  enabled: boolean;
  sourcePartId: string | null;
  amount: number;
  attack: number;
  release: number;
}

export interface TransientShaperSettings {
  enabled: boolean;
  attack: number;
  sustain: number;
  mix: number;
}

export const EQ16_FREQUENCIES = [
  25, 40, 63, 100, 160, 250, 400, 630,
  1000, 1600, 2500, 4000, 6300, 10000, 12500, 16000,
] as const;

export const DEFAULT_SIDECHAIN: SidechainSettings = {
  enabled: false,
  sourcePartId: null,
  amount: 0.5,
  attack: 0.01,
  release: 0.18,
};

export const DEFAULT_TRANSIENT_SHAPER: TransientShaperSettings = {
  enabled: false,
  attack: 0,
  sustain: 0,
  mix: 1,
};

const FX_LABELS: Record<MixerFxType, string> = {
  eq16: "16-Band EQ",
  compressor: "Compressor",
  sidechain: "Sidechain",
  transient: "Transient Shaper",
  filter: "Filter",
  distortion: "Distortion",
  bitcrusher: "Bitcrusher",
  ringmod: "Ring Mod",
  chorus: "Chorus",
  flanger: "Flanger",
  delay: "Delay",
  reverb: "Reverb",
};

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

export function clampDb(value: number): number {
  return clamp(value, -24, 24);
}

export function createDefaultEqBands(): EqBand[] {
  return EQ16_FREQUENCIES.map((frequency) => ({ frequency, gain: 0, q: 1 }));
}

export function sanitizeEqBands(bands: Partial<EqBand>[] | undefined): EqBand[] {
  const defaults = createDefaultEqBands();
  return defaults.map((fallback, index) => {
    const band = bands?.[index];
    return {
      frequency: clamp(band?.frequency ?? fallback.frequency, 20, 20000),
      gain: clampDb(band?.gain ?? fallback.gain),
      q: clamp(band?.q ?? fallback.q, 0.1, 12),
    };
  });
}

export function makeMixerFxSlot(type: MixerFxType, id = `${type}-${Date.now()}`): MixerFxSlot {
  return {
    id,
    type,
    name: FX_LABELS[type],
    enabled: true,
    params: defaultParamsForType(type),
  };
}

export function defaultParamsForType(type: MixerFxType): Record<string, number | string | boolean> {
  switch (type) {
    case "eq16":
      return { mix: 1 };
    case "compressor":
      return { threshold: -24, ratio: 4, attack: 0.003, release: 0.25 };
    case "sidechain":
      return { amount: DEFAULT_SIDECHAIN.amount, attack: DEFAULT_SIDECHAIN.attack, release: DEFAULT_SIDECHAIN.release };
    case "transient":
      return { attack: 0, sustain: 0, mix: 1 };
    case "filter":
      return { type: "lowpass", frequency: 8000, q: 1 };
    case "distortion":
      return { amount: 50 };
    case "bitcrusher":
      return { bitDepth: 8, sampleReduct: 4, mix: 1 };
    case "ringmod":
      return { frequency: 200, mix: 0.5 };
    case "chorus":
      return { rate: 1.5, depth: 0.003, feedback: 0.1, mix: 0.5 };
    case "flanger":
      return { rate: 0.5, depth: 0.002, feedback: 0.7, mix: 0.5 };
    case "delay":
      return { time: 0.25, feedback: 0.3, mix: 0.3 };
    case "reverb":
      return { decay: 2, mix: 0.3 };
    default:
      return {};
  }
}

export function moveFxSlot(chain: MixerFxSlot[], fromIndex: number, toIndex: number): MixerFxSlot[] {
  if (fromIndex < 0 || fromIndex >= chain.length) return chain;
  const target = clamp(Math.round(toIndex), 0, chain.length - 1);
  if (target === fromIndex) return chain;
  const next = [...chain];
  const [slot] = next.splice(fromIndex, 1);
  next.splice(target, 0, slot);
  return next;
}

export function toggleFxSlot(chain: MixerFxSlot[], slotId: string): MixerFxSlot[] {
  return chain.map((slot) =>
    slot.id === slotId ? { ...slot, enabled: !slot.enabled } : slot,
  );
}

export function removeFxSlot(chain: MixerFxSlot[], slotId: string): MixerFxSlot[] {
  return chain.filter((slot) => slot.id !== slotId);
}

export function summarizeEqBands(bands: EqBand[]): { low: number; mid: number; high: number } {
  const clean = sanitizeEqBands(bands);
  const average = (slice: EqBand[]) =>
    slice.reduce((sum, band) => sum + band.gain, 0) / Math.max(1, slice.length);

  return {
    low: clampDb(average(clean.slice(0, 5))),
    mid: clampDb(average(clean.slice(5, 11))),
    high: clampDb(average(clean.slice(11))),
  };
}

export function computeSidechainGain(inputEnvelope: number, settings: SidechainSettings): number {
  if (!settings.enabled || !settings.sourcePartId) return 1;
  const ducking = clampUnit(inputEnvelope) * clampUnit(settings.amount);
  return clamp(1 - ducking, 0, 1);
}

export function normalizeSidechain(settings: Partial<SidechainSettings> | undefined): SidechainSettings {
  return {
    enabled: settings?.enabled ?? DEFAULT_SIDECHAIN.enabled,
    sourcePartId: settings?.sourcePartId ?? DEFAULT_SIDECHAIN.sourcePartId,
    amount: clampUnit(settings?.amount ?? DEFAULT_SIDECHAIN.amount),
    attack: clamp(settings?.attack ?? DEFAULT_SIDECHAIN.attack, 0.001, 1),
    release: clamp(settings?.release ?? DEFAULT_SIDECHAIN.release, 0.01, 2),
  };
}

export function normalizeTransientShaper(settings: Partial<TransientShaperSettings> | undefined): TransientShaperSettings {
  return {
    enabled: settings?.enabled ?? DEFAULT_TRANSIENT_SHAPER.enabled,
    attack: clamp(settings?.attack ?? DEFAULT_TRANSIENT_SHAPER.attack, -1, 1),
    sustain: clamp(settings?.sustain ?? DEFAULT_TRANSIENT_SHAPER.sustain, -1, 1),
    mix: clampUnit(settings?.mix ?? DEFAULT_TRANSIENT_SHAPER.mix),
  };
}

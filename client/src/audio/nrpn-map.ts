/**
 * nrpn-map.ts — Auto-generated from docs/midi/nrpn_map.json.
 *
 * DO NOT EDIT MANUALLY. Regenerate via:
 *   python tools/build/generate_ts_bindings.py
 *
 * Generated: 2026-07-27
 *
 * Sprint-53: SynthStudio-Bridge-Auto-Bindings.
 */

export interface NRPNParam {
  /** Beschreibung des Parameters (aus Source-Header) */
  description: string;
  /** Source-Datei in der das Modul deklariert ist */
  source: string;
}

export interface NRPNModule {
  /** Eindeutige MSB-Werte die dieses Modul handlet (1..3 Werte) */
  msbs: number[];
  /** Map LSB → NRPNParam (LSB 0..127) */
  params: Record<number, NRPNParam>;
  /** Source-Datei */
  source: string;
}

export interface NRPNLookupResult {
  module: string;
  description: string;
  source: string;
}

/** Komplette NRPN-Map des aktuellen OmniTribe-Builds. */
export const NRPN_MAP: Record<string, NRPNModule> = {
  "arpeggiator": {
    source: "arpeggiator.c",
    msbs: [0x16],
    params: {
      0x1600: { description: "Mode", source: "arpeggiator.c" },
      0x1601: { description: "Rate (1/4, 1/8, 1/16, ...)", source: "arpeggiator.c" },
      0x1602: { description: "Range (Oktaven, 1..4)", source: "arpeggiator.c" },
      0x1603: { description: "Gate (%)", source: "arpeggiator.c" },
      0x1604: { description: "Latch (0/1)", source: "arpeggiator.c" },
      0x1610: { description: "Velocity-Pattern Steps 0..7", source: "arpeggiator.c" },
      0x1611: { description: "Velocity-Pattern Steps 0..7", source: "arpeggiator.c" },
      0x1612: { description: "Velocity-Pattern Steps 0..7", source: "arpeggiator.c" },
      0x1613: { description: "Velocity-Pattern Steps 0..7", source: "arpeggiator.c" },
      0x1614: { description: "Velocity-Pattern Steps 0..7", source: "arpeggiator.c" },
      0x1615: { description: "Velocity-Pattern Steps 0..7", source: "arpeggiator.c" },
      0x1616: { description: "Velocity-Pattern Steps 0..7", source: "arpeggiator.c" },
      0x1617: { description: "Velocity-Pattern Steps 0..7", source: "arpeggiator.c" },
    },
  },
  "audio_input_routing": {
    source: "audio_input_routing.c",
    msbs: [0x21],
    params: {
      0x2100: { description: "Routing-Mode (0=bypass, 1=IFX-A, 2=IFX-B, 3=Direct-MFX)", source: "audio_input_routing.c" },
      0x2101: { description: "IFX-A-Slot-Reference (Part-Index 0..15)", source: "audio_input_routing.c" },
      0x2102: { description: "IFX-B-Slot-Reference", source: "audio_input_routing.c" },
      0x2103: { description: "Input-Gain (-12..+24 dB, mapped 0..127)", source: "audio_input_routing.c" },
      0x2104: { description: "Monitoring-Mode (0=processed, 1=direct-bypass <1ms)", source: "audio_input_routing.c" },
      0x2105: { description: "Enabled (0/1)", source: "audio_input_routing.c" },
    },
  },
  "chord": {
    source: "chord.c",
    msbs: [0x1E],
    params: {
      0x1E00: { description: "Chord-Type (0..14 = 11 std + 4 user)", source: "chord.c" },
      0x1E01: { description: "Stagger (0..200 ms)", source: "chord.c" },
      0x1E02: { description: "Root-Override (0..127, 0xFF=use played note)", source: "chord.c" },
      0x1E03: { description: "Enabled (0/1)", source: "chord.c" },
    },
  },
  "cpu_budget_module": {
    source: "cpu_budget_module.c",
    msbs: [0x1A],
    params: {
      0x1A10: { description: "Target-CPU-Last in % (50..95)", source: "cpu_budget_module.c" },
      0x1A11: { description: "CPU-Stream aktivieren (0/1)", source: "cpu_budget_module.c" },
    },
  },
  "generator_catalog": {
    source: "generator_catalog.c",
    msbs: [0x08],
    params: {
      0x0800: { description: "silence/clear-stub (catalog idx 0; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0801: { description: "wavetable-interp osc [lut] (catalog idx 1; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0802: { description: "wavetable-interp osc [lut] (catalog idx 2; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0803: { description: "polynomial/parabolic shaper (catalog idx 3; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0804: { description: "generator, filter/resonator-shaped (catalog idx 4; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0805: { description: "saw/ramp + soft-clip generator (catalog idx 5; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0806: { description: "generator, filter/resonator-shaped multimode (catalog idx 6; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0807: { description: "generator, filter/resonator-shaped multimode (catalog idx 7; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0808: { description: "generator, filter/resonator-shaped multimode (catalog idx 8; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0809: { description: "wavetable-interp osc [lut] LSETUP (catalog idx 9; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x080A: { description: "wavetable-interp osc [lut] LSETUP (catalog idx 10; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x080B: { description: "polynomial/parabolic shaper (catalog idx 11; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x080C: { description: "polynomial shaper LSETUP (catalog idx 12; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x080D: { description: "additive/harmonic-sum osc (catalog idx 13; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x080E: { description: "additive/harmonic-sum osc (catalog idx 14; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x080F: { description: "additive osc + DC-offset (catalog idx 15; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0810: { description: "saw/wrap shaper (catalog idx 16; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0811: { description: "wavetable-interp osc + parabola pre-shape (catalog idx 17; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0812: { description: "wavetable-interp osc + parabola pre-shape (catalog idx 18; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0813: { description: "saw-wrap + parabola shaper (catalog idx 19; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0814: { description: "saw-wrap + polynomial shaper (catalog idx 20; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0815: { description: "wavetable-interp osc [lut] LSETUP (catalog idx 21; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0816: { description: "wavetable-interp osc [lut] LSETUP (catalog idx 22; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0817: { description: "polynomial shaper state-rewind (catalog idx 23; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0818: { description: "polynomial/parabolic shaper LSETUP (catalog idx 24; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0819: { description: "wavetable-interp osc 2-stage (catalog idx 25; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x081A: { description: "wavetable-interp osc 2-stage (catalog idx 26; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x081B: { description: "generator, filter/resonator-shaped bidirectional (catalog idx 27; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x081C: { description: "generator, filter/resonator-shaped z-state (catalog idx 28; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x081D: { description: "wavetable-interp osc 2-stage (catalog idx 29; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x081E: { description: "wavetable-interp osc 2-stage (catalog idx 30; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x081F: { description: "generator, filter/resonator-shaped bidirectional (catalog idx 31; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0820: { description: "generator, filter/resonator-shaped z-state (catalog idx 32; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0821: { description: "generator, biquad/SVF-shaped (catalog idx 33; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0822: { description: "PCM sample-player PINNED (catalog idx 34; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0823: { description: "generator, filter/resonator-shaped fu-MAC (catalog idx 35; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0824: { description: "slice/wrap-counter osc (catalog idx 36; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0825: { description: "wavetable-interp osc [lut] largest (catalog idx 37; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0826: { description: "bit-masked/quantizer osc (catalog idx 38; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
      0x0827: { description: "generator, filter/resonator-shaped + parabola TOP (catalog idx 39; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)", source: "generator_catalog.c" },
    },
  },
  "granular": {
    source: "granular.c",
    msbs: [0x19],
    params: {
      0x1900: { description: "Grain Size (ms × 10, 5..500)", source: "granular.c" },
      0x1901: { description: "Density (Grains/s, 0..50)", source: "granular.c" },
      0x1902: { description: "Pitch-Scatter (±semitones × 10, 0..240)", source: "granular.c" },
      0x1903: { description: "Position (0..1023)", source: "granular.c" },
      0x1904: { description: "Spray (0..1023, Positions-Streuung)", source: "granular.c" },
      0x1905: { description: "Feedback (0..127)", source: "granular.c" },
    },
  },
  "midi_learn": {
    source: "midi_learn.c",
    msbs: [0x0A],
    params: {
      0x0A00: { description: "Learn-Mode aktivieren (value = part << 8 | param_id_lsb,", source: "midi_learn.c" },
      0x0A01: { description: "Clear-All-Mappings", source: "midi_learn.c" },
    },
  },
  "modmatrix": {
    source: "modmatrix.c",
    msbs: [0x13, 0x14, 0x15],
    params: {
      0x1300: { description: "Source pro Slot", source: "modmatrix.c" },
      0x1301: { description: "Source pro Slot", source: "modmatrix.c" },
      0x1302: { description: "Source pro Slot", source: "modmatrix.c" },
      0x1303: { description: "Source pro Slot", source: "modmatrix.c" },
      0x1304: { description: "Source pro Slot", source: "modmatrix.c" },
      0x1305: { description: "Source pro Slot", source: "modmatrix.c" },
      0x1306: { description: "Source pro Slot", source: "modmatrix.c" },
      0x1307: { description: "Source pro Slot", source: "modmatrix.c" },
      0x1400: { description: "Target pro Slot", source: "modmatrix.c" },
      0x1401: { description: "Target pro Slot", source: "modmatrix.c" },
      0x1402: { description: "Target pro Slot", source: "modmatrix.c" },
      0x1403: { description: "Target pro Slot", source: "modmatrix.c" },
      0x1404: { description: "Target pro Slot", source: "modmatrix.c" },
      0x1405: { description: "Target pro Slot", source: "modmatrix.c" },
      0x1406: { description: "Target pro Slot", source: "modmatrix.c" },
      0x1407: { description: "Target pro Slot", source: "modmatrix.c" },
      0x1500: { description: "Depth pro Slot (signed)", source: "modmatrix.c" },
      0x1501: { description: "Depth pro Slot (signed)", source: "modmatrix.c" },
      0x1502: { description: "Depth pro Slot (signed)", source: "modmatrix.c" },
      0x1503: { description: "Depth pro Slot (signed)", source: "modmatrix.c" },
      0x1504: { description: "Depth pro Slot (signed)", source: "modmatrix.c" },
      0x1505: { description: "Depth pro Slot (signed)", source: "modmatrix.c" },
      0x1506: { description: "Depth pro Slot (signed)", source: "modmatrix.c" },
      0x1507: { description: "Depth pro Slot (signed)", source: "modmatrix.c" },
    },
  },
  "mpe_voice": {
    source: "mpe_voice.c",
    msbs: [0x12],
    params: {
      0x1200: { description: "Range (Halbtoene 0..24)", source: "mpe_voice.c" },
      0x1201: { description: "Smooth-Time", source: "mpe_voice.c" },
    },
  },
  "performance": {
    source: "performance.c",
    msbs: [0x1F],
    params: {
      0x1F40: { description: "mode (0=normal,1=loop-only,2=oneshot-only)", source: "performance.c" },
      0x1F41: { description: "crossfade-time (0..127 = 0..2000 ms)", source: "performance.c" },
      0x1F42: { description: "enable (0/1)", source: "performance.c" },
    },
  },
  "polyphony_pool": {
    source: "polyphony_pool.c",
    msbs: [0x1A],
    params: {
      0x1A03: { description: "Pool-Priority (0=Perc, 1=Melodic, 2=Pad)", source: "polyphony_pool.c" },
      0x1A04: { description: "Min-Voices-Reserve (1..8)", source: "polyphony_pool.c" },
    },
  },
  "randomizer": {
    source: "randomizer.c",
    msbs: [0x1C],
    params: {
    },
  },
  "sd_stream": {
    source: "sd_stream.c",
    msbs: [0x20],
    params: {
      0x2000: { description: "Stream-Slot-Index (0..3, 0xFF = disable)", source: "sd_stream.c" },
      0x2001: { description: "Pre-Roll-MS (50..500)", source: "sd_stream.c" },
      0x2002: { description: "Sample-File-Slot (Referenz auf SD-File-Tabelle)", source: "sd_stream.c" },
    },
  },
  "sidechain": {
    source: "sidechain.c",
    msbs: [0x1D],
    params: {
      0x1D00: { description: "Threshold (-40..0 dB, normalisiert 0..127)", source: "sidechain.c" },
      0x1D01: { description: "Attack    (0..127, mapped auf 0.1..100 ms exponentiell)", source: "sidechain.c" },
      0x1D02: { description: "Release   (0..127, mapped auf 10..2000 ms exponentiell)", source: "sidechain.c" },
      0x1D03: { description: "Depth     (0..127, % Volumenreduktion)", source: "sidechain.c" },
      0x1D04: { description: "Source-Channel (0=Audio-In-L, 1=Audio-In-R, 2=Stereo-Sum)", source: "sidechain.c" },
      0x1D05: { description: "Enable (0/1)", source: "sidechain.c" },
    },
  },
  "spectral_morph": {
    source: "spectral_morph.c",
    msbs: [0x1E],
    params: {
      0x1EC0: { description: "Sample-Slot A (0..127)", source: "spectral_morph.c" },
      0x1EC1: { description: "Sample-Slot B (0..127)", source: "spectral_morph.c" },
      0x1EC2: { description: "Morph-Position (0..1023, modulierbar via Mod-Matrix)", source: "spectral_morph.c" },
      0x1EC3: { description: "FFT-Size (0=256, 1=512, 2=1024)", source: "spectral_morph.c" },
      0x1EC4: { description: "Enabled (0/1)", source: "spectral_morph.c" },
    },
  },
  "voice_steal": {
    source: "voice_steal.c",
    msbs: [0x1A],
    params: {
      0x1A00: { description: "Mode (0..2)", source: "voice_steal.c" },
      0x1A01: { description: "Max-Voices pro Part (1..8)", source: "voice_steal.c" },
      0x1A02: { description: "Sustain-Hold (0/1, Voice nicht stealbar wenn Note gehalten)", source: "voice_steal.c" },
    },
  },
  "wavetable": {
    source: "wavetable.c",
    msbs: [0x07],
    params: {
      0x0700: { description: "Slot-Select (0..7)", source: "wavetable.c" },
      0x0701: { description: "Frame-Position (0..63 × 1024, q10)", source: "wavetable.c" },
      0x0702: { description: "Morph-Speed (LFO-Rate fuer Auto-Morph)", source: "wavetable.c" },
      0x0703: { description: "Morph-Range (0..63 Frames)", source: "wavetable.c" },
    },
  },
};

export type ModuleName = keyof typeof NRPN_MAP;

/** Findet das Modul + Param-Info fuer eine (MSB, LSB)-Adresse. */
export function lookupNrpn(msb: number, lsb: number): NRPNLookupResult | null {
  const composite = (msb << 8) | (lsb & 0xFF);
  for (const [moduleKey, info] of Object.entries(NRPN_MAP)) {
    const param = info.params[composite];
    if (param) {
      return {
        module: moduleKey,
        description: param.description,
        source: param.source,
      };
    }
  }
  return null;
}

/** Liefert alle Module die einen bestimmten MSB handlen. */
export function modulesForMsb(msb: number): string[] {
  return Object.entries(NRPN_MAP)
    .filter(([_, info]) => info.msbs.includes(msb))
    .map(([key, _]) => key);
}

/** Gesamtanzahl der dokumentierten Parameter. */
export const TOTAL_NRPN_PARAMS = 125;

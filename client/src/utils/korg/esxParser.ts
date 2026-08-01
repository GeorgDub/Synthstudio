/**
 * Synthstudio – ESX-1 Sample-Bank Parser (v3.23.0)
 *
 * Port aus dem Python-Tool `G:/IdeaProjects/Korg Editor`.
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/esx_parser.py
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/audio_processor.py
 *
 * v3.3.0 SCOPE (Samples):
 *   - Magic-Validierung "KORG" + "ESX\0"
 *   - Sample-Counters
 *   - 256 Mono-Headers + 128 Stereo-Headers
 *   - PCM-Extraction mit BE→LE-Swap + Int16→Float32-Konvertierung
 *
 * v3.5.0 SCOPE (Patterns — TASK-237-FOLLOWUP-5):
 *   - 256 Patterns × 4280 Bytes ab Offset 0x0200
 *   - Best-Effort Pattern-Parser:
 *       • Name (8 ASCII Bytes ab Pattern-Offset 0)
 *       • BPM (BE u16 / 128 ab Pattern-Offset 8)
 *       • Step-Length-Indikator (Pattern-Offset 13, init=0x0F=16 Steps)
 *       • Swing (Pattern-Offset 15, Best-Effort)
 *       • Empty-Pattern-Erkennung (Bytes 8..19 matchen "Init"-Signatur)
 *
 * v3.14.0 SCOPE (Step-Encoding RE — TASK-v3.5-FU):
 *   Hex-Diff Analyse 2026-05-18 (init vs real Patterns aus BOTTROP/KASSEL/
 *   ENDLICH/DUSSELBUNKAAA) hat folgende Layout-Felder verifiziert:
 *     • Per-Part-Stride: 34 Bytes (18B Header + 16B Step-Trigger)
 *     • 10 Drum-Parts (Drum 1..10) ab Offset 0x18 (= 24)
 *     • sample-id BE u16 @ part+0  (0x8000 = unassigned)
 *     • level @ part+9 (0..127)
 *     • pan @ part+10 (0..127, 64=center)
 *     • Step-Trigger: 16B @ part+18, bit 0 = active
 *     • Beweis: BOTTROP[0] Part 5 = '01 00 00 00 01 00 00 00 ...'
 *       dekodiert zu Kick-Pattern Steps 0,4,8,12 + Extra (4-on-the-floor)
 *
 * v3.20.0 SCOPE (Pitch/FxSend + Parts 10..15 RE — TASK-v3.14-FU-1/2):
 *   Erweiterte Hex-Diff-Analyse (BOTTROP/KASSEL × alle Patterns) hat
 *   zusaetzliche Felder im Drum-Part-Header verifiziert:
 *     • +8  = pitch (signed i8, 0x40 = neutral = 0 semitones, Range 0x00..0x7F)
 *             KASSEL zeigt Werte 0x00..0xFD ⇒ signed two's-complement
 *             Default 0x40 in 2475/2830 BOTTROP-Parts → high confidence
 *     • +11 = fxSend (u8, 0..127, 0=off, 0x7F=max)
 *             12 unique Werte in BOTTROP → high confidence
 *   Parts 10..15 Layout (verifiziert via 'ff 00' marker-Scan + step-pattern-shape):
 *     • Part 10 (Stretch 1): 34B-Header @ 0x25C (gleicher Stride wie Drum-Parts)
 *     • Parts 11..14 (Sample/Slice/Synth): 32B-Stride @ 0x36E, 0x38E, 0x3AE, 0x3CE
 *       Layout pro 32B-Block: 16B Header (sample-id BE u16 @+0, pitch @+6,
 *       level @+7, pan @+8, fxSend @+10) + 16B Step-Trigger bytes
 *       Beweis: BOTTROP[1] Part-11 (0x36E) = sample-id 0x0086, steps 1/5/9/13
 *       Beweis: BOTTROP[0] Part-13 (0x3AE) = sample-id 0x0023, alle 16 Steps
 *     • Part 15 (Audio-In/Accent): default-Header @ 0x3CE — fast immer
 *       konstant '00 7f 00 40 64 40 7f 00...' = unused. Keine User-Trigger
 *       in den Real-Files gefunden → bleibt Defaults.
 *   Motion-Sequencer-Daten (0x16C..0x25B = 240B Drum-Motion und
 *   0x27E..0x35D = ~224B Stretch+Sample-Motion) bleiben Best-Effort defaults;
 *   ein vollstaendiges Motion-Decoding wurde fuer v3.20 nicht implementiert.
 *
 * v3.23.0 SCOPE (Step-Byte Bit-Layout RE — TASK-v3.20-FU-SYNTH-NOTE):
 *   Reverse-Engineering der step-byte Bits 1..7 (Werte wie 0x11, 0x15, 0x55
 *   in BOTTROP[0] Part 13). Analyse von 17222 active steps in 5 Files
 *   (BOTTROP/ENDLICH/KASSEL/TOBI/YOYOY):
 *     • bit 0 = trigger active (CONFIRMED v3.20, 100% Korrelation)
 *     • bit 4 = ACCENT (Best-Effort): erscheint in 70.9% der Drum-Part
 *       active-steps und 38.2% der Short-Part active-steps. Konsistent mit
 *       TR-Style Accent-Track-Layer.
 *     • bits 1..3, 5..7 = roll/slide/velocity? Nicht zuverlaessig RE-d.
 *   NOTE-ENCODING-HYPOTHESE WIDERLEGT:
 *     97 distinct upper-7-bit-values gefunden, aber die distinct-value-Range
 *     pro "melodic"-Row (≥10 distinct in 16 Steps) hat median 95 / max 123
 *     Semitones — physisch unmoeglich fuer eine Bass/Lead-Line (max 36 typisch).
 *     Step-bytes encoden KEINE Notenhoehe; die Pitch-Information lebt im
 *     Per-Part-Header (pitch @+6 fuer 32B-stride, @+8 fuer 34B-stride).
 *   API: EsxStepEvent.accent?: boolean wird gesetzt (gilt fuer alle Parts
 *     0..14 — Audio-In Part 15 bleibt Defaults).
 *   Per-Step Pitch-Motion Region 0x488+ ist in allen untersuchten Files
 *   vollstaendig 0x80 (neutral) → KEINE per-step note-modulation gefunden.
 *
 * Defensive Parsing:
 *   - File-Size-Check (Min/Max)
 *   - Magic-Checks
 *   - Per-Slot + Cumulative PCM-Caps
 *   - Bounds-Checks bei jedem Read
 *   - Try/catch um die gesamten Parse-Schritte
 *   - Bei Range-Fehlern: Slot ⇒ skipped, gesamter Parse läuft weiter
 *
 * Endianness:
 *   - Alle Multi-Byte-Felder BIG-ENDIAN (Korg-Device-Konvention).
 */

import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
  ESX1_ADDR_SAMPLE_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_ADDR_SONG_DATA,
  ESX1_ADDR_SONG_EVENT_DATA,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_PATTERN,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
  ESX1_CHUNKSIZE_SONG,
  ESX1_CHUNKSIZE_SONG_EVENT,
  ESX1_EMPTY_OFFSET,
  ESX1_MAX_MONO_SLOTS,
  ESX1_MAX_SAMPLE_MEM_IN_BYTES,
  ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES,
  ESX1_MAX_STEREO_SLOTS,
  ESX1_NUM_PATTERNS,
  ESX1_NUM_SONGS,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
  ESX_FILE_MAX_BYTES,
  MAX_BYTES_PER_SLOT,
} from "./constants";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Eine einzelne (parseable) Sample-Slot-Repräsentation aus einer .esx Bank.
 *
 * PCM ist bereits BE→LE-konvertiert und auf Float32 [-1, +1] normalisiert,
 * damit Web-Audio Code (AudioBuffer / playSliceBuffer) den Buffer ohne weitere
 * Transformation laden kann.
 *
 * Für Stereo-Slots ist `pcmData` interleaved L,R,L,R,... mit `frames` PCM-Frames
 * insgesamt (also `pcmData.length === frames * channels`).
 */
export interface EsxSample {
  /** Slot-Index im on-disk Layout (0..255 mono, 256..383 stereo). */
  index: number;
  /** Decoded ASCII name (trimmed, max 8 chars). Kann leer-string sein. */
  name: string;
  /** 1 = mono, 2 = stereo. */
  channels: 1 | 2;
  /** Sample-Rate in Hz (typisch 44100, gerätespezifisch). */
  sampleRate: number;
  /** Anzahl PCM-Frames pro Channel (=== pcmData.length / channels). */
  frames: number;
  /** Float32 PCM-Daten, normalisiert auf [-1, +1], interleaved bei Stereo. */
  pcmData: Float32Array;
  /** Loop-Start-Frame (mono only; stereo immer 0). */
  loopStart: number;
  /** Loop-End-Frame oder Sample-End-Frame. */
  loopEnd: number;
  /** Geräte-Lautstärke 0..127 (LEVEL_DEFAULT bei zero/missing). */
  level: number;
}

/**
 * Anzahl Drum/Synth-Parts pro ESX-1-Pattern.
 *
 * ESX-1 hat insgesamt 16 Parts: 9× Drum, 2× Stretch, 2× Slice, 1× Audio-In,
 * 2× Synth (+ optional Accent-Layer). Die genaue Part-Reihenfolge im
 * Pattern-Block ist nicht final RE-d; wir nehmen 16 Parts als Konstante an
 * und mappen sie 1:1 auf Synthstudio's 16 Drum-Parts (Index 0..15).
 */
export const ESX1_PARTS_PER_PATTERN = 16;

/** Default-Step-Count pro ESX-1-Pattern (Hardware: 16-Step-Sequencer). */
export const ESX1_DEFAULT_STEPS = 16;

/**
 * Ein einzelner Step in einer EsxPart.
 *
 * v3.5 Best-Effort: `active` + `velocity` werden konservativ aus dem
 * Pattern-Block extrahiert. Die exakte Step-Byte-Codierung ist noch nicht
 * vollstaendig reverse-engineered; wir scannen heuristisch nach `1x`-
 * Bytes-Sequences die im realen .esx-File als 16-Byte-Bloecke direkt nach
 * jedem Part-Header auftreten.
 */
export interface EsxStepEvent {
  active: boolean;
  /** 0..127 — Default 100 wenn nicht extrahierbar. */
  velocity: number;
  /**
   * v3.23.0: ACCENT-Flag (Best-Effort).
   *
   * Bit-4 des step-bytes erscheint in real-files mit hoher Frequenz (Drum-Parts
   * 70.9% / Short-Parts 38.2% der active-Steps in 5 untersuchten Files mit
   * 17222 active steps). Die Hypothese lautet "bit-4 = accent" (TR-Style
   * Accent-Track-Layer) — KEINE Note-Encoding, da die distinct-value-Range
   * (97 unique values) und der gemessene "musical-pitch-range" (median 95,
   * max 123 semis) physisch unmoeglich fuer Synth-Bass/Lead-Lines waeren.
   *
   * Mapping:
   *   active step + accent → velocity 127 (TR-typische +27 Boost)
   *   active step ohne accent → velocity 100 (Default)
   *
   * Bei Render kann der Caller `accent` interpretieren als
   * "Velocity-Boost, Filter-Mod-Trigger, oder Reverb-Send-Boost" je nach
   * Synthstudio-Kontext.
   */
  accent?: boolean;
  /**
   * v3.286: Bei Keyboard/Synth-Parts die Note-Nummer (0..127, C4≈60) dieses
   * Steps. Undefined bei Drum-Parts (reine Trigger). Der Converter mappt sie zu
   * Synthstudio-Step-Pitch (note − 60).
   */
  note?: number;
  /** v3.286: Gate-Länge (Keyboard/Synth) roh, 0..127. Undefined bei Drums. */
  gate?: number;
}

/**
 * Ein Pattern-Part (Drum/Synth-Spur).
 *
 * v3.5 Best-Effort:
 *   - `partIndex` ist 0..15 (= Position im 16-Part-Layout)
 *   - `steps` enthaelt immer ESX1_DEFAULT_STEPS Eintraege
 *   - `volume`/`pan`/`pitch`/`fxAmount` sind Hardware-Defaults wenn nicht
 *     verifiziert; siehe Begleit-Doku zu unbekannten Offsets.
 *   - `motionSequencer` wird in v3.5 NICHT gesetzt (Motion-Daten-Layout
 *     ist nicht RE-d).
 */
/**
 * v3.293: Per-Part Filter/Modulation eines ESX-1-Parts. Offsets VERIFIZIERT
 * gegen open-electribe-editor v1.2.0 (PartDrumImpl/PartKeyboardImpl/
 * PartStretchSliceImpl `init()`):
 *   - filterType: 0=LPF, 1=HPF, 2=BPF, 3=BPF+ (FilterType.java)
 *   - cutoff/resonance/egIntensity/modSpeed/modDepth: je 1 signed Byte
 *     (rohes Geräte-0..127; die Editor-Quelle klemmt sie nicht, die 0..127-
 *     Semantik stammt aus Korgs MIDI-Impl — daher als 0..127 behandelt).
 *   - modType: 0=Saw,1=Square,2=Tri,3=S&H,4=Env; modDest: 0=Pitch,1=Cutoff,2=Amp,3=Pan.
 */
export interface EsxPartFilter {
  /** 0=LPF, 1=HPF, 2=BPF, 3=BPF+ (BPF-Variante). */
  filterType: number;
  /** 0..127 (roh). */
  cutoff: number;
  /** 0..127 (roh). */
  resonance: number;
  /** 0..127 (roh) — Filter-EG-Intensität. */
  egIntensity: number;
  /** 0=Saw,1=Square,2=Tri,3=S&H,4=Env. */
  modType: number;
  /** 0=Pitch,1=Cutoff,2=Amp,3=Pan. */
  modDest: number;
  /** 0..127 (roh). */
  modSpeed: number;
  /** 0..127 (roh). */
  modDepth: number;
}

export interface EsxPart {
  partIndex: number;
  /** 0..255 — ESX-1 Sample-Slot-Index. Best-Effort; 0 wenn unbekannt. */
  sampleId: number;
  /** 0..127. */
  volume: number;
  /** 0..127 (64 = center). */
  pan: number;
  /** Signed -64..+63 semitones. */
  pitch: number;
  /** 0..127. */
  fxAmount: number;
  /**
   * v3.312 — Amp-EG-Zeit (egtime) 0..127, 127 = klingt voll aus. Layout
   * (lammas/electribe drumpart.js + open-electribe-editor): Drum/Keyboard
   * @+11, Stretch/Slice @+9 (Block um -2 verschoben). Traegt die perkussiven
   * Huellkurven — Verlust verschiebt den gehoerten Mix auf dem E2S.
   */
  egTime?: number;
  /**
   * v3.313 — FX-Send an/aus (fxflags bit 2). fxflags-Byte: Drum/Keyboard
   * @+13, Stretch/Slice @+11. Bit-Layout lt. lammas Common.FXFlags:
   * bits 0-1 = FxSelect (FX1/2/3), bit 2 = FxSend, bit 3 = Roll,
   * bit 4 = AmpEg, bit 5 = Reverse. Ein Part mit FxSend=an laeuft auf der
   * ESX insert-artig DURCH den gewaehlten FX-Prozessor.
   */
  fxSend?: boolean;
  /** v3.313 — Gewaehlter FX-Prozessor 0..2 (= FX1..FX3), fxflags bits 0-1. */
  fxSelect?: number;
  /** v3.293: Verifizierte Per-Part Filter/Mod-Werte (siehe EsxPartFilter). */
  filter?: EsxPartFilter;
  /** Trigger-Steps, Laenge === ESX1_DEFAULT_STEPS. */
  steps: EsxStepEvent[];
  /**
   * v3.287: Mute-Zustand aus der Pattern-muteStatus-Maske (Header-Offset 16).
   * Best-Effort — Bit-Reihenfolge/Polarität gegen reale Files plausibilisiert,
   * aber final erst mit Hardware verifizierbar (siehe ESX1_MUTE_* Konstanten).
   */
  muted?: boolean;
  /** Reserviert fuer Motion-Sequencer (v3.5: stets undefined). */
  motionSequencer?: undefined;
}

/**
 * Ein Keyboard/Synth-Part des ESX-1 (2 pro Pattern). Anders als Drum-Parts
 * trägt er ECHTE 128 Note- + 128 Gate-Werte (die realen 128-Step-Melodiedaten
 * eines Length_8-Patterns). Verifiziert gegen open-electribe-editor v1.2.0.
 */
export interface EsxKeyboardPart {
  /** 0..1 (die beiden Keyboard-Parts). */
  partIndex: number;
  /** Sample-Slot-Index (BE u16, 0 = keins). */
  sampleId: number;
  /** 0..127. */
  volume: number;
  /** 0..127 (64 = center). */
  pan: number;
  /** v3.312 — Amp-EG-Zeit (egtime @+11), 0..127. */
  egTime?: number;
  /** v3.313 — FX-Send an/aus (fxflags @+13, bit 2). */
  fxSend?: boolean;
  /** v3.313 — Gewaehlter FX-Prozessor 0..2 (fxflags bits 0-1). */
  fxSelect?: number;
  /** 128 Note-Bytes (roh — die Note-Semantik ist nicht öffentlich RE-d). */
  note: Uint8Array;
  /** 128 Gate-Bytes (roh — Gate-Länge pro Step). */
  gate: Uint8Array;
}

/**
 * Ein Pattern aus dem ESX-1-Backup.
 *
 * Verified-Felder (v3.5, gegen 5 reale .esx-Files):
 *   - `name`        (Pattern-Offset 0..7 ASCII, trimmed)
 *   - `bpm`         (Pattern-Offset 8 BE u16 / 128.0)
 *   - `lengthSteps` (Pattern-Offset 13 +1; init=0x0F → 16 Steps)
 *
 * Best-Effort:
 *   - `swing`       (Pattern-Offset 15, range 0..100)
 *   - `parts[]`     (16 Slots — Step-Trigger heuristisch geparst)
 */
export interface EsxPattern {
  index: number;
  /** ASCII-Name (8 chars max), trimmed. Empty-Pattern → ''. */
  name: string;
  /** BPM (Hardware-Range 20..300). */
  bpm: number;
  /** Last-Step innerhalb EINER Bank (1..16, aus Byte 13). */
  lengthSteps: number;
  /**
   * Pattern-Länge als Wiederhol-Multiplikator (1..8 = Length_1..Length_8, aus
   * dem gepackten Byte 11). Verifiziert gegen open-electribe-editor.
   */
  patternLength: number;
  /**
   * Effektive Step-Länge = patternLength × 16 (16..128). Die ESX-1 kann bis 128
   * (8 Bänke × 16), die E2S nur 64 (4 Bänke) — daher beim Konvertieren >64 → 64
   * reduzieren.
   */
  effectiveSteps: number;
  /** Swing 0..100 (Best-Effort). */
  swing: number;
  /**
   * v3.287: rohe 16-Bit muteStatus-Maske (Header @16, BE). Für Export + Debug.
   * Per-Part-Mute steht dekodiert in `parts[i].muted`.
   */
  muteMask?: number;
  /** 16 Parts (immer voll besetzt; leere Parts haben alle Steps inactive). */
  parts: EsxPart[];
  /**
   * 2 Keyboard/Synth-Parts mit je 128 Note/Gate-Bytes (echte 128-Step-Melodie-
   * daten). Additiv zu `parts` — verifiziert gegen open-electribe-editor.
   */
  keyboardParts: EsxKeyboardPart[];
  /**
   * v3.313 — Die 3 Pattern-FX-Prozessoren (FX1..FX3) @ Pattern+1148, je 4 B
   * (fxtype, edit1, edit2, motionseqstatus — lammas fxparam.js). Empirisch
   * verifiziert (lukn kicks Pattern 1: EQ 99/67 · Compressor 62/38 ·
   * Short Delay 127/0 — alles plausibel dekodiert).
   */
  fx?: EsxFxSlot[];
  /**
   * v3.313 — FX-Chain-Routing @ Pattern-Byte 12 (lammas pattern.js FXChain):
   * 0 = keine Kette, 1 = FX1→FX2, 2 = FX2→FX3, 3 = FX1→FX2→FX3.
   */
  fxChain?: number;
  /** Rohbytes des 4280-Byte Pattern-Blocks. Hilft beim Debugging + Diff. */
  raw?: Uint8Array;
}

/** v3.313 — Ein Pattern-FX-Prozessor (fxtype + 2 Edit-Parameter). */
export interface EsxFxSlot {
  /** 0..15 (siehe ESX_FX_TYPE_NAMES). */
  fxType: number;
  /** Edit-1-Parameter 0..127. */
  edit1: number;
  /** Edit-2-Parameter 0..127. */
  edit2: number;
}

/** v3.313 — ESX-FX-Typnamen (lammas fxparam.js Enum 0..15). */
export const ESX_FX_TYPE_NAMES: readonly string[] = [
  "Reverb",
  "BPM Sync Delay",
  "Short Delay",
  "Mod Delay",
  "Grain Shifter",
  "Cho/Flg",
  "Phaser",
  "Ring Mod",
  "Talking Mod",
  "Pitch Shifter",
  "Compressor",
  "Distortion",
  "Decimator",
  "EQ",
  "LPF",
  "HPF",
];

/** v3.313 — Name eines ESX-FX-Typs (unbekannte Werte → "FX <n>"). */
export function esxFxTypeName(fxType: number): string {
  return ESX_FX_TYPE_NAMES[fxType] ?? `FX ${fxType}`;
}

/**
 * v3.89.0 — Ein einzelnes Song-Event (8 Bytes).
 *
 * Reverse-Engineering-Stand 2026-05-19 gegen 38 reale .esx-Files:
 *   - Das offizielle Korg-Manual + Open Electribe Editor enthalten KEINE
 *     dokumentierte Song-Event-Struktur — die Felder unten sind aus den
 *     Bytemustern bei 0x138400+ in KASSEL.esx + Jump New.esx abgeleitet.
 *   - 8-Byte-Frames mit folgender Best-Effort-Interpretation:
 *       +0..+1 = `time` (BE u16, Step-Index in der Songzeitachse)
 *       +2     = `pattern` (u8, 0..255 = Pattern-Slot-Index)
 *       +3     = `length`  (u8, Step-Repeats des Patterns; oft 0xF7)
 *       +4..+5 = `flags`   (BE u16, fast immer 0x0000)
 *       +6..+7 = `data`    (BE u16, terminator-Marker oder MIDI-Mute-Mask)
 *   - Terminator: ein Event-Frame mit data == 0xFFFF (= "07 FF" Marker
 *     im Pattern-Field) signalisiert Songende. Real-Beobachtung an Position
 *     0x138400: `00 70 01 f7 00 00 07 ff` → Pattern 1, length F7, end-marker.
 *
 * Die Werte sind defensiv geklemmt und werden NIE zum Wegwerfen eines Events
 * benutzt; Caller können `data === 0xFFFF` selbst als End-Marker erkennen.
 */
export interface EsxSongEvent {
  /** Step-position im Song (BE u16). */
  time: number;
  /** Pattern-Slot 0..255. */
  pattern: number;
  /** Length / Repeats (1..255). 0xF7 = Default. */
  length: number;
  /** Best-Effort Flags-Feld (BE u16). */
  flags: number;
  /** Trailing BE u16 — 0xFFFF = end-of-song marker. */
  data: number;
}

/**
 * v3.89.0 — Ein einzelnes Song-Slot (Index 0..63, 528 Bytes on disk).
 *
 * Reverse-Engineering-Stand 2026-05-19:
 *   - Header-Layout: +0..+7  = 8-byte ASCII name (space/NUL-padded)
 *                    +8      = u8 BPM-Hint (init=0x3c=60, real-werte oft 0x00)
 *                    +9..+15 = constant 0x00 in allen 4096 untersuchten Slots
 *                    +16..   = opaque event/sequence-data (nicht vollstaendig RE-d)
 *   - Empty-Slot-Erkennung: alle 528 Bytes match die init-Signatur
 *     (8x 0x20 + 0x3c + 519x 0x00). 32 von 64 Songs in KASSEL.esx zeigen
 *     diesen Init-Header.
 *
 * Die `events`-Liste wird aus der globalen Song-Event-Region (0x138400+)
 * extrahiert — pro Song werden Events bis zum nächsten End-Marker
 * (data == 0xFFFF) gesammelt.
 */
export interface EsxSong {
  /** Slot-Index 0..63. */
  index: number;
  /** ASCII-Name (8 chars max, trimmed). Empty-Slot → ''. */
  name: string;
  /** BPM-Hint aus Slot-Offset +8 (Best-Effort, oft 60 = init). */
  bpm: number;
  /** Anzahl der Events, die diesem Song zugeordnet sind. */
  eventCount: number;
  /**
   * Liste der dekodierten 8B-Events. Leer, wenn der Song initialisiert ist
   * oder die Event-Region fehlt. Defensive: max 4096 Events pro Song.
   */
  events: EsxSongEvent[];
  /** Rohbytes des 528B Song-Blocks (Debug/Diff). */
  raw?: Uint8Array;
}

export interface EsxBank {
  /** Quelle (Filename oder "<bytes>"). */
  source: string;
  /** Mono-Samples (immer 1-Channel). */
  monoSamples: EsxSample[];
  /** Stereo-Samples (immer 2-Channel, interleaved). */
  stereoSamples: EsxSample[];
  /** Patterns — in v3.3 leeres Array (Skeleton-Doku). */
  patterns: EsxPattern[];
  /**
   * v3.89.0 — Geparste non-empty Songs (max 64). Leere Init-Slots werden
   * weggelassen. Wenn die Song-Region truncated ist, wird ein warning
   * generiert und das Array bleibt leer.
   */
  songs: EsxSong[];
  /** Vom Header gemeldete Mono-Sample-Anzahl (Plausibilitätsfeld). */
  declaredMonoCount: number;
  /** Vom Header gemeldete Stereo-Sample-Anzahl. */
  declaredStereoCount: number;
  /** Soft-Warnings die das Parsen nicht abgebrochen haben. */
  warnings: string[];
}

export class EsxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsxParseError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Liest ein Slice aus dem Master-Uint8Array mit Bounds-Check. */
function safeSlice(buf: Uint8Array, off: number, len: number): Uint8Array {
  if (off < 0 || off + len > buf.length) {
    throw new EsxParseError(
      `Out-of-bounds read at 0x${off.toString(16)} (length ${len}, file ${buf.length})`
    );
  }
  return buf.subarray(off, off + len);
}

/** 8-byte ASCII name, NUL- oder space-padded. Non-ASCII → '?'. */
function decodeEsxName(raw: Uint8Array): string {
  let end = raw.length;
  // Trailing NUL strippen
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      end = i;
      break;
    }
  }
  let s = "";
  for (let i = 0; i < end; i++) {
    const b = raw[i];
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
    else s += "?";
  }
  return s.replace(/\s+$/, "");
}

/**
 * Konvertiert Big-Endian 16-bit-PCM-Bytes zu Float32 [-1, +1].
 * @param raw Rohbytes aus dem PCM-Bereich (BE i16).
 * @returns Float32Array gleicher Frame-Anzahl (length / 2).
 */
export function be16PcmToFloat32(raw: Uint8Array): Float32Array {
  const frames = (raw.length / 2) | 0;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const hi = raw[i * 2];
    const lo = raw[i * 2 + 1];
    // BE: hi-byte erst. Sign-extend.
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    out[i] = Math.max(-1, Math.min(1, v / 32768));
  }
  return out;
}

/** Liest 6 BE u32 (offsets etc.) aus 24-Byte-Bereich des Mono-Headers. */
function readMonoHeaderFields(body: Uint8Array): {
  off1Start: number;
  off1End: number;
  start: number;
  end: number;
  loopStart: number;
  sampleRate: number;
  sampleTune: number;
  playLevel: number;
} {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  // bytes 8..32 = 6 × u32 BE (off1Start, off1End, start, end, loopStart, sampleRate)
  return {
    off1Start: dv.getUint32(8, false),
    off1End: dv.getUint32(12, false),
    start: dv.getUint32(16, false),
    end: dv.getUint32(20, false),
    loopStart: dv.getUint32(24, false),
    sampleRate: dv.getUint32(28, false),
    sampleTune: dv.getInt16(32, false),
    playLevel: body[34],
  };
}

/** Stereo-Header (44B): 7 × u32 BE (channel-offsets, start, end, sampleRate). */
function readStereoHeaderFields(body: Uint8Array): {
  off1Start: number;
  off1End: number;
  off2Start: number;
  off2End: number;
  start: number;
  end: number;
  sampleRate: number;
  sampleTune: number;
  playLevel: number;
} {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    off1Start: dv.getUint32(8, false),
    off1End: dv.getUint32(12, false),
    off2Start: dv.getUint32(16, false),
    off2End: dv.getUint32(20, false),
    start: dv.getUint32(24, false),
    end: dv.getUint32(28, false),
    sampleRate: dv.getUint32(32, false),
    sampleTune: dv.getInt16(36, false),
    playLevel: body[38],
  };
}

// ─── Pattern-Block-Helpers (v3.5) ────────────────────────────────────────────

/**
 * "Init"-Pattern-Signatur. Nach Pattern-Offset 8 erscheinen genau diese 12
 * Bytes in einem unbenutzten/initialisierten Pattern-Slot. Verifiziert gegen
 * 6+ reale .esx-Files (DUSSELBUNKAAA, etc.).
 *
 *   3c 00 00 00 00 0f 00 3c 00 00 7f ff
 *
 * Sobald die ersten 12 Bytes ab Pattern-Offset 8 EXAKT diese Sequenz haben,
 * ist das Pattern leer (kein User-Inhalt). Real-Patterns weichen mindestens
 * in einem der Bytes ab.
 */
const ESX1_INIT_PATTERN_SIGNATURE = new Uint8Array([
  0x3c, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x3c, 0x00, 0x00, 0x7f, 0xff,
]);

/**
 * Prueft ob ein 4280-Byte Pattern-Block ein "init"/leeres Pattern ist.
 *
 * Heuristik (zwei Wege):
 *   A) Bytes 8..20 matchen die ESX-1 Default-Pattern-Signatur UND
 *      die ersten 8 Bytes (Name) sind alle Space oder NUL.  (real-files)
 *   B) Erste 32 Bytes sind alle 0x00. (synthetisch/unwritten slots)
 *
 * Beide Wege haben False-Negative-Sicherheit: ein echtes Pattern hat
 * niemals all-zero bytes in den ersten 32 Bytes (BPM != 0 sorgt dafuer)
 * und ein init-Pattern hat niemals einen non-empty Namen.
 */
export function isEmptyEsxPattern(raw: Uint8Array): boolean {
  if (raw.length < 20) return true;
  // Weg B: All-Zero (synthetisch/unwritten)
  let allZero = true;
  for (let i = 0; i < 32 && i < raw.length; i++) {
    if (raw[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return true;
  // Weg A: Real-File-Init-Signatur
  const name = decodeEsxName(raw.subarray(0, 8));
  if (name !== "") {
    return false; // expliziter Name → nicht leer
  }
  for (let i = 0; i < ESX1_INIT_PATTERN_SIGNATURE.length; i++) {
    if (raw[8 + i] !== ESX1_INIT_PATTERN_SIGNATURE[i]) return false;
  }
  return true;
}

// ─── v3.20.0: Part-Block-Layout im 4280B Pattern-Block ──────────────────────
//
// Hex-Diff Analyse 2026-05-18 (init vs real Patterns aus BOTTROP/KASSEL/
// ENDLICH/DUSSELBUNKAAA × alle 32 non-empty Patterns):
//
//   Pattern-Block:
//     0x000..0x007 = 8B Name (ASCII)
//     0x008..0x009 = BE u16 BPM×128
//     0x00A..0x017 = 24B Globals (step-length @0x0D, swing @0x0F, …)
//     0x018..0x163 = 10 Drum-Parts × 34B  (Drum 1..10)      ← v3.14 decoded
//     0x16C..0x25B = ~240B Drum-Motion-Sequencer-Daten (15 lanes × 16B,
//                    0xBC neutral fuer Pitch-lanes, 0x02 fuer Switch-lanes)
//     0x25C..0x27D = Part 11 (Stretch 1): 34B-Header gleicher Layout wie Drum
//     0x27E..0x35D = ~224B Motion fuer Stretch + Sample/Slice Parts
//     0x35E..0x3DD = 4 Parts (Sample 1/2, Slice 1/2 oder Synth 1/2):
//                    32B-Stride (16B Header + 16B Step-Trigger)
//                    Positionen: 0x36E, 0x38E, 0x3AE, 0x3CE — siehe
//                    decodeShortPart() unten
//     0x3DE..0x466 = Reserve / Synth-Motion-Lanes
//     0x466..0x488 = Footer (Audio-In + Accent + ff-padding)
//     0x488..      = Per-Step Pitch-Motion-Region (0x80 = neutral)
//
//   v3.20.0 Drum-Part-Layout (34B) — vollstaendig RE-d:
//     +0..+1  = sample-id (BE u16). 0x8000 = unassigned/empty.
//     +2..+3  = constant 'ff 00' (loop/reverse flag — invariant in real files)
//     +4..+7  = EG / mod-fields (best-effort, niedrige Variance)
//     +8      = PITCH (signed i8, 0x40 = neutral = 0 semitones)  ← v3.20 NEU
//     +9      = level (u8, 0..127, init=0x64=100)
//     +10     = pan (u8, 0..127, 64=center)
//     +11     = FX SEND (u8, 0..127, 0=off, 0x7F=max)            ← v3.20 NEU
//     +12..+17 = modulation, lfo (best-effort, not decoded)
//     +18..+33 = 16 step bytes (1 byte/step, bit 0 = active)
//
//   Step-Encoding (verifiziert gegen BOTTROP[0] Part 5/6):
//     bit 0 = trigger active (1 = step gespielt)
//     bits 1..7 = velocity/accent/roll (best-effort, nicht final RE-d)
//
//   v3.20.0 Short-Part-Layout (32B = 16B Header + 16B Steps):
//     +0..+1  = sample-id (BE u16)
//     +2..+5  = mode flags (z.B. 03 7f 00 40 = sample-mode default)
//     +6      = PITCH (signed i8, 0x40 = neutral)
//     +7      = level (u8, 0..127)
//     +8      = pan (u8, 0..127)
//     +9      = ? (often 0x7F)
//     +10     = FX SEND (u8, 0..127, 0=off)
//     +11..+15 = mod flags
//     +16..+31 = 16 step bytes
//
//   Beweis: BOTTROP[1] @0x36E "Sample-Part 1":
//     hdr=00 86 03 7f 00 40 36 7f 40 7f 00 06 82 55 40 00
//     → sampleId=0x86, pitch=0x36 (–10 semi), level=0x7f, pan=0x40, fx=0x00
//     steps=01 00 00 00 01 00 00 00 01 00 00 00 01 00 00 00 (4-on-the-floor)
//
// ═══════════════════════════════════════════════════════════════════════════
// v3.286: KORREKTES Pattern/Part-Layout — verifiziert gegen zwei unabhängige
// Referenzen (skratchdot/open-electribe-editor v1.2.0 EsxUtil.java +
// lammas/electribe src/*.js) und empirisch gegen reale .esx-Files.
//
// Part-Tabelle innerhalb eines 4280-B-Patterns (contiguous, Typ = Position):
//   Drum-Parts:        Offset 24,   9 Parts, Stride 34
//   Keyboard-Parts:    Offset 330,  2 Parts, Stride 274 (128 Note + 128 Gate)
//   Stretch/Slice:     Offset 878,  3 Parts, Stride 32
//   AudioIn:           Offset 974,  1 Part,  156 B
//   Accent:            Offset 1130, 1 Part,  18 B
//
// STEP-TRIGGER (Drum/Stretch/Slice/Accent): die 16 sequenceData-Bytes sind
// eine 128-BIT-BITMASKE — 8 Steps pro Byte, MSB zuerst. Step s → Byte s>>3,
// Bit 7-(s&7). NICHT ein Byte pro Step (das war der Bug: 0x11 & 0x01 = 1 →
// alle Steps "aktiv"). Keyboard-Parts: echte 128 Note- + 128 Gate-Bytes.
// ═══════════════════════════════════════════════════════════════════════════
const ESX1_PART_STRIDE = 34;
const ESX1_PART_HEADER_BYTES = 18;
const ESX1_PART_STEPS_BYTES = 16; // 16 Bytes = 128 Bits = 128 Steps
const ESX1_PATTERN_MAX_STEPS = 128;
const ESX1_DRUM_PART_OFFSET = 24;
const ESX1_DRUM_PARTS_DECODED = 9;
const ESX1_SAMPLEID_OFF_FLAG = 0x8000; // Bit 15 des samplePointer = "off"
const ESX1_SAMPLEID_MASK = 0x7fff; // Bits 0..14 = Sample-ID

/** Stretch/Slice-Parts: Offset 878, 3 Parts, Stride 32, sequenceData @ +16. */
const ESX1_STRETCHSLICE_OFFSET = 878;
const ESX1_STRETCHSLICE_COUNT = 3;
const ESX1_STRETCHSLICE_STRIDE = 32;
const ESX1_STRETCHSLICE_STEPS_OFFSET = 16;
const ESX1_PITCH_NEUTRAL_RAW = 0x40;

// v3.313: Pattern-FX (lammas fxparam.js/pattern.js). 3 Prozessoren à 4 Byte
// direkt hinter dem Accent-Part (1130 + 18 = 1148); FX-Chain @ Byte 12.
const ESX1_FXPARAM_OFFSET = 1148;
const ESX1_FXPARAM_STRIDE = 4;
const ESX1_FX_SLOT_COUNT = 3;
const ESX1_FXCHAIN_OFFSET = 12;
// fxflags-Bits (lammas Common.FXFlags): bits 0-1 FxSelect, bit 2 FxSend.
const ESX1_FXFLAGS_SELECT_MASK = 0x03;
const ESX1_FXFLAGS_SEND_BIT = 0x04;

/** v3.313: fxflags-Byte → { fxSend, fxSelect }. */
function decodeFxFlags(byte: number): { fxSend: boolean; fxSelect: number } {
  return {
    fxSend: (byte & ESX1_FXFLAGS_SEND_BIT) !== 0,
    fxSelect: byte & ESX1_FXFLAGS_SELECT_MASK,
  };
}

// ─── Mute-Status (Pattern-Header) ────────────────────────────────────────────
// PatternHeader-Offset 16: 16-Bit muteStatus (per-Part). Storage-Order der
// Parts: Drum 0..8 → Bits 0..8, Keyboard 0..1 → Bits 9..10, Stretch/Slice 0..2
// → Bits 11..13, AudioIn → Bit 14, Accent → Bit 15.
//
// Polarität (best-effort, gegen reale .esx plausibilisiert): Bit GESETZT = Part
// SPIELT, Bit 0 = Part GEMUTET. (lukn kicks: Maske 0x77FF → nur Bits 11 & 15
// clear = passt zu „fast alles spielt".) Endianness = BE (open-electribe-editor).
// Beide leicht umkehrbar, falls Hardware-Check das Gegenteil zeigt.
const ESX1_MUTE_STATUS_OFFSET = 16;
const ESX1_MUTE_BIT_SET_MEANS_PLAYING = true;
/** Storage-Order-Bit für einen dekodierten Part-Index (0..13). */
function esxMuteBitForPart(partIndex: number): number {
  if (partIndex < 9) return partIndex; // Drum 0..8 → Bit 0..8
  if (partIndex < 12) return 11 + (partIndex - 9); // Stretch/Slice → Bit 11..13
  return 9 + (partIndex - 12); // Keyboard/Synth → Bit 9..10
}
/** true = Part ist gemutet (gemäß Maske + Polarität). */
function esxIsPartMuted(muteMask: number, partIndex: number): boolean {
  const bit = esxMuteBitForPart(partIndex);
  const set = (muteMask & (1 << bit)) !== 0;
  return ESX1_MUTE_BIT_SET_MEANS_PLAYING ? !set : set;
}

// ─── Keyboard-Parts (verifiziert gegen open-electribe-editor v1.2.0) ─────────
// Der ESX-1 hat 2 Keyboard/Synth-Parts, jeder 274 Bytes, direkt nach den 9
// Drum-Parts: Offset 330 (0x14A) + k*274. Anders als Drum-Parts (16 Trigger)
// speichern sie ECHTE 128 Note- + 128 Gate-Bytes — das sind die realen 128-Step-
// Melodiedaten eines Length_8-Patterns. Verifiziert: EsxUtil NUM_PARTS_KEYBOARD=2,
// CHUNKSIZE_PARTS_KEYBOARD=274, NUM_SEQUENCE_DATA_NOTE/GATE=128; Offsets gegen
// reale .esx bestätigt (KEYB0@0x14A / KEYB1@0x25C mit plausiblen Sample/Note/Gate).
const ESX1_KEYBOARD_PART_OFFSET = 330;
const ESX1_KEYBOARD_PART_STRIDE = 274;
const ESX1_KEYBOARD_PART_COUNT = 2;
const ESX1_KEYBOARD_NOTE_OFFSET = 18; // 128 Note-Bytes
const ESX1_KEYBOARD_GATE_OFFSET = 146; // 128 Gate-Bytes
const ESX1_KEYBOARD_SEQ_LEN = 128;

/**
 * v3.23.0: Decoded ein einzelnes step-byte zu {active, velocity, accent}.
 *
 * Verifiziertes Bit-Layout (siehe Header-Doc v3.23.0):
 *   bit 0 = trigger active
 *   bit 4 = accent (Best-Effort, 70.9% Drum + 38.2% Short der active-steps)
 *
 * Mapping-Konvention:
 *   active + accent → velocity 127 (TR-style boost)
 *   active ohne accent → velocity 100 (Default)
 *   inactive → velocity 0, accent weggelassen (undefined)
 *
 * Wir mappen explizit die zwei verifizierten Bits — die Bits 1..3, 5..7
 * bleiben nicht-RE-d und werden NICHT als Pseudo-Velocity exportiert
 * (vermeidet false-positive Note-Encodings).
 */
/**
 * v3.286: Dekodiert die 16 sequenceData-Bytes eines Drum/Stretch/Slice/Accent-
 * Parts als 128-BIT-BITMASKE (8 Steps pro Byte, MSB zuerst) → boolean[128].
 *
 * Step s liegt in Byte (s>>3), Bit (7 − (s&7)). Verifiziert gegen
 * lammas/electribe DrumSequenceSteps + real .esx (lukn kicks Part0 →
 * Steps 3,7,11,15,… statt fälschlich „alle 16 aktiv").
 */
function decodeSequenceBitmask(raw: Uint8Array, seqOff: number): boolean[] {
  const out = new Array<boolean>(ESX1_PATTERN_MAX_STEPS).fill(false);
  for (let s = 0; s < ESX1_PATTERN_MAX_STEPS; s++) {
    const byte = raw[seqOff + (s >> 3)] ?? 0;
    const bit = 7 - (s & 7);
    out[s] = (byte & (1 << bit)) !== 0;
  }
  return out;
}

/**
 * Wandelt das +8-byte (Pitch) eines Drum/Short-Part-Headers in Semitones um.
 *
 * Signed-Two's-Complement, neutral bei 0x40 (= 0 semitones). Range: 0x00..0x7F
 * mapped auf -64..+63 semitones (Hardware-Range). Werte ueber 0x7F treten in
 * Real-Files in KASSEL.esx auf — wir interpretieren sie als signed i8 (range
 * 0x80..0xFF = -128..-1) und klampen dann auf das gleiche -64..+63-Fenster
 * (Hardware-Limit).
 */
function decodePitchByte(rawByte: number): number {
  const b = rawByte & 0xff;
  // Most files: 0x00..0x7F. Klammere die Two's-Komplement-Interpretation auf
  // das Hardware-Fenster -64..+63 fuer Konsistenz.
  const signed = b - ESX1_PITCH_NEUTRAL_RAW;
  if (signed < -64) return -64;
  if (signed > 63) return 63;
  return signed;
}

/** Liest den samplePointer (BE u16) → {sampleId, off}. Bit 15 = off-flag. */
function decodeSamplePointer(
  raw: Uint8Array,
  off: number
): {
  sampleId: number;
  off: boolean;
} {
  const sp = ((raw[off] ?? 0) << 8) | (raw[off + 1] ?? 0);
  return {
    sampleId: sp & ESX1_SAMPLEID_MASK,
    off: (sp & ESX1_SAMPLEID_OFF_FLAG) !== 0,
  };
}

/** Baut die 128 EsxStepEvents eines Drum/Stretch/Slice-Parts aus der Bitmaske. */
function bitmaskToSteps(raw: Uint8Array, seqOff: number): EsxStepEvent[] {
  const bits = decodeSequenceBitmask(raw, seqOff);
  return bits.map(active => ({ active, velocity: active ? 100 : 0 }));
}

/**
 * v3.293: Byte-Offsets der Filter/Mod-Felder INNERHALB eines Parts, je Part-Typ
 * (verifiziert gegen open-electribe-editor v1.2.0). Drum und Keyboard teilen
 * Level/Pan/Fx/Mod-Offsets; Keyboard schiebt nur den Filter-Sub-Block um +1
 * (glide@4), Stretch/Slice den ganzen Block um −2 (kein sliceNumber/reserved).
 */
interface EsxFilterLayout {
  filterType: number;
  cutoff: number;
  resonance: number;
  egIntensity: number;
  modByte: number;
  modSpeed: number;
  modDepth: number;
}
const ESX_FILTER_LAYOUT_DRUM: EsxFilterLayout = {
  filterType: 4,
  cutoff: 5,
  resonance: 6,
  egIntensity: 7,
  modByte: 14,
  modSpeed: 15,
  modDepth: 16,
};
const ESX_FILTER_LAYOUT_KEYBOARD: EsxFilterLayout = {
  filterType: 5, // glide@4 schiebt den Filter-Sub-Block +1
  cutoff: 6,
  resonance: 7,
  egIntensity: 8,
  modByte: 14,
  modSpeed: 15,
  modDepth: 16,
};
const ESX_FILTER_LAYOUT_STRETCHSLICE: EsxFilterLayout = {
  filterType: 2, // kein sliceNumber/reserved → gesamter Block −2
  cutoff: 3,
  resonance: 4,
  egIntensity: 5,
  modByte: 12,
  modSpeed: 13,
  modDepth: 14,
};

/** Liest den (verifizierten) Filter/Mod-Block eines Parts. */
function decodeEsxFilter(
  raw: Uint8Array,
  partOff: number,
  o: EsxFilterLayout
): EsxPartFilter {
  const b = (i: number) => Math.max(0, Math.min(127, raw[partOff + i] ?? 0));
  const modRaw = raw[partOff + o.modByte] ?? 0;
  return {
    filterType: (raw[partOff + o.filterType] ?? 0) & 0x03,
    cutoff: b(o.cutoff),
    resonance: b(o.resonance),
    egIntensity: b(o.egIntensity),
    modDest: modRaw & 0x07, // bits 0-2
    modType: (modRaw >> 4) & 0x07, // bits 4-6
    modSpeed: b(o.modSpeed),
    modDepth: b(o.modDepth),
  };
}

/**
 * v3.286: Decoded einen Drum-Part (Index 0..8, 9 Parts) @ 24 + i*34.
 * Layout (PartDrumImpl.java): samplePointer BE @0 (bit15=off), pitch@8,
 * level@9, pan@10, sequenceData @+18 (16 Byte = 128-Bit-Maske).
 */
function decodeDrumPart(
  raw: Uint8Array,
  partIndex: number
):
  | {
      sampleId: number;
      volume: number;
      pan: number;
      pitch: number;
      fxAmount: number;
      egTime: number;
      filter: EsxPartFilter;
      steps: EsxStepEvent[];
    }
  | undefined {
  if (partIndex < 0 || partIndex >= ESX1_DRUM_PARTS_DECODED) return undefined;
  const partOff = ESX1_DRUM_PART_OFFSET + partIndex * ESX1_PART_STRIDE;
  if (partOff + ESX1_PART_STRIDE > raw.length) return undefined;

  const { sampleId, off } = decodeSamplePointer(raw, partOff);
  const pitch = decodePitchByte(raw[partOff + 8] ?? ESX1_PITCH_NEUTRAL_RAW);
  const volume = Math.max(0, Math.min(127, raw[partOff + 9] ?? 100));
  const pan = Math.max(0, Math.min(127, raw[partOff + 10] ?? 64));
  // v3.312: egtime @+11 (lammas drumpart.js: ...level@9, pan@10, egtime@11)
  const egTime = Math.max(0, Math.min(127, raw[partOff + 11] ?? 127));
  // v3.313: fxflags @+13 (egtime@11, startpoint@12, fxflags@13)
  const { fxSend, fxSelect } = decodeFxFlags(raw[partOff + 13] ?? 0);
  const filter = decodeEsxFilter(raw, partOff, ESX_FILTER_LAYOUT_DRUM);
  const steps = bitmaskToSteps(raw, partOff + ESX1_PART_HEADER_BYTES);
  return {
    sampleId: off ? 0 : sampleId,
    volume,
    pan,
    pitch,
    fxAmount: 0,
    egTime,
    fxSend,
    fxSelect,
    filter,
    steps,
  };
}

/**
 * v3.286: Decoded einen Stretch/Slice-Part (Index 0..2, 3 Parts) @ 878 + i*32.
 * 32-Byte-Layout: 16-Byte-Header + 16-Byte sequenceData (128-Bit-Maske) @ +16.
 * v3.293: Offsets korrigiert (open-electribe-editor v1.2.0 PartStretchSliceImpl):
 * kein sliceNumber/reserved → pitch@6, level@7, pan@8 (vorher fälschlich @8/9/10).
 */
function decodeStretchSlicePart(
  raw: Uint8Array,
  index: number
):
  | {
      sampleId: number;
      volume: number;
      pan: number;
      pitch: number;
      fxAmount: number;
      egTime: number;
      filter: EsxPartFilter;
      steps: EsxStepEvent[];
    }
  | undefined {
  if (index < 0 || index >= ESX1_STRETCHSLICE_COUNT) return undefined;
  const partOff = ESX1_STRETCHSLICE_OFFSET + index * ESX1_STRETCHSLICE_STRIDE;
  if (partOff + ESX1_STRETCHSLICE_STRIDE > raw.length) return undefined;
  const { sampleId, off } = decodeSamplePointer(raw, partOff);
  const pitch = decodePitchByte(raw[partOff + 6] ?? ESX1_PITCH_NEUTRAL_RAW);
  const volume = Math.max(0, Math.min(127, raw[partOff + 7] ?? 100));
  const pan = Math.max(0, Math.min(127, raw[partOff + 8] ?? 64));
  // v3.312: egtime @+9 (Stretch/Slice-Block um -2 verschoben, s. v3.293)
  const egTime = Math.max(0, Math.min(127, raw[partOff + 9] ?? 127));
  // v3.313: fxflags @+11 (Block -2 gegenueber Drum: 13-2)
  const { fxSend, fxSelect } = decodeFxFlags(raw[partOff + 11] ?? 0);
  const filter = decodeEsxFilter(raw, partOff, ESX_FILTER_LAYOUT_STRETCHSLICE);
  const steps = bitmaskToSteps(raw, partOff + ESX1_STRETCHSLICE_STEPS_OFFSET);
  return {
    sampleId: off ? 0 : sampleId,
    volume,
    pan,
    pitch,
    fxAmount: 0,
    egTime,
    fxSend,
    fxSelect,
    filter,
    steps,
  };
}

/**
 * v3.286: Decoded einen Keyboard/Synth-Part (Index 0..1) @ 330 + k*274.
 * Layout (PartKeyboardImpl.java): samplePointer BE @0, level@9, pan@10,
 * sequenceDataNote @+18 (128 Byte), sequenceDataGate @+146 (128 Byte).
 *
 * Note-Byte: bit7 = OFF-Flag (MSBOff8) → Note-on wenn (note & 0x80)==0,
 * Note-Nummer = note & 0x7f. Gate = Gate-Länge. Verifiziert empirisch gegen
 * lukn kicks (KB1 = Note-on jeden 4. Step, Noten 39–41 = Bassline).
 *
 * Liefert (a) die rohen note/gate-Arrays (EsxKeyboardPart, Kompat) UND
 * (b) 128 EsxStepEvents mit note/gate für den melodischen Import.
 */
function decodeKeyboardPart(
  raw: Uint8Array,
  keyIndex: number
):
  | (EsxKeyboardPart & { steps: EsxStepEvent[]; filter: EsxPartFilter })
  | undefined {
  if (keyIndex < 0 || keyIndex >= ESX1_KEYBOARD_PART_COUNT) return undefined;
  const partOff =
    ESX1_KEYBOARD_PART_OFFSET + keyIndex * ESX1_KEYBOARD_PART_STRIDE;
  if (partOff + ESX1_KEYBOARD_PART_STRIDE > raw.length) return undefined;
  const { sampleId, off } = decodeSamplePointer(raw, partOff);
  const volume = Math.max(0, Math.min(127, raw[partOff + 9] ?? 100));
  const pan = Math.max(0, Math.min(127, raw[partOff + 10] ?? 64));
  // v3.312: egtime @+11 — Keyboard teilt die Level/Pan/EG-Offsets mit Drum
  // (nur der Filter-Sub-Block ist um +1 verschoben, s. v3.293).
  const egTime = Math.max(0, Math.min(127, raw[partOff + 11] ?? 127));
  // v3.313: fxflags @+13 (geteilte Fx-Offsets mit Drum, s. v3.293)
  const { fxSend, fxSelect } = decodeFxFlags(raw[partOff + 13] ?? 0);
  const filter = decodeEsxFilter(raw, partOff, ESX_FILTER_LAYOUT_KEYBOARD);
  const noteOff = partOff + ESX1_KEYBOARD_NOTE_OFFSET;
  const gateOff = partOff + ESX1_KEYBOARD_GATE_OFFSET;
  const note = raw.slice(noteOff, noteOff + ESX1_KEYBOARD_SEQ_LEN);
  const gate = raw.slice(gateOff, gateOff + ESX1_KEYBOARD_SEQ_LEN);

  const steps: EsxStepEvent[] = new Array(ESX1_KEYBOARD_SEQ_LEN);
  for (let s = 0; s < ESX1_KEYBOARD_SEQ_LEN; s++) {
    const nb = note[s] ?? 0x80;
    const active = (nb & 0x80) === 0; // bit7 = OFF-Flag
    steps[s] = active
      ? { active: true, velocity: 100, note: nb & 0x7f, gate: gate[s] ?? 0 }
      : { active: false, velocity: 0 };
  }
  return {
    partIndex: keyIndex,
    sampleId: off ? 0 : sampleId,
    volume,
    pan,
    egTime,
    fxSend,
    fxSelect,
    note,
    gate,
    filter,
    steps,
  };
}

/**
 * Parst ein einzelnes Pattern aus dem 4280-Byte-Block.
 *
 * @param raw          Der 4280-Byte Pattern-Block (NICHT der ganze File-Buffer).
 * @param patternIndex 0..255 — der Pattern-Slot-Index.
 * @returns Geparstes Pattern oder null wenn der Block leer ist.
 *
 * Verifizierte Felder (gegen reale .esx-Files am 2026-05-18):
 *   Offset 0..7  : 8-byte ASCII name (space/NUL-padded)
 *   Offset 8..9  : BE u16 = BPM × 128
 *   Offset 13    : step-length-1 (init=0x0F → 16 Steps)
 *
 * v3.14.0: Drum-Parts 0..9 (Drum 1..10) decoded:
 *   - sampleId, volume, pan aus 34-byte Part-Header
 *   - 16 steps mit trigger-active (bit 0)
 *   Beweis: BOTTROP[0] Part 5 dekodiert zu 4-on-the-floor Kick (1,5,9,13).
 *
 * v3.20.0 NEU:
 *   - Pitch (Drum-Part +8 signed i8, neutral 0x40 = 0 semitones)
 *   - FxSend (Drum-Part +11, u8 0..127)
 *   - Part 10 (Stretch): 34B-Header @ 0x25C — gleicher Layout wie Drum
 *   - Parts 11..14 (Sample/Slice/Synth): 32B-Stride (16B+16B) @
 *     0x36E, 0x38E, 0x3AE, 0x3CE
 *   - Part 15 (Audio-In): bleibt Defaults (in Real-Files keine Trigger)
 *
 * Best-Effort:
 *   Offset 12    : roll-type (init=0x00)
 *   Offset 15    : swing (init=0x3c)
 */
/**
 * Dekodiert die Pattern-Länge (patternLength = Length_1..Length_8) aus dem
 * gepackten Byte 11 des ESX-1-Pattern-Blocks. Rein + testbar.
 *
 * Verifiziert gegen open-electribe-editor v1.2.0 (EsxUtil / esx.ecore:
 * `PatternLength` EEnum-Literale Length_1..Length_8, gespeichert als 0..7) UND
 * gegen reale .esx-Dateien (Byte 11 ∈ {0x00 → Length_1, 0x07 → Length_8}).
 *
 * Die ESX-1 speichert 16 Trigger-Steps pro Drum-Part; `patternLength` ist ein
 * Wiederhol-/Längen-Multiplikator → effektive Länge = patternLength × 16.
 */
export function decodeEsxPatternLength(byte11: number): {
  length: number;
  effectiveSteps: number;
} {
  const length = (byte11 & 0x07) + 1; // low 3 bits = Length_1..Length_8 index
  return { length, effectiveSteps: length * ESX1_DEFAULT_STEPS };
}

export function parseEsxPattern(
  raw: Uint8Array,
  patternIndex: number
): EsxPattern | null {
  if (raw.length !== ESX1_CHUNKSIZE_PATTERN) {
    throw new EsxParseError(
      `parseEsxPattern: erwarte ${ESX1_CHUNKSIZE_PATTERN} bytes, bekam ${raw.length}`
    );
  }
  if (isEmptyEsxPattern(raw)) return null;

  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const name = decodeEsxName(raw.subarray(0, 8));

  // BPM: BE u16 / 128, geklemmt auf 20..300
  const bpmRaw = dv.getUint16(8, false);
  let bpm = bpmRaw / 128;
  if (!Number.isFinite(bpm) || bpm < 20) bpm = 20;
  if (bpm > 300) bpm = 300;

  // Step-length-Indikator: byte 13. init=0x0F → 16 Steps (0-based count).
  // Wir klamern auf 1..64 als Hardware-plausibles Maximum.
  const stepIndicator = raw[13];
  let lengthSteps = (stepIndicator & 0x7f) + 1;
  if (!Number.isFinite(lengthSteps) || lengthSteps < 1)
    lengthSteps = ESX1_DEFAULT_STEPS;
  if (lengthSteps > 64) lengthSteps = ESX1_DEFAULT_STEPS;

  // Pattern-Länge (Wiederhol-Multiplikator) aus Byte 11 — verifiziert gegen
  // open-electribe-editor. effectiveSteps = patternLength × 16 (16..128).
  const { length: patternLength, effectiveSteps } = decodeEsxPatternLength(
    raw[11]
  );

  // Swing: byte 15, Best-Effort, geklemmt 0..100.
  let swing = raw[15] & 0x7f;
  if (swing > 100) swing = 100;

  // v3.287: muteStatus @16 (BE u16) → per-Part-Mute.
  const muteMask = dv.getUint16(ESX1_MUTE_STATUS_OFFSET, false);

  // Build 16 Parts. v3.20.0:
  //   v3.286 (verifiziertes Layout):
  //   parts 0..8   → decodeDrumPart          (9 Drum, Stride 34 @ 24)
  //   parts 9..11  → decodeStretchSlicePart  (3 Stretch/Slice, Stride 32 @ 878)
  //   parts 12..13 → decodeKeyboardPart      (2 Keyboard/Synth, Stride 274 @ 330)
  // Alle Step-Trigger sind 128-Bit-Bitmasken; Keyboard-Parts liefern zusätzlich
  // note/gate pro Step (melodischer Import).
  const parts: EsxPart[] = [];
  const keyboardParts: EsxKeyboardPart[] = [];

  const pushPart = (
    decoded:
      | {
          sampleId: number;
          volume: number;
          pan: number;
          pitch: number;
          fxAmount: number;
          egTime?: number;
          fxSend?: boolean;
          fxSelect?: number;
          filter?: EsxPartFilter;
          steps: EsxStepEvent[];
        }
      | undefined
  ) => {
    const partIndex = parts.length;
    const muted = esxIsPartMuted(muteMask, partIndex);
    if (decoded) {
      parts.push({ partIndex, muted, ...decoded });
    } else {
      parts.push({
        partIndex,
        sampleId: 0,
        volume: 100,
        pan: 64,
        pitch: 0,
        fxAmount: 0,
        muted,
        steps: new Array(ESX1_PATTERN_MAX_STEPS)
          .fill(null)
          .map(() => ({ active: false, velocity: 0 })),
      });
    }
  };

  for (let p = 0; p < ESX1_DRUM_PARTS_DECODED; p++)
    pushPart(decodeDrumPart(raw, p));
  for (let i = 0; i < ESX1_STRETCHSLICE_COUNT; i++)
    pushPart(decodeStretchSlicePart(raw, i));
  for (let k = 0; k < ESX1_KEYBOARD_PART_COUNT; k++) {
    const kp = decodeKeyboardPart(raw, k);
    if (kp) {
      const {
        steps,
        note,
        gate,
        sampleId,
        volume,
        pan,
        egTime,
        fxSend,
        fxSelect,
        partIndex,
        filter,
      } = kp;
      keyboardParts.push({
        partIndex,
        sampleId,
        volume,
        pan,
        egTime,
        fxSend,
        fxSelect,
        note,
        gate,
      });
      pushPart({
        sampleId,
        volume,
        pan,
        pitch: 0,
        fxAmount: 0,
        egTime,
        fxSend,
        fxSelect,
        filter,
        steps,
      });
    } else {
      pushPart(undefined);
    }
  }

  // v3.313: Pattern-FX (3 Prozessoren @1148, je fxtype/edit1/edit2) + Chain
  // (Byte 12). Werte defensiv geklemmt; motionseqstatus (4. Byte) ignoriert.
  const fx: EsxFxSlot[] = [];
  for (let f = 0; f < ESX1_FX_SLOT_COUNT; f++) {
    const fo = ESX1_FXPARAM_OFFSET + f * ESX1_FXPARAM_STRIDE;
    fx.push({
      fxType: (raw[fo] ?? 0) & 0x0f,
      edit1: Math.min(127, raw[fo + 1] ?? 0),
      edit2: Math.min(127, raw[fo + 2] ?? 0),
    });
  }
  const fxChain = (raw[ESX1_FXCHAIN_OFFSET] ?? 0) & 0x03;

  return {
    index: patternIndex,
    name,
    bpm,
    lengthSteps,
    patternLength,
    effectiveSteps,
    swing,
    muteMask,
    parts,
    keyboardParts,
    fx,
    fxChain,
    raw,
  };
}

/** Reads PCM-Bytes from the absolute payload region with defense in depth. */
function readPcmRange(
  buf: Uint8Array,
  relStart: number,
  relEnd: number,
  slotIndex: number,
  channelLabel: string
): Uint8Array {
  const absStart = ESX1_ADDR_SAMPLE_DATA + relStart;
  const absEnd = ESX1_ADDR_SAMPLE_DATA + relEnd;
  if (absStart > buf.length || absEnd > buf.length) {
    throw new EsxParseError(
      `slot ${slotIndex} (${channelLabel}): PCM range 0x${absStart.toString(16)}..0x${absEnd.toString(16)} escapes file (size 0x${buf.length.toString(16)})`
    );
  }
  const length = relEnd - relStart;
  if (length > MAX_BYTES_PER_SLOT) {
    throw new EsxParseError(
      `slot ${slotIndex} (${channelLabel}): pcm length ${length} bytes exceeds per-slot cap ${MAX_BYTES_PER_SLOT}`
    );
  }
  return buf.subarray(absStart, absEnd);
}

// ─── Song-Block-Helpers (v3.89.0) ────────────────────────────────────────────

/**
 * Init-Signatur eines leeren ESX-1 Song-Slots (528 Bytes).
 *
 * Reverse-Engineering 2026-05-19: Konfiguration ueber 38 .esx-Files:
 *   - First 8 bytes:  0x20 0x20 0x20 0x20 0x20 0x20 0x20 0x20   (8 spaces)
 *   - Offset 8:       0x3c                                       (BPM-Hint = 60)
 *   - Offset 9..527:  all 0x00
 *
 * 32 von 64 Songs in KASSEL.esx zeigen exakt dieses Pattern. Sobald
 * Bytes davon abweichen, ist der Slot nicht-leer.
 */
const ESX1_SONG_INIT_NAME = 0x20;
const ESX1_SONG_INIT_BPM_BYTE = 0x3c; // 60

/** End-of-song-Marker im trailing data-field eines song-events. */
export const ESX1_SONG_EVENT_END_MARKER = 0xffff;

/** Hardening-Cap: max events pro Song (defense gegen aufgeblaehte Files). */
const ESX1_MAX_EVENTS_PER_SONG = 4096;

/** Hardening-Cap: max total events in der globalen Event-Region. */
const ESX1_MAX_TOTAL_EVENTS = 64 * ESX1_MAX_EVENTS_PER_SONG;

/**
 * v3.90.0: Hard-stop fuer Events ohne end-marker.
 *
 * Real-Files koennen mal aus Versehen ohne 0xFFFF-Terminator enden (corrupt
 * oder partial-write). Damit der Loop nicht alle 262144 Frames bis zum
 * absoluten Cap weiterlaeuft, brechen wir nach 1000 non-terminator-Events
 * vorzeitig ab und fuegen ein warning hinzu.
 */
const ESX1_MAX_ITERATIONS_NO_END = 1000;

/**
 * v3.90.0: Init-Length-Marker — 0xF7 in length-field bedeutet
 * "uninitialized" (kein gueltiger Repeat-Count). Solche Events werden
 * im Parser uebersprungen.
 */
const ESX1_SONG_EVENT_LENGTH_INIT = 0xf7;

/**
 * Pruefft ob ein 528B Song-Block ein "init"/leeres Song-Slot ist.
 *
 * Heuristik (zwei Wege):
 *   A) Bytes 0..7 sind alle 0x20 (Space) UND bytes 8..527 matchen
 *      die init-Signatur (0x3c, dann 519x 0x00).
 *   B) Erste 16 Bytes sind alle 0x00 (synthetisch/unwritten).
 *
 * Beide Wege haben False-Negative-Sicherheit: ein User-Song hat in
 * mindestens einem Byte abweichende Werte. Real-File-Verifikation gegen
 * KASSEL.esx (Song[0..30] alle empty, Song[31+] alle non-empty).
 */
export function isEmptyEsxSong(raw: Uint8Array): boolean {
  if (raw.length < 16) return true;
  // Weg B: All-Zero (synthetisch)
  let allZero = true;
  for (let i = 0; i < 16 && i < raw.length; i++) {
    if (raw[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return true;
  // Weg A: Init-Signature
  // Bytes 0..7 = 0x20
  for (let i = 0; i < 8; i++) {
    if (raw[i] !== ESX1_SONG_INIT_NAME) return false;
  }
  // Byte 8 = 0x3c
  if (raw[8] !== ESX1_SONG_INIT_BPM_BYTE) return false;
  // Bytes 9..527 = 0x00
  const limit = Math.min(raw.length, ESX1_CHUNKSIZE_SONG);
  for (let i = 9; i < limit; i++) {
    if (raw[i] !== 0x00) return false;
  }
  return true;
}

/**
 * Parst ein einzelnes 528B Song-Slot zu einem {@link EsxSong} oder null
 * wenn der Slot leer ist.
 *
 * @param raw        Die 528 Bytes des Song-Blocks (NICHT der ganze File-Buffer).
 * @param songIndex  0..63 — Song-Slot-Index.
 * @param events     Optional die bereits dem Song zugeordneten Events
 *                   (extrahiert aus der globalen Event-Region 0x138400+).
 *
 * Verifizierte Felder:
 *   - Offset 0..7  : 8-byte ASCII name (space/NUL-padded). Empty-Slot → ''.
 *   - Offset 8     : u8 BPM-Hint (init=0x3c=60).
 *
 * Best-Effort:
 *   - Restliche 519 Bytes sind nicht final reverse-engineered und werden
 *     im `raw`-Feld zur weiteren Analyse erhalten.
 *
 * @returns EsxSong oder null wenn empty.
 */
export function parseEsxSong(
  raw: Uint8Array,
  songIndex: number,
  events: EsxSongEvent[] = []
): EsxSong | null {
  if (raw.length !== ESX1_CHUNKSIZE_SONG) {
    throw new EsxParseError(
      `parseEsxSong: erwarte ${ESX1_CHUNKSIZE_SONG} bytes, bekam ${raw.length}`
    );
  }
  if (isEmptyEsxSong(raw)) return null;

  const name = decodeEsxName(raw.subarray(0, 8));
  const bpmByte = raw[8] ?? ESX1_SONG_INIT_BPM_BYTE;
  // Defensive: BPM-Hint in plausibles Hardware-Fenster (20..300).
  let bpm = bpmByte;
  if (!Number.isFinite(bpm) || bpm < 20) bpm = 20;
  if (bpm > 300) bpm = 300;

  // Cap events to defensive limit.
  const cappedEvents = events.slice(0, ESX1_MAX_EVENTS_PER_SONG);

  return {
    index: songIndex,
    name,
    bpm,
    eventCount: cappedEvents.length,
    events: cappedEvents,
    raw,
  };
}

/**
 * Parst die globale Song-Event-Region (0x138400+) zu Event-Frames pro Song.
 *
 * Format pro Event (8 Bytes, BE):
 *   +0..+1 = time (BE u16)
 *   +2     = pattern (u8)
 *   +3     = length (u8)
 *   +4..+5 = flags (BE u16)
 *   +6..+7 = data (BE u16; 0xFFFF = end-of-song marker)
 *
 * Pro Song werden Events bis zum ersten 0xFFFF-Marker gesammelt
 * (exklusive Marker selbst). Bei Region-Truncate werden warning-Hinweise
 * generiert und nur die intakten Events zurueckgegeben.
 *
 * @returns Tuple [eventsPerSong, warnings]: eventsPerSong[i] = Events fuer Song i.
 */
export function parseEsxSongEvents(
  buf: Uint8Array,
  numSongs: number = ESX1_NUM_SONGS
): { eventsPerSong: EsxSongEvent[][]; warnings: string[] } {
  const eventsPerSong: EsxSongEvent[][] = new Array(numSongs);
  for (let i = 0; i < numSongs; i++) eventsPerSong[i] = [];
  const warnings: string[] = [];

  const start = ESX1_ADDR_SONG_EVENT_DATA;
  if (start >= buf.length) {
    warnings.push(
      `song-event region missing: file ${buf.length} < expected start 0x${start.toString(16)}`
    );
    return { eventsPerSong, warnings };
  }

  // Defensive: Event-Region endet entweder bei ESX1_ADDR_VALID_CHECK_2 (0x1B0000)
  // oder am File-Ende, je nachdem was zuerst kommt.
  const end = Math.min(0x1b0000, buf.length);
  if (end <= start) {
    warnings.push(
      `song-event region empty: start 0x${start.toString(16)} >= end 0x${end.toString(16)}`
    );
    return { eventsPerSong, warnings };
  }

  const maxBytes = end - start;
  const maxFrames = Math.min(
    Math.floor(maxBytes / ESX1_CHUNKSIZE_SONG_EVENT),
    ESX1_MAX_TOTAL_EVENTS
  );

  let currentSong = 0;
  // v3.90.0: Hard-stop counter for runs without end-marker. Resets on
  // every 0xFFFF-terminator hit. If the counter exceeds the cap we break
  // out of the loop and warn — defends against corrupted files that have
  // 200,000+ non-terminator frames.
  let iterationsSinceLastEnd = 0;
  const dv = new DataView(
    buf.buffer,
    buf.byteOffset + start,
    maxFrames * ESX1_CHUNKSIZE_SONG_EVENT
  );
  for (let f = 0; f < maxFrames; f++) {
    const off = f * ESX1_CHUNKSIZE_SONG_EVENT;
    const time = dv.getUint16(off, false);
    const pattern = dv.getUint8(off + 2);
    const length = dv.getUint8(off + 3);
    const flags = dv.getUint16(off + 4, false);
    const data = dv.getUint16(off + 6, false);

    // Defensive: an all-zero frame indicates padding past the actual event-stream.
    // ESX-1 event-regions are typically 480KB+ and zero-padded after real events.
    // We stop reading at the first all-zero frame to avoid filling songs with
    // pseudo-events.
    if (
      time === 0 &&
      pattern === 0 &&
      length === 0 &&
      flags === 0 &&
      data === 0
    ) {
      break;
    }

    const event: EsxSongEvent = { time, pattern, length, flags, data };

    if (data === ESX1_SONG_EVENT_END_MARKER) {
      // End-of-song-Marker: schliesse den aktuellen Song ab und gehe zum naechsten.
      if (currentSong < numSongs) {
        eventsPerSong[currentSong].push(event);
        currentSong++;
      }
      iterationsSinceLastEnd = 0; // reset hard-stop counter
      if (currentSong >= numSongs) break; // alle Songs gefuellt
      continue;
    }

    // v3.90.0: Hard-stop after N iterations without end-marker. Prevents
    // infinite-loop / runaway parsing on malformed data. We emit the warning
    // only when we've already seen at least one end-marker (i.e. we know the
    // file has real song-data and the runaway is suspect) — when the
    // event-region appears to be pure garbage (no end-marker yet), we just
    // break silently to avoid polluting warnings on files that don't use
    // the song-feature at all.
    iterationsSinceLastEnd++;
    if (iterationsSinceLastEnd > ESX1_MAX_ITERATIONS_NO_END) {
      if (currentSong > 0) {
        warnings.push(
          `song-event stream exceeded ${ESX1_MAX_ITERATIONS_NO_END} events without end-marker; aborting parse at frame ${f}`
        );
      }
      break;
    }

    // v3.90.0: length=0xF7 means "uninitialized" — skip event so it doesn't
    // get assigned a bogus repeat-count downstream. Real ESX-1 files use
    // 0x01..0x10 (1..16 repeats) for actual song-arrangement entries.
    if (length === ESX1_SONG_EVENT_LENGTH_INIT) {
      continue;
    }

    if (currentSong < numSongs) {
      const arr = eventsPerSong[currentSong];
      if (arr.length < ESX1_MAX_EVENTS_PER_SONG) {
        arr.push(event);
      }
    }
  }

  return { eventsPerSong, warnings };
}

/**
 * Parst alle 64 Song-Slots ab 0x130000 zu einem {@link EsxSong}-Array.
 *
 * Leere Init-Slots werden NICHT in das Output-Array aufgenommen. Bei
 * truncierten Files werden warnings generiert und nur die intakten
 * Slots zurueckgegeben.
 *
 * @returns Tuple [songs, warnings].
 */
export function parseEsxSongs(buf: Uint8Array): {
  songs: EsxSong[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const songs: EsxSong[] = [];

  const songsStart = ESX1_ADDR_SONG_DATA;
  const songsEnd = songsStart + ESX1_NUM_SONGS * ESX1_CHUNKSIZE_SONG;
  if (songsStart >= buf.length) {
    warnings.push(
      `song area missing: file ${buf.length} < expected start 0x${songsStart.toString(16)}`
    );
    return { songs, warnings };
  }
  if (songsEnd > buf.length) {
    warnings.push(
      `song area truncated: file ${buf.length} < required end ${songsEnd}`
    );
  }

  // Parse events first so we can attach them per-song.
  const { eventsPerSong, warnings: evtWarnings } = parseEsxSongEvents(buf);
  warnings.push(...evtWarnings);

  const usableEnd = Math.min(songsEnd, buf.length);
  for (let i = 0; i < ESX1_NUM_SONGS; i++) {
    const off = songsStart + i * ESX1_CHUNKSIZE_SONG;
    if (off + ESX1_CHUNKSIZE_SONG > usableEnd) break;
    try {
      const block = buf.subarray(off, off + ESX1_CHUNKSIZE_SONG);
      const song = parseEsxSong(block, i, eventsPerSong[i] ?? []);
      if (song !== null) songs.push(song);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`song ${i}: ${msg}`);
    }
  }

  return { songs, warnings };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parst eine ESX-1 .esx Datei aus einem ArrayBuffer/Uint8Array.
 *
 * @throws {EsxParseError} bei kaputten Magic-Bytes, ungültiger Größe oder
 *   wenn ein Sample-Slot über die Datei hinaus zeigt.
 *
 * Soft-Errors (z.B. Slot mit invertiertem Offset) führen NICHT zum Abbruch,
 * sondern landen in {@link EsxBank.warnings}.
 */
/** Optionen für {@link parseEsxBank}. */
export interface ParseEsxBankOptions {
  /**
   * v3.285 — Wenn true, wird das PCM NICHT zu Float32 dekodiert (pcmData bleibt
   * leer). Alle Metadaten (Name/Index/Kanäle/Rate/Frames/Loop/Level, Patterns,
   * Songs) werden trotzdem vollständig gelesen. Für schnelles Scannen großer
   * Bänke / vieler Dateien (spart die 2×-Float32-Expansion pro Sample).
   */
  headersOnly?: boolean;
}

const EMPTY_F32 = new Float32Array(0);

export function parseEsxBank(
  input: ArrayBuffer | Uint8Array,
  source = "<bytes>",
  opts: ParseEsxBankOptions = {}
): EsxBank {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const headersOnly = opts.headersOnly === true;

  // ── 1. Size-Checks ────────────────────────────────────────────────────────
  if (buf.length < ESX1_SIZE_FILE_MIN) {
    throw new EsxParseError(
      `file too small to be a valid .esx: ${buf.length} bytes (need >= ${ESX1_SIZE_FILE_MIN})`
    );
  }
  if (buf.length > ESX_FILE_MAX_BYTES) {
    throw new EsxParseError(
      `file size ${buf.length} exceeds max ${ESX_FILE_MAX_BYTES}`
    );
  }

  // ── 2. Magic-Check ─────────────────────────────────────────────────────────
  // v3.90.0: Variant-Header Tolerance. Some user files start with non-'KORG'
  // magic (e.g. 'OoQC' — observed in real user-uploads). These are NOT
  // ESX-1 backups but variant Korg containers we cannot parse. Instead
  // of throwing (which crashes batch-import workflows), return an empty
  // bank with a warning so the caller can keep processing siblings.
  const sig = safeSlice(buf, 0, 4);
  if (!bytesEqual(sig, ESX1_SIGNATURE)) {
    const sigHex = Array.from(sig)
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ");
    const sigAscii = Array.from(sig)
      .map(b => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "?"))
      .join("");
    return {
      source,
      monoSamples: [],
      stereoSamples: [],
      patterns: [],
      songs: [],
      declaredMonoCount: 0,
      declaredStereoCount: 0,
      warnings: [
        `unsupported variant header: expected 'KORG', got '${sigAscii}' (${sigHex}); returning empty bank`,
      ],
    };
  }
  const submagic = safeSlice(buf, ESX1_SUBMAGIC_OFFSET, 4);
  if (!bytesEqual(submagic, ESX1_SUBMAGIC)) {
    const subHex = Array.from(submagic)
      .map(b => b.toString(16).padStart(2, "0"))
      .join(" ");
    return {
      source,
      monoSamples: [],
      stereoSamples: [],
      patterns: [],
      songs: [],
      declaredMonoCount: 0,
      declaredStereoCount: 0,
      warnings: [
        `unsupported sub-format at offset 0x${ESX1_SUBMAGIC_OFFSET.toString(16)}: expected 'ESX\\0', got '${subHex}'; returning empty bank`,
      ],
    };
  }

  // ── 3. Second magic at 0x001B0000 ─────────────────────────────────────────
  if (buf.length < ESX1_ADDR_VALID_CHECK_2 + 4) {
    throw new EsxParseError(
      `file size ${buf.length} < expected sample-directory offset 0x${ESX1_ADDR_VALID_CHECK_2.toString(16)}`
    );
  }
  const check2 = safeSlice(buf, ESX1_ADDR_VALID_CHECK_2, 4);
  if (!bytesEqual(check2, ESX1_SIGNATURE)) {
    throw new EsxParseError(
      `Invalid second magic at offset 0x${ESX1_ADDR_VALID_CHECK_2.toString(16)}: expected 'KORG'`
    );
  }

  // ── 4. Sample-Counters ────────────────────────────────────────────────────
  const countDv = new DataView(
    buf.buffer,
    buf.byteOffset + ESX1_ADDR_NUM_MONO_SAMPLES,
    12
  );
  const numMono = countDv.getUint32(0, false);
  const numStereo = countDv.getUint32(4, false);
  // const currentOffset = countDv.getUint32(8, false); // free-pointer, info-only

  if (numMono > ESX1_MAX_MONO_SLOTS || numStereo > ESX1_MAX_STEREO_SLOTS) {
    throw new EsxParseError(
      `declared sample counts out of range: mono=${numMono} (cap ${ESX1_MAX_MONO_SLOTS}), stereo=${numStereo} (cap ${ESX1_MAX_STEREO_SLOTS})`
    );
  }

  const warnings: string[] = [];
  const monoSamples: EsxSample[] = [];
  const stereoSamples: EsxSample[] = [];
  let totalPcm = 0;
  // v3.90.0: Only emit one PCM-cap-tolerance warning per parse to avoid
  // spamming the warnings array with one entry per slot above the cap.
  let pcmCapWarned = false;

  // ── 5. Mono-Header Parse ──────────────────────────────────────────────────
  const monoTableStart = ESX1_ADDR_SAMPLE_HEADER_MONO;
  for (let i = 0; i < ESX1_MAX_MONO_SLOTS; i++) {
    try {
      const headerOff = monoTableStart + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
      const body = safeSlice(buf, headerOff, ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO);
      const name = decodeEsxName(body.subarray(0, 8));
      const f = readMonoHeaderFields(body);
      if (
        f.off1Start === ESX1_EMPTY_OFFSET ||
        f.off1End === ESX1_EMPTY_OFFSET
      ) {
        continue; // empty slot
      }
      if (f.off1End <= f.off1Start) {
        warnings.push(
          `mono slot ${i}: offsetEnd (${f.off1End}) <= offsetStart (${f.off1Start}); skipped`
        );
        continue;
      }

      const pcmBytes = readPcmRange(buf, f.off1Start, f.off1End, i, "mono");
      const pcm = headersOnly ? EMPTY_F32 : be16PcmToFloat32(pcmBytes);
      totalPcm += pcmBytes.length;
      // v3.90.0: Defensive tolerance — KASSEL.esx and friends overflow the
      // 24 MiB hardware cap by a few hundred bytes (real-file-padding /
      // rounding). Only throw above the soft-limit (~25 MiB); between
      // cap and soft-limit, emit a single warning per parse + continue.
      if (totalPcm > ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES) {
        throw new EsxParseError(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 soft-limit ${ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES}`
        );
      }
      if (totalPcm > ESX1_MAX_SAMPLE_MEM_IN_BYTES && !pcmCapWarned) {
        warnings.push(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 hardware cap ${ESX1_MAX_SAMPLE_MEM_IN_BYTES} (within ${ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES} soft-limit, continuing)`
        );
        pcmCapWarned = true;
      }

      const frames = headersOnly ? pcmBytes.length >> 1 : pcm.length;
      monoSamples.push({
        index: i,
        name,
        channels: 1,
        sampleRate: f.sampleRate > 0 ? f.sampleRate : 44_100,
        frames,
        pcmData: pcm,
        loopStart: Math.max(0, Math.min(f.loopStart, frames)),
        loopEnd: Math.max(0, Math.min(f.end, frames)),
        level: Math.max(0, Math.min(127, f.playLevel || 100)),
      });
    } catch (err) {
      if (
        err instanceof EsxParseError &&
        err.message.includes("escapes file")
      ) {
        // Defensive: hostile slot, skip + warn (other slots may still be valid)
        warnings.push(`mono slot ${i}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  // ── 6. Stereo-Header Parse ────────────────────────────────────────────────
  const stereoTableStart = ESX1_ADDR_SAMPLE_HEADER_STEREO;
  for (let i = 0; i < ESX1_MAX_STEREO_SLOTS; i++) {
    try {
      const headerOff =
        stereoTableStart + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
      const body = safeSlice(
        buf,
        headerOff,
        ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO
      );
      const name = decodeEsxName(body.subarray(0, 8));
      const f = readStereoHeaderFields(body);
      if (
        f.off1Start === ESX1_EMPTY_OFFSET ||
        f.off1End === ESX1_EMPTY_OFFSET ||
        f.off2Start === ESX1_EMPTY_OFFSET ||
        f.off2End === ESX1_EMPTY_OFFSET
      ) {
        continue;
      }
      if (f.off1End <= f.off1Start || f.off2End <= f.off2Start) {
        warnings.push(
          `stereo slot ${i}: zero-or-inverted offset range; skipped`
        );
        continue;
      }
      if (f.off1End - f.off1Start !== f.off2End - f.off2Start) {
        warnings.push(`stereo slot ${i}: channel lengths differ; skipped`);
        continue;
      }

      const slotIndex = ESX1_MAX_MONO_SLOTS + i;
      const leftBytes = readPcmRange(
        buf,
        f.off1Start,
        f.off1End,
        slotIndex,
        "stereo-L"
      );
      const rightBytes = readPcmRange(
        buf,
        f.off2Start,
        f.off2End,
        slotIndex,
        "stereo-R"
      );
      let frames: number;
      let inter: Float32Array;
      if (headersOnly) {
        frames = Math.min(leftBytes.length >> 1, rightBytes.length >> 1);
        inter = EMPTY_F32;
      } else {
        const left = be16PcmToFloat32(leftBytes);
        const right = be16PcmToFloat32(rightBytes);
        frames = Math.min(left.length, right.length);
        inter = new Float32Array(frames * 2);
        for (let k = 0; k < frames; k++) {
          inter[k * 2] = left[k];
          inter[k * 2 + 1] = right[k];
        }
      }
      totalPcm += leftBytes.length + rightBytes.length;
      // v3.90.0: Same soft-limit/warning logic as mono path.
      if (totalPcm > ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES) {
        throw new EsxParseError(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 soft-limit ${ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES}`
        );
      }
      if (totalPcm > ESX1_MAX_SAMPLE_MEM_IN_BYTES && !pcmCapWarned) {
        warnings.push(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 hardware cap ${ESX1_MAX_SAMPLE_MEM_IN_BYTES} (within ${ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES} soft-limit, continuing)`
        );
        pcmCapWarned = true;
      }

      stereoSamples.push({
        index: slotIndex,
        name,
        channels: 2,
        sampleRate: f.sampleRate > 0 ? f.sampleRate : 44_100,
        frames,
        pcmData: inter,
        loopStart: 0,
        loopEnd: Math.max(0, Math.min(f.end, frames)),
        level: Math.max(0, Math.min(127, f.playLevel || 100)),
      });
    } catch (err) {
      if (
        err instanceof EsxParseError &&
        err.message.includes("escapes file")
      ) {
        warnings.push(`stereo slot ${i}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  // ── 7. Patterns parsen (v3.5) ──────────────────────────────────────────────
  // 256 Patterns × 4280B ab Offset 0x0200. Leere Patterns werden geskippt
  // (return null aus parseEsxPattern); der Buffer muss aber gross genug sein
  // damit der Pattern-Bereich (max 256×4280 = 1,095,680 B = 0x10B100 endend
  // bei 0x10B300) drinsteckt.
  const patterns: EsxPattern[] = [];
  const patternsEnd =
    ESX1_ADDR_PATTERN_DATA + ESX1_NUM_PATTERNS * ESX1_CHUNKSIZE_PATTERN;
  const haveAllPatterns = patternsEnd <= buf.length;
  if (!haveAllPatterns) {
    warnings.push(
      `pattern area truncated: file ${buf.length} < required end ${patternsEnd}`
    );
  }
  const usablePatternsEnd = Math.min(patternsEnd, buf.length);
  for (let i = 0; i < ESX1_NUM_PATTERNS; i++) {
    const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
    if (off + ESX1_CHUNKSIZE_PATTERN > usablePatternsEnd) break;
    try {
      const block = buf.subarray(off, off + ESX1_CHUNKSIZE_PATTERN);
      const pat = parseEsxPattern(block, i);
      if (pat !== null) patterns.push(pat);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`pattern ${i}: ${msg}`);
    }
  }

  // ── 8. Songs parsen (v3.89.0) ──────────────────────────────────────────────
  // 64 Songs × 528B ab 0x130000, plus Event-Region ab 0x138400.
  // Leere Init-Slots werden geskippt; truncated regions liefern warnings.
  const { songs, warnings: songWarnings } = parseEsxSongs(buf);
  warnings.push(...songWarnings);

  return {
    source,
    monoSamples,
    stereoSamples,
    patterns,
    songs,
    declaredMonoCount: numMono,
    declaredStereoCount: numStereo,
    warnings,
  };
}

/** Convenience: type-guard ohne Parse-Aufwand. Schnelle Magic-only-Prüfung. */
export function isEsxBuffer(input: ArrayBuffer | Uint8Array): boolean {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < ESX1_SUBMAGIC_OFFSET + 4) return false;
  if (!bytesEqual(buf.subarray(0, 4), ESX1_SIGNATURE)) return false;
  if (
    !bytesEqual(
      buf.subarray(ESX1_SUBMAGIC_OFFSET, ESX1_SUBMAGIC_OFFSET + 4),
      ESX1_SUBMAGIC
    )
  )
    return false;
  return true;
}

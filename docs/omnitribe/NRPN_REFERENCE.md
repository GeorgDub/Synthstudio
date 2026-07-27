# OmniTribe NRPN-Reference

_Auto-generiert am 2026-06-15 von `tools/build/generate_nrpn_reference.py`._

**DO NOT EDIT MANUALLY** — regeneriere aus nrpn_map.json.

Diese Datei ist die Single-Source-Reference für SynthStudio-
Developer. Jede NRPN-Adresse die OmniTribe versteht ist hier
dokumentiert.

## Statistik

- **Module mit NRPN-Handlern:** 17
- **Total NRPN-Einträge:** 126
- **Adress-Konflikte:** 0

## Quick-Reference-Tabelle

| MSB | LSB | Modul | Beschreibung |
|---|---|---|---|
| 0x07 | 0x00 | `wavetable` | Slot-Select (0..7) |
| 0x07 | 0x01 | `wavetable` | Frame-Position (0..63 × 1024, q10) |
| 0x07 | 0x02 | `wavetable` | Morph-Speed (LFO-Rate fuer Auto-Morph) |
| 0x07 | 0x03 | `wavetable` | Morph-Range (0..63 Frames) |
| 0x08 | 0x00 | `gen_catalog` | silence/clear-stub (catalog idx 0; device-binding TBD; selec |
| 0x08 | 0x01 | `gen_catalog` | wavetable-interp osc [lut] (catalog idx 1; device-binding TB |
| 0x08 | 0x02 | `gen_catalog` | wavetable-interp osc [lut] (catalog idx 2; device-binding TB |
| 0x08 | 0x03 | `gen_catalog` | polynomial/parabolic shaper (catalog idx 3; device-binding T |
| 0x08 | 0x04 | `gen_catalog` | generator, filter/resonator-shaped (catalog idx 4; device-bi |
| 0x08 | 0x05 | `gen_catalog` | saw/ramp + soft-clip generator (catalog idx 5; device-bindin |
| 0x08 | 0x06 | `gen_catalog` | generator, filter/resonator-shaped multimode (catalog idx 6; |
| 0x08 | 0x07 | `gen_catalog` | generator, filter/resonator-shaped multimode (catalog idx 7; |
| 0x08 | 0x08 | `gen_catalog` | generator, filter/resonator-shaped multimode (catalog idx 8; |
| 0x08 | 0x09 | `gen_catalog` | wavetable-interp osc [lut] LSETUP (catalog idx 9; device-bin |
| 0x08 | 0x0A | `gen_catalog` | wavetable-interp osc [lut] LSETUP (catalog idx 10; device-bi |
| 0x08 | 0x0B | `gen_catalog` | polynomial/parabolic shaper (catalog idx 11; device-binding  |
| 0x08 | 0x0C | `gen_catalog` | polynomial shaper LSETUP (catalog idx 12; device-binding TBD |
| 0x08 | 0x0D | `gen_catalog` | additive/harmonic-sum osc (catalog idx 13; device-binding TB |
| 0x08 | 0x0E | `gen_catalog` | additive/harmonic-sum osc (catalog idx 14; device-binding TB |
| 0x08 | 0x0F | `gen_catalog` | additive osc + DC-offset (catalog idx 15; device-binding TBD |
| 0x08 | 0x10 | `gen_catalog` | saw/wrap shaper (catalog idx 16; device-binding TBD; selecti |
| 0x08 | 0x11 | `gen_catalog` | wavetable-interp osc + parabola pre-shape (catalog idx 17; d |
| 0x08 | 0x12 | `gen_catalog` | wavetable-interp osc + parabola pre-shape (catalog idx 18; d |
| 0x08 | 0x13 | `gen_catalog` | saw-wrap + parabola shaper (catalog idx 19; device-binding T |
| 0x08 | 0x14 | `gen_catalog` | saw-wrap + polynomial shaper (catalog idx 20; device-binding |
| 0x08 | 0x15 | `gen_catalog` | wavetable-interp osc [lut] LSETUP (catalog idx 21; device-bi |
| 0x08 | 0x16 | `gen_catalog` | wavetable-interp osc [lut] LSETUP (catalog idx 22; device-bi |
| 0x08 | 0x17 | `gen_catalog` | polynomial shaper state-rewind (catalog idx 23; device-bindi |
| 0x08 | 0x18 | `gen_catalog` | polynomial/parabolic shaper LSETUP (catalog idx 24; device-b |
| 0x08 | 0x19 | `gen_catalog` | wavetable-interp osc 2-stage (catalog idx 25; device-binding |
| 0x08 | 0x1A | `gen_catalog` | wavetable-interp osc 2-stage (catalog idx 26; device-binding |
| 0x08 | 0x1B | `gen_catalog` | generator, filter/resonator-shaped bidirectional (catalog id |
| 0x08 | 0x1C | `gen_catalog` | generator, filter/resonator-shaped z-state (catalog idx 28;  |
| 0x08 | 0x1D | `gen_catalog` | wavetable-interp osc 2-stage (catalog idx 29; device-binding |
| 0x08 | 0x1E | `gen_catalog` | wavetable-interp osc 2-stage (catalog idx 30; device-binding |
| 0x08 | 0x1F | `gen_catalog` | generator, filter/resonator-shaped bidirectional (catalog id |
| 0x08 | 0x20 | `gen_catalog` | generator, filter/resonator-shaped z-state (catalog idx 32;  |
| 0x08 | 0x21 | `gen_catalog` | generator, biquad/SVF-shaped (catalog idx 33; device-binding |
| 0x08 | 0x22 | `gen_catalog` | PCM sample-player PINNED (catalog idx 34; device-binding TBD |
| 0x08 | 0x23 | `gen_catalog` | generator, filter/resonator-shaped fu-MAC (catalog idx 35; d |
| 0x08 | 0x24 | `gen_catalog` | slice/wrap-counter osc (catalog idx 36; device-binding TBD;  |
| 0x08 | 0x25 | `gen_catalog` | wavetable-interp osc [lut] largest (catalog idx 37; device-b |
| 0x08 | 0x26 | `gen_catalog` | bit-masked/quantizer osc (catalog idx 38; device-binding TBD |
| 0x08 | 0x27 | `gen_catalog` | generator, filter/resonator-shaped + parabola TOP (catalog i |
| 0x0A | 0x00 | `midi_learn` | Learn-Mode aktivieren (value = part << 8 | param_id_lsb, |
| 0x0A | 0x01 | `midi_learn` | Clear-All-Mappings |
| 0x12 | 0x00 | `mpe_voice` | Range (Halbtoene 0..24) |
| 0x12 | 0x01 | `mpe_voice` | Smooth-Time |
| 0x13 | 0x00 | `modmatrix` | Source pro Slot |
| 0x13 | 0x01 | `modmatrix` | Source pro Slot |
| 0x13 | 0x02 | `modmatrix` | Source pro Slot |
| 0x13 | 0x03 | `modmatrix` | Source pro Slot |
| 0x13 | 0x04 | `modmatrix` | Source pro Slot |
| 0x13 | 0x05 | `modmatrix` | Source pro Slot |
| 0x13 | 0x06 | `modmatrix` | Source pro Slot |
| 0x13 | 0x07 | `modmatrix` | Source pro Slot |
| 0x14 | 0x00 | `modmatrix` | Target pro Slot |
| 0x14 | 0x01 | `modmatrix` | Target pro Slot |
| 0x14 | 0x02 | `modmatrix` | Target pro Slot |
| 0x14 | 0x03 | `modmatrix` | Target pro Slot |
| 0x14 | 0x04 | `modmatrix` | Target pro Slot |
| 0x14 | 0x05 | `modmatrix` | Target pro Slot |
| 0x14 | 0x06 | `modmatrix` | Target pro Slot |
| 0x14 | 0x07 | `modmatrix` | Target pro Slot |
| 0x15 | 0x00 | `modmatrix` | Depth pro Slot (signed) |
| 0x15 | 0x01 | `modmatrix` | Depth pro Slot (signed) |
| 0x15 | 0x02 | `modmatrix` | Depth pro Slot (signed) |
| 0x15 | 0x03 | `modmatrix` | Depth pro Slot (signed) |
| 0x15 | 0x04 | `modmatrix` | Depth pro Slot (signed) |
| 0x15 | 0x05 | `modmatrix` | Depth pro Slot (signed) |
| 0x15 | 0x06 | `modmatrix` | Depth pro Slot (signed) |
| 0x15 | 0x07 | `modmatrix` | Depth pro Slot (signed) |
| 0x16 | 0x00 | `arpeggiator` | Mode |
| 0x16 | 0x01 | `arpeggiator` | Rate (1/4, 1/8, 1/16, ...) |
| 0x16 | 0x02 | `arpeggiator` | Range (Oktaven, 1..4) |
| 0x16 | 0x03 | `arpeggiator` | Gate (%) |
| 0x16 | 0x04 | `arpeggiator` | Latch (0/1) |
| 0x16 | 0x10 | `arpeggiator` | Velocity-Pattern Steps 0..7 |
| 0x16 | 0x11 | `arpeggiator` | Velocity-Pattern Steps 0..7 |
| 0x16 | 0x12 | `arpeggiator` | Velocity-Pattern Steps 0..7 |
| 0x16 | 0x13 | `arpeggiator` | Velocity-Pattern Steps 0..7 |
| 0x16 | 0x14 | `arpeggiator` | Velocity-Pattern Steps 0..7 |
| 0x16 | 0x15 | `arpeggiator` | Velocity-Pattern Steps 0..7 |
| 0x16 | 0x16 | `arpeggiator` | Velocity-Pattern Steps 0..7 |
| 0x16 | 0x17 | `arpeggiator` | Velocity-Pattern Steps 0..7 |
| 0x19 | 0x00 | `granular` | Grain Size (ms × 10, 5..500) |
| 0x19 | 0x01 | `granular` | Density (Grains/s, 0..50) |
| 0x19 | 0x02 | `granular` | Pitch-Scatter (±semitones × 10, 0..240) |
| 0x19 | 0x03 | `granular` | Position (0..1023) |
| 0x19 | 0x04 | `granular` | Spray (0..1023, Positions-Streuung) |
| 0x19 | 0x05 | `granular` | Feedback (0..127) |
| 0x1A | 0x00 | `voice_steal` | Mode (0..2) |
| 0x1A | 0x01 | `voice_steal` | Max-Voices pro Part (1..8) |
| 0x1A | 0x02 | `voice_steal` | Sustain-Hold (0/1, Voice nicht stealbar wenn Note gehalten) |
| 0x1A | 0x03 | `polyphony` | Pool-Priority (0=Perc, 1=Melodic, 2=Pad) |
| 0x1A | 0x04 | `polyphony` | Min-Voices-Reserve (1..8) |
| 0x1A | 0x10 | `cpu_budget` | Target-CPU-Last in % (50..95) |
| 0x1A | 0x11 | `cpu_budget` | CPU-Stream aktivieren (0/1) |
| 0x1C | <block-doc> | `randomizer` | *   0x00 = Notes      (Random innerhalb Skala) |
| 0x1D | 0x00 | `sidechain` | Threshold (-40..0 dB, normalisiert 0..127) |
| 0x1D | 0x01 | `sidechain` | Attack    (0..127, mapped auf 0.1..100 ms exponentiell) |
| 0x1D | 0x02 | `sidechain` | Release   (0..127, mapped auf 10..2000 ms exponentiell) |
| 0x1D | 0x03 | `sidechain` | Depth     (0..127, % Volumenreduktion) |
| 0x1D | 0x04 | `sidechain` | Source-Channel (0=Audio-In-L, 1=Audio-In-R, 2=Stereo-Sum) |
| 0x1D | 0x05 | `sidechain` | Enable (0/1) |
| 0x1E | 0x00 | `chord` | Chord-Type (0..14 = 11 std + 4 user) |
| 0x1E | 0x01 | `chord` | Stagger (0..200 ms) |
| 0x1E | 0x02 | `chord` | Root-Override (0..127, 0xFF=use played note) |
| 0x1E | 0x03 | `chord` | Enabled (0/1) |
| 0x1E | 0xC0 | `spec_morph` | Sample-Slot A (0..127) |
| 0x1E | 0xC1 | `spec_morph` | Sample-Slot B (0..127) |
| 0x1E | 0xC2 | `spec_morph` | Morph-Position (0..1023, modulierbar via Mod-Matrix) |
| 0x1E | 0xC3 | `spec_morph` | FFT-Size (0=256, 1=512, 2=1024) |
| 0x1E | 0xC4 | `spec_morph` | Enabled (0/1) |
| 0x1F | 0x40 | `performance` | mode (0=normal,1=loop-only,2=oneshot-only) |
| 0x1F | 0x41 | `performance` | crossfade-time (0..127 = 0..2000 ms) |
| 0x1F | 0x42 | `performance` | enable (0/1) |
| 0x20 | 0x00 | `sd_stream` | Stream-Slot-Index (0..3, 0xFF = disable) |
| 0x20 | 0x01 | `sd_stream` | Pre-Roll-MS (50..500) |
| 0x20 | 0x02 | `sd_stream` | Sample-File-Slot (Referenz auf SD-File-Tabelle) |
| 0x21 | 0x00 | `audio_input` | Routing-Mode (0=bypass, 1=IFX-A, 2=IFX-B, 3=Direct-MFX) |
| 0x21 | 0x01 | `audio_input` | IFX-A-Slot-Reference (Part-Index 0..15) |
| 0x21 | 0x02 | `audio_input` | IFX-B-Slot-Reference |
| 0x21 | 0x03 | `audio_input` | Input-Gain (-12..+24 dB, mapped 0..127) |
| 0x21 | 0x04 | `audio_input` | Monitoring-Mode (0=processed, 1=direct-bypass <1ms) |
| 0x21 | 0x05 | `audio_input` | Enabled (0/1) |

## Per-Module-Details

### arpeggiator (arpeggiator.c)

**MSB(s):** `0x16`

- `MSB 0x16` / `LSB 0x00` → Mode
- `MSB 0x16` / `LSB 0x01` → Rate (1/4, 1/8, 1/16, ...)
- `MSB 0x16` / `LSB 0x02` → Range (Oktaven, 1..4)
- `MSB 0x16` / `LSB 0x03` → Gate (%)
- `MSB 0x16` / `LSB 0x04` → Latch (0/1)
- `MSB 0x16` / `LSB 0x10..0x17` → Velocity-Pattern Steps 0..7

### audio_input (audio_input_routing.c)

**MSB(s):** `0x21`

- `MSB 0x21` / `LSB 0x00` → Routing-Mode (0=bypass, 1=IFX-A, 2=IFX-B, 3=Direct-MFX)
- `MSB 0x21` / `LSB 0x01` → IFX-A-Slot-Reference (Part-Index 0..15)
- `MSB 0x21` / `LSB 0x02` → IFX-B-Slot-Reference
- `MSB 0x21` / `LSB 0x03` → Input-Gain (-12..+24 dB, mapped 0..127)
- `MSB 0x21` / `LSB 0x04` → Monitoring-Mode (0=processed, 1=direct-bypass <1ms)
- `MSB 0x21` / `LSB 0x05` → Enabled (0/1)

### chord (chord.c)

**MSB(s):** `0x1E`

- `MSB 0x1E` / `LSB pid=0` → Chord-Type (0..14 = 11 std + 4 user)
- `MSB 0x1E` / `LSB pid=1` → Stagger (0..200 ms)
- `MSB 0x1E` / `LSB pid=2` → Root-Override (0..127, 0xFF=use played note)
- `MSB 0x1E` / `LSB pid=3` → Enabled (0/1)

### cpu_budget (cpu_budget_module.c)

**MSB(s):** `0x1A`

- `MSB 0x1A` / `LSB 0x10` → Target-CPU-Last in % (50..95)
- `MSB 0x1A` / `LSB 0x11` → CPU-Stream aktivieren (0/1)

### gen_catalog (generator_catalog.c)

**MSB(s):** `0x08`

- `MSB 0x08` / `LSB 0x00` → silence/clear-stub (catalog idx 0; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x01` → wavetable-interp osc [lut] (catalog idx 1; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x02` → wavetable-interp osc [lut] (catalog idx 2; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x03` → polynomial/parabolic shaper (catalog idx 3; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x04` → generator, filter/resonator-shaped (catalog idx 4; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x05` → saw/ramp + soft-clip generator (catalog idx 5; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x06` → generator, filter/resonator-shaped multimode (catalog idx 6; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x07` → generator, filter/resonator-shaped multimode (catalog idx 7; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x08` → generator, filter/resonator-shaped multimode (catalog idx 8; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x09` → wavetable-interp osc [lut] LSETUP (catalog idx 9; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x0A` → wavetable-interp osc [lut] LSETUP (catalog idx 10; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x0B` → polynomial/parabolic shaper (catalog idx 11; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x0C` → polynomial shaper LSETUP (catalog idx 12; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x0D` → additive/harmonic-sum osc (catalog idx 13; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x0E` → additive/harmonic-sum osc (catalog idx 14; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x0F` → additive osc + DC-offset (catalog idx 15; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x10` → saw/wrap shaper (catalog idx 16; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x11` → wavetable-interp osc + parabola pre-shape (catalog idx 17; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x12` → wavetable-interp osc + parabola pre-shape (catalog idx 18; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x13` → saw-wrap + parabola shaper (catalog idx 19; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x14` → saw-wrap + polynomial shaper (catalog idx 20; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x15` → wavetable-interp osc [lut] LSETUP (catalog idx 21; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x16` → wavetable-interp osc [lut] LSETUP (catalog idx 22; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x17` → polynomial shaper state-rewind (catalog idx 23; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x18` → polynomial/parabolic shaper LSETUP (catalog idx 24; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x19` → wavetable-interp osc 2-stage (catalog idx 25; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x1A` → wavetable-interp osc 2-stage (catalog idx 26; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x1B` → generator, filter/resonator-shaped bidirectional (catalog idx 27; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x1C` → generator, filter/resonator-shaped z-state (catalog idx 28; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x1D` → wavetable-interp osc 2-stage (catalog idx 29; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x1E` → wavetable-interp osc 2-stage (catalog idx 30; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x1F` → generator, filter/resonator-shaped bidirectional (catalog idx 31; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x20` → generator, filter/resonator-shaped z-state (catalog idx 32; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x21` → generator, biquad/SVF-shaped (catalog idx 33; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x22` → PCM sample-player PINNED (catalog idx 34; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x23` → generator, filter/resonator-shaped fu-MAC (catalog idx 35; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x24` → slice/wrap-counter osc (catalog idx 36; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x25` → wavetable-interp osc [lut] largest (catalog idx 37; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x26` → bit-masked/quantizer osc (catalog idx 38; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)
- `MSB 0x08` / `LSB 0x27` → generator, filter/resonator-shaped + parabola TOP (catalog idx 39; device-binding TBD; selection lever behind cross-core dispatch-bank wall, reverse Phase-3g)

### granular (granular.c)

**MSB(s):** `0x19`

- `MSB 0x19` / `LSB 0x00` → Grain Size (ms × 10, 5..500)
- `MSB 0x19` / `LSB 0x01` → Density (Grains/s, 0..50)
- `MSB 0x19` / `LSB 0x02` → Pitch-Scatter (±semitones × 10, 0..240)
- `MSB 0x19` / `LSB 0x03` → Position (0..1023)
- `MSB 0x19` / `LSB 0x04` → Spray (0..1023, Positions-Streuung)
- `MSB 0x19` / `LSB 0x05` → Feedback (0..127)

### midi_learn (midi_learn.c)

**MSB(s):** `0x0A`

- `MSB 0x0A` / `LSB 0x00` → Learn-Mode aktivieren (value = part << 8 | param_id_lsb,
- `MSB 0x0A` / `LSB 0x01` → Clear-All-Mappings

### modmatrix (modmatrix.c)

**MSB(s):** `0x13`, `0x14`, `0x15`

- `MSB 0x13` / `LSB 0..7` → Source pro Slot
- `MSB 0x14` / `LSB 0..7` → Target pro Slot
- `MSB 0x15` / `LSB 0..7` → Depth pro Slot (signed)

### mpe_voice (mpe_voice.c)

**MSB(s):** `0x12`

- `MSB 0x12` / `LSB pid=0` → Range (Halbtoene 0..24)
- `MSB 0x12` / `LSB pid=1` → Smooth-Time

### performance (performance.c)

**MSB(s):** `0x1F`

- `MSB 0x1F` / `LSB lsb=0x40` → mode (0=normal,1=loop-only,2=oneshot-only)
- `MSB 0x1F` / `LSB lsb=0x41` → crossfade-time (0..127 = 0..2000 ms)
- `MSB 0x1F` / `LSB lsb=0x42` → enable (0/1)

### polyphony (polyphony_pool.c)

**MSB(s):** `0x1A`

- `MSB 0x1A` / `LSB pid=3` → Pool-Priority (0=Perc, 1=Melodic, 2=Pad)
- `MSB 0x1A` / `LSB pid=4` → Min-Voices-Reserve (1..8)

### randomizer (randomizer.c)

**MSB(s):** `0x1C`

- `MSB 0x1C` / `LSB <block-doc>` → *   0x00 = Notes      (Random innerhalb Skala)

### sd_stream (sd_stream.c)

**MSB(s):** `0x20`

- `MSB 0x20` / `LSB pid=0` → Stream-Slot-Index (0..3, 0xFF = disable)
- `MSB 0x20` / `LSB pid=1` → Pre-Roll-MS (50..500)
- `MSB 0x20` / `LSB pid=2` → Sample-File-Slot (Referenz auf SD-File-Tabelle)

### sidechain (sidechain.c)

**MSB(s):** `0x1D`

- `MSB 0x1D` / `LSB pid=0` → Threshold (-40..0 dB, normalisiert 0..127)
- `MSB 0x1D` / `LSB pid=1` → Attack    (0..127, mapped auf 0.1..100 ms exponentiell)
- `MSB 0x1D` / `LSB pid=2` → Release   (0..127, mapped auf 10..2000 ms exponentiell)
- `MSB 0x1D` / `LSB pid=3` → Depth     (0..127, % Volumenreduktion)
- `MSB 0x1D` / `LSB pid=4` → Source-Channel (0=Audio-In-L, 1=Audio-In-R, 2=Stereo-Sum)
- `MSB 0x1D` / `LSB pid=5` → Enable (0/1)

### spec_morph (spectral_morph.c)

**MSB(s):** `0x1E`

- `MSB 0x1E` / `LSB 0xC0` → Sample-Slot A (0..127)
- `MSB 0x1E` / `LSB 0xC1` → Sample-Slot B (0..127)
- `MSB 0x1E` / `LSB 0xC2` → Morph-Position (0..1023, modulierbar via Mod-Matrix)
- `MSB 0x1E` / `LSB 0xC3` → FFT-Size (0=256, 1=512, 2=1024)
- `MSB 0x1E` / `LSB 0xC4` → Enabled (0/1)

### voice_steal (voice_steal.c)

**MSB(s):** `0x1A`

- `MSB 0x1A` / `LSB pid=0` → Mode (0..2)
- `MSB 0x1A` / `LSB pid=1` → Max-Voices pro Part (1..8)
- `MSB 0x1A` / `LSB pid=2` → Sustain-Hold (0/1, Voice nicht stealbar wenn Note gehalten)

### wavetable (wavetable.c)

**MSB(s):** `0x07`

- `MSB 0x07` / `LSB 0x00` → Slot-Select (0..7)
- `MSB 0x07` / `LSB 0x01` → Frame-Position (0..63 × 1024, q10)
- `MSB 0x07` / `LSB 0x02` → Morph-Speed (LFO-Rate fuer Auto-Morph)
- `MSB 0x07` / `LSB 0x03` → Morph-Range (0..63 Frames)

## Verwendung in SynthStudio

```typescript
// Auto-generierte Bindings (Sprint-53)
import { lookupNrpn, NRPN_MAP } from './nrpn-map';

// Lookup: was macht 0x16/0x00?
const info = lookupNrpn(0x16, 0x00);
// → { module: 'arpeggiator', description: 'Mode', ... }
```

---

_Generiert von Sprint-92 (`generate_nrpn_reference.py`)._
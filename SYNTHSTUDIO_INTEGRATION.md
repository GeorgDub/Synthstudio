# SynthStudio ↔ OmniTribe — Integration-Hand-Off

> **Zielgruppe:** SynthStudio-Agent / Frontend-Team, das im SynthStudio-Repo
> (`G:/IdeaProjects/Synthstudio`) parallel zur OmniTribe-Firmware die
> Bridge + UI-Anbindung implementiert.
>
> **Stand:** nach Sprint 5 (MIDI/OTP/MPE) + Sprint 6 Module komplett.
> Firmware-Side ist drop-in-ready — die SynthStudio-Side ist die fehlende
> Halfte fuer Live-Geraete-Steuerung.
>
> **Lesezeit:** ~20 Minuten. Implementierung: ~5 Arbeitstage (1 Frontend-Person).

---

## 1. Was zu tun ist (Punkt-für-Punkt)

1. **Datei droppen**: `host/synthstudio/OmniTribeBridge.ts` aus diesem Repo
   nach `client/src/audio/OmniTribeBridge.ts` in SynthStudio kopieren.
2. **Verbindungs-UI bauen**: kleines Panel im SynthStudio Settings-Tab, das
   Web-MIDI permissionet, OmniTribe enumeriert, connectet.
3. **`useOmniTribe()` Hook**: React-Hook der Verbindungs-State + Methoden
   exposed.
4. **Existierende SynthStudio-Panels mit Bridge verbinden** (Mapping-Tabelle
   in §5).
5. **CustomEvents-Listener**: `omnitribe:paramChange`, `omnitribe:vuMeter`,
   `omnitribe:spectrum` als Hooks abgreifen.
6. **Tests**: gegen Mock-MIDIAccess in `tests/features/omnitribeBridge.test.ts`.
7. **CollabSession-Integration**: OmniTribe-Param-Changes als CollabRelay-
   Messages broadcasten (optional, Sprint-5-Stretch).

---

## 2. Was bereits fertig auf der Firmware-Seite ist

### Module geladen ueber OTP-Sysex CMD 0x05 SUB 0x01

9 ARM-Module, kompilierter Code in `build/modules/*.bin`, Sysex-Bundle in
`build/omnitribe_modules.syx`:

| Modul | ID | Funktion | NRPN MSB |
|---|---|---|---|
| modmatrix | 0 | 8 Mod-Slots × 16 Parts (LFO/Env/Velocity → Filter/Amp/...) | 0x13/0x14/0x15 |
| arpeggiator | 1 | 6 Modi (Up/Down/UpDown/Random/Chord/Order) | 0x16 |
| granular | 2 | Granular-Steuerung (BF523-Audio-Side) | 0x19 |
| wavetable | 3 | Slot-Select + Auto-Morph-LFO | 0x07 |
| midi_clock | 7 | PLL-Jitter-Filter | — |
| mpe_voice | 8 | MPE-Channel-Routing | 0x12 |
| chord | 9 | 11 Std-Akkorde + 4 User-Slots, Strum-Stagger | 0x1E |
| performance | 10 | 16 Pads = 16 Patterns, Loop-Isolate, Jam-Mute | 0x1F |
| voice_steal | 11 | Smart-Voice-Stealing (Oldest/Quietest/Smart) | 0x1A |

### OTP-Sysex-Protokoll voll spezifiziert

Spec: [`docs/midi/otp_protocol.md`](docs/midi/otp_protocol.md)
Python-Mirror: [`tools/midi/otp_codec.py`](tools/midi/otp_codec.py)
TypeScript-Bridge: [`host/synthstudio/OmniTribeBridge.ts`](host/synthstudio/OmniTribeBridge.ts)

### NRPN-Adressraum vollstaendig dokumentiert

Spec: [`docs/midi/nrpn_spec.md`](docs/midi/nrpn_spec.md)
LSB-Layout: `[part:4][pid:4]` fuer Multi-Part, oder `[type:4][pid:4]` fuer
Modul-spezifische Sub-Adressen.

---

## 3. Bridge-API-Referenz

`OmniTribeBridge` exportiert folgende Methoden (siehe TypeScript-Datei):

### Verbindung
```typescript
async connect(midiAccess: MIDIAccess): Promise<boolean>
get isConnected(): boolean
on(cmd: number, handler: FrameHandler): () => void
```

### Parameter-Steuerung (mit Echo-Schutz)
```typescript
setParam(part: number, paramHigh: number, paramLow: number, value: number): void
getParam(part: number, paramHigh: number, paramLow: number): void
requestFullDump(): void
```

### Wavetable / Sample-Upload
```typescript
uploadWavetable(slot: number, frames: Float32Array[]): void
```

### Real-Time Streams
```typescript
enableStreams(flags: number): void   // StreamFlag.VU_METER | .SPECTRUM | ...
disableStreams(): void
```

### Remote-Transport
```typescript
remotePlay() / remoteStop() / remoteRecord() / remoteTempo(bpm: number)
undo() / redo()
```

### Identity / Firmware-Info
```typescript
async requestIdentity(): Promise<void>
// Response kommt via on(OtpCmd.IDENTITY, handler)
```

---

## 4. CustomEvents auf `window`

Die Bridge dispatched automatisch CustomEvents auf das globale `window`:

```typescript
window.addEventListener("omnitribe:paramChange", (e: CustomEvent<ParamChangeEvent>) => {
  const { part, paramHigh, paramLow, value } = e.detail;
  // updateSynthStudioStateFromDevice(part, paramHigh, paramLow, value);
});

window.addEventListener("omnitribe:vuMeter", (e: CustomEvent<VuMeterEvent>) => {
  const { levels } = e.detail;          // 16 × 0..127
  // updateVuMeterUI(levels);
});

window.addEventListener("omnitribe:spectrum", (e: CustomEvent<SpectrumEvent>) => {
  const { bins } = e.detail;            // 64 × 0..127
  // updateSpectrumAnalyzer(bins);
});
```

`paramChange` wird nur gefired wenn der Encoder am Geraet bewegt wurde — nicht
wenn SynthStudio selber `setParam()` aufgerufen hat (Echo-Vermeidung via
50ms-Window in der Bridge).

---

## 5. Mapping-Tabelle: SynthStudio-Panel → OmniTribe-NRPN

| SynthStudio-Panel | OmniTribe-Param | Bridge-Call |
|---|---|---|
| **GranularSynthPanel.tsx** | Grain-Size | `setParam(part, 0x19, 0x00 \| (part << 4), grainSize)` |
|  | Density | `setParam(part, 0x19, 0x01 \| (part << 4), density)` |
|  | Pitch-Scatter | `setParam(part, 0x19, 0x02 \| (part << 4), scatter)` |
|  | Position | `setParam(part, 0x19, 0x03 \| (part << 4), pos)` |
|  | Spray | `setParam(part, 0x19, 0x04 \| (part << 4), spray)` |
|  | Feedback | `setParam(part, 0x19, 0x05 \| (part << 4), fb)` |
| **WavetableEditor.tsx** | Frame-Position | `setParam(part, 0x07, 0x01 \| (part << 4), pos)` |
|  | Morph-Speed | `setParam(part, 0x07, 0x02 \| (part << 4), speed)` |
|  | Frames upload | `uploadWavetable(slot, frames)` |
| **EuclideanControls.tsx** | N-Steps | `setParam(part, 0x11, 0x00 \| (part << 4), N)` |
|  | K-Hits | `setParam(part, 0x11, 0x01 \| (part << 4), K)` |
|  | Rotation | `setParam(part, 0x11, 0x02 \| (part << 4), R)` |
|  | Enable | `setParam(part, 0x11, 0x03 \| (part << 4), on)` |
| **ModMatrix.tsx** | Slot Source | `setParam(part, 0x13, (part << 4) \| slot, srcId)` |
|  | Slot Target | `setParam(part, 0x14, (part << 4) \| slot, tgtId)` |
|  | Slot Depth | `setParam(part, 0x15, (part << 4) \| slot, depth)` |
| **ArpController** (neu in SS?) | Mode | `setParam(ch, 0x16, 0x00 \| (ch << 4), mode)` |
|  | Rate | `setParam(ch, 0x16, 0x01 \| (ch << 4), rate)` |
|  | Range | `setParam(ch, 0x16, 0x02 \| (ch << 4), oct)` |
|  | Gate | `setParam(ch, 0x16, 0x03 \| (ch << 4), gate)` |
|  | Latch | `setParam(ch, 0x16, 0x04 \| (ch << 4), latch)` |
| **ChordPanel** (NEU) | Chord-Type | `setParam(part, 0x1E, 0x00 \| (part << 4), type)` |
|  | Stagger | `setParam(part, 0x1E, 0x01 \| (part << 4), ms)` |
|  | Enable | `setParam(part, 0x1E, 0x03 \| (part << 4), on)` |
| **PerformancePad-Grid** (NEU) | Pad-Press | `setParam(0, 0x1F, 0x00 \| (padId), 1)` |
|  | Loop-Isolate | `setParam(0, 0x1F, 0x20 \| (padId), 1)` |
|  | Jam-Mute Part | `setParam(0, 0x1F, 0x30 \| (partId), toggle)` |
| **MPESettings** (NEU) | Range pro Part | `setParam(part, 0x12, 0x00 \| (part << 4), range)` |
|  | Enable MPE | `setParam(0, 0x12, 0x0F, on)` |
| **VoiceStealSettings** (NEU) | Mode | `setParam(part, 0x1A, 0x00 \| (part << 4), mode)` |
|  | Max-Voices | `setParam(part, 0x1A, 0x01 \| (part << 4), max)` |

---

## 6. Beispiel-Hook (Skelett)

```typescript
// client/src/hooks/useOmniTribe.ts
import { useEffect, useState, useCallback } from "react";
import { omniTribeBridge, OtpCmd, StreamFlag } from "../audio/OmniTribeBridge";

export interface UseOmniTribeReturn {
  connected: boolean;
  connect: () => Promise<boolean>;
  setParam: (part: number, ph: number, pl: number, value: number) => void;
  enableMonitoring: () => void;
  identity: { major: number; minor: number; patch: number } | null;
}

export function useOmniTribe(): UseOmniTribeReturn {
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<UseOmniTribeReturn["identity"]>(null);

  // Auto-listen fuer Identity-Response
  useEffect(() => {
    const unbind = omniTribeBridge.on(OtpCmd.IDENTITY, (cmd, sub, payload) => {
      if (sub === 0x01 && payload.length >= 3) {
        setIdentity({ major: payload[0], minor: payload[1], patch: payload[2] });
      }
    });
    return unbind;
  }, []);

  const connect = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      console.warn("Web-MIDI nicht verfuegbar (Firefox/Safari?)");
      return false;
    }
    const access = await navigator.requestMIDIAccess({ sysex: true });
    const ok = await omniTribeBridge.connect(access);
    setConnected(ok);
    return ok;
  }, []);

  const enableMonitoring = useCallback(() => {
    omniTribeBridge.enableStreams(
      StreamFlag.VU_METER | StreamFlag.SPECTRUM | StreamFlag.PARAM_NOTIFY
    );
    omniTribeBridge.requestFullDump();
  }, []);

  return {
    connected,
    connect,
    setParam: omniTribeBridge.setParam.bind(omniTribeBridge),
    enableMonitoring,
    identity,
  };
}
```

---

## 7. Beispiel-Panel (DeviceConnection)

```typescript
// client/src/components/Settings/DeviceConnectionPanel.tsx
import { useOmniTribe } from "../../hooks/useOmniTribe";

export function DeviceConnectionPanel() {
  const { connected, connect, identity, enableMonitoring } = useOmniTribe();
  return (
    <div className="bg-bg-panel border border-border-color p-4 rounded">
      <h3 className="text-text-primary mb-2">OmniTribe Device</h3>
      {connected ? (
        <div>
          <p className="text-accent-success">
            ✓ Connected — Firmware v{identity?.major}.{identity?.minor}.{identity?.patch}
          </p>
          <button
            onClick={enableMonitoring}
            className="bg-accent-primary px-3 py-1 rounded mt-2"
          >
            Enable Live Monitoring
          </button>
        </div>
      ) : (
        <button
          onClick={connect}
          className="bg-accent-primary px-3 py-1 rounded"
        >
          Connect to OmniTribe
        </button>
      )}
    </div>
  );
}
```

---

## 8. Echo-Vermeidung — kritischer Detail

Wenn ein Encoder am Geraet bewegt wird, sendet OmniTribe einen **Param-Notify-
Frame** (CMD 0x02 SUB 0x03). Wenn SynthStudio gleichzeitig `setParam()`
aufruft, kann eine Endlosschleife entstehen:

```
SynthStudio.setParam(0, 0x19, 0, 2000)
   ↓ Sysex an OmniTribe
   ↓
OmniTribe-Geraet empfaengt → setzt Param → schickt Notify zurueck
   ↓ Sysex an SynthStudio
   ↓
SynthStudio.handleNotify(0, 0x19, 0, 2000)
   → setzt State, der ggf. erneut `setParam()` triggert → LOOP
```

**Loesung in der Bridge:** `pendingSets`-Set mit 50ms-TTL. Jedes ausgehende
`setParam()` markiert den Key, das eingehende Notify mit dem gleichen Key
wird verworfen.

**Was du im Code beachten musst:**
- Niemals `setParam()` direkt in einem `omnitribe:paramChange`-Listener
  aufrufen (waere infinite loop wenn 50ms abgelaufen sind)
- Bei langsamen Sweeps (Slider-Drag): Throttle auf <100 sends/sec, sonst
  ueberflutet die Bridge-Queue

---

## 9. Test-Setup (Mock-MIDIAccess)

```typescript
// tests/features/omnitribeBridge.test.ts
import { describe, it, expect, vi } from "vitest";
import { OmniTribeBridge, OtpCmd } from "../../client/src/audio/OmniTribeBridge";

class FakeMidiOutput {
  name = "OmniTribe v0.1";
  sent: number[][] = [];
  send(bytes: number[]) { this.sent.push(bytes); }
}

class FakeMidiInput {
  name = "OmniTribe v0.1";
  onmidimessage: ((e: any) => void) | null = null;
}

describe("OmniTribeBridge", () => {
  it("connects when OmniTribe device present", async () => {
    const out = new FakeMidiOutput();
    const inp = new FakeMidiInput();
    const access = {
      outputs: new Map([["1", out]]),
      inputs: new Map([["1", inp]]),
    } as any as MIDIAccess;
    const bridge = new OmniTribeBridge();
    await bridge.connect(access);
    expect(bridge.isConnected).toBe(true);
  });

  it("setParam sends 12-byte sysex frame", async () => {
    // ... see test_otp_codec.py fuer Frame-Format
  });
});
```

---

## 10. Collab-Session-Integration (optional, Sprint-5-Stretch)

Falls ihr OmniTribe-State ueber SynthStudio-Collab teilen wollt (User A hat
Geraet, User B nicht — beide sehen synchrones State):

```typescript
// Broadcast lokale Param-Changes
window.addEventListener("omnitribe:paramChange", (e: CustomEvent) => {
  if (collabSession.isHost) {
    collabSession.broadcast({
      type: "omnitribe-param",
      payload: e.detail,
    });
  }
});

// Empfange remote Param-Changes
collabSession.on("omnitribe-param", ({ part, paramHigh, paramLow, value }) => {
  // Bei User A: an Geraet schicken (mit Echo-Schutz)
  if (omniTribeBridge.isConnected) {
    omniTribeBridge.setParam(part, paramHigh, paramLow, value);
  }
  // Bei User B: lokalen State updaten
  updateSynthStudioStateFromCollab(part, paramHigh, paramLow, value);
});
```

---

## 11. Stock-Sample-Bank-Reader (E2S `.all` + Patterns)

Falls SynthStudio das schon hat (v3.3 INDEX.js sagt ja): nutzen. Sonst diese
Python-Reader Port nach TypeScript:

| Format | Python-Reader | Spec |
|---|---|---|
| `e2sSample.all` | `tools/formats/e2s_bank_reader.py` | RIFF + ESLI Subchunk |
| `*.e2spat` | `tools/formats/e2spat_reader.py` | KORG-Wrapper + PTST-Inner |
| `*.e2sallpat` | `tools/formats/e2sallpat_reader.py` | 250 Pattern-Bloecke @ 0x10100+ |
| `*.e2opat` | `tools/formats/e2opat_extension.py` | e2spat + OMNITX01-TLV-Extension |
| `*.e2song` | `tools/formats/e2song_reader.py` | OMNTSONG-Magic + 64 Sections |

---

## 12. UI-Empfehlungen (aus Konzept §13.7)

Neue Komponenten im SynthStudio die OmniTribe-spezifisch sind:

### Pattern-Editor
- Tracker-Style-Ansicht oder Piano-Roll mit Param-Lock-Visualisierung
- Echtzeit-Highlight des aktiven Steps (Sequencer-Step-Stream)

### Sound-Design-Panel
- ModMatrix-Visual: Pfeil-Routing-Grafik
- Wavetable-Editor: Frame-Visualisierung + Morph-Vorschau
- Granular-Scatter-Plot

### Sample-Manager
- Drag-und-Drop (WAV/AIFF/FLAC, auto-Konvertierung)
- Pitch-Detection on-the-fly
- BPM-Detect + Zeit-Stretch auf Projekt-Tempo
- Waveform mit Slice-Markern

### Live-Performance-View
- 16-Part-VU-Meter-Matrix (via VU-Stream @ 60 Hz)
- Pattern-Pad-Grid mit Farb-Kategorisierung
- Song-Mode-Timeline

---

## 13. Sprint-Plan (vorgeschlagen, fuer SynthStudio-Team)

| Tag | Task | Akzeptanzkriterium |
|---|---|---|
| 1 | Bridge-Datei droppen + `useOmniTribe()` Hook | `connect()` returns true mit Mock |
| 2 | DeviceConnectionPanel + Web-MIDI-Permission-UI | Identity-Response in UI sichtbar |
| 3 | ModMatrix + Granular + Euclidean Bridge-Verkabelung | Encoder-Drehung am Geraet ändert UI |
| 4 | VU-Meter + Spectrum-Visualisierung via Streams | 60 Hz / 30 Hz stabil ueber 10 min |
| 5 | Chord-Panel + Performance-Pad-Grid (NEUE Komponenten) | Pad-Press triggert Pattern auf Geraet |
| 6 | Tests + Echo-Schutz-Regression-Test | Slider-Sweep → keine UI-Oszillation |
| 7 | CollabSession-Integration (optional) | 2 Browser-Tabs spiegeln Param-Changes |

---

## 14. Bekannte Limitierungen

- **Web-MIDI nicht in Firefox/Safari** — UI-Hinweis fuer Chrome/Edge/Opera
- **AudioContext braucht User-Gesture** vor erster Sysex-Sequenz
- **Sysex-Permission** muss explizit angefordert werden:
  `navigator.requestMIDIAccess({ sysex: true })`
- **Throttle 100 frames/sec** — bei Slider-Drag aggregieren
- **Echo-Schutz-Window 50ms** — nicht aendern ohne Firmware-Update

---

## 15. Konktakt-Punkt zur Firmware-Seite

| Frage | Wer |
|---|---|
| "Welche NRPN gibt es?" | `docs/midi/nrpn_spec.md` |
| "Wie ist das OTP-Frame-Format?" | `docs/midi/otp_protocol.md` |
| "Wie verhaelt sich Modul X bei Edge-Case Y?" | `tests/firmware/test_<modul>.py` + entsprechender numpy-Mirror |
| "Welche Firmware-Version brauche ich?" | siehe Identity-Response, mindestens v0.1.0 |
| "Hat sich Param-ID geaendert?" | Diff von `agents/INDEX.js` `nrpnMap` zwischen Commits |
| "Wie sieht der Stock-Pattern-Layout aus?" | `docs/reverse/pattern_format.md` |
| "Welche Audio-Engine-Features sind aktiv?" | Identity-Response feature_flags |

Bei strukturellen Aenderungen am Protokoll: PR im OmniTribe-Repo, MIDI-Agent
notifies SynthStudio-Agent via Commit-Message + Update an `nrpn_spec.md`.

---

## 15.5 Sprint-95: Chord User-Slot Upload/Download (v3.43.0)

Die Bridge unterstuetzt seit v3.43.0 zwei neue Sub-Commands fuer das
chord-Modul (NRPN MSB 0x1E, 4 User-Slots a 8 Intervalle).

### CMD 0x02 SUB 0x04 — Chord User-Slot Upload (Host → Device)

Payload-Layout: `[slot u8 0..3] [count u8 0..16] [N × interval u8 signed-7bit]`
- `slot`: User-Chord-Index 0..3 (= chord_type 11..14)
- `count`: Anzahl folgender Intervalle (max 16, hardware nutzt nur 8)
- `interval`: Halbtoene relativ Root als signed-7bit two's-complement
  (-64..+63). Negative oder >63 werden device-seitig als END-Marker
  interpretiert (= "Slot leer ab hier").

TS-Bridge-API:
```ts
omniTribeBridge.uploadChordUserSlot(slotIndex, intervals);
// z.B. major-7th-add9 in User-Slot 0:
omniTribeBridge.uploadChordUserSlot(0, [0, 4, 7, 11, 14]);
```

### CMD 0x02 SUB 0x05 — Chord User-Slot Download (Host → Device → Host)

Request-Payload: `[slot u8 0..3]`
Reply-Payload: identisch zur Upload-Payload-Form
(`[slot, count, N×interval]`)

TS-Bridge-API:
```ts
// einzelnen Slot anfordern (kein await — Reply via CustomEvent)
omniTribeBridge.requestChordUserSlot(2);

// alle 4 Slots sequentiell (10ms throttled)
await omniTribeBridge.requestAllChordUserSlots();

// Reply abfangen
window.addEventListener("omnitribe:chord-user-slot", (ev) => {
  const { slotIndex, intervals } = ev.detail;
  // ... UI aktualisieren
});
```

**Loader-v1-Stub-Hinweis:** Der C-Loader liefert aktuell auf SUB 0x05
einen Stub-Reply mit `count=0` (= "Slot leer"). Echte Readback der
chord-Modul-State folgt in Sprint-96 via Mailbox-Reverse-Channel.
Bis dahin muss SynthStudio die User-Slot-Definitionen lokal cachen
(z.B. in localStorage) statt vom Device zu pollen.

### Echo-Schutz beim Upload

Im Gegensatz zu CMD 0x02 SUB 0x00 (Param-Set) liegt CMD 0x02 SUB 0x04
ausserhalb des `pendingSets`-Echo-Fensters — chord-Slots werden nicht
notified, weshalb es keine Echo-Quelle gibt. Bridge sendet roh.

---

## 16. Definition of Done

Die Integration ist fertig wenn:

- [ ] `OmniTribeBridge.ts` importiert in `client/src/audio/`
- [ ] `useOmniTribe()` Hook in `client/src/hooks/`
- [ ] `DeviceConnectionPanel.tsx` in Settings-Tab
- [ ] Min. **3 bestehende Panels** verbunden (GranularSynth + WavetableEditor + ModMatrix)
- [ ] Min. **1 neue Komponente** (ChordPanel ODER PerformancePadGrid)
- [ ] **VU-Meter-Stream** sichtbar (16-Part-Bar-Anzeige)
- [ ] Tests: `tests/features/omnitribeBridge.test.ts` mit Mock-MIDIAccess, ≥ 10 Tests gruen
- [ ] Echo-Schutz-Regression-Test: Slider-Sweep ueber 5 sec → keine UI-Oszillation
- [ ] Firefox/Safari-Hinweis im UI wenn Web-MIDI nicht verfuegbar
- [ ] Identity-Handshake in Console-Log sichtbar nach Connect

# OmniTribe ↔ SynthStudio Bidirectional Integration Architecture

**Document Version:** 1.0  
**Date:** 2026-05-18  
**Scope:** Protocol design, USB/MIDI communication, firmware-UI sync  
**Target:** OmniTribe firmware + SynthStudio desktop/web application

---

## Executive Summary

This document outlines the architectural approach for integrating OmniTribe (modified Korg Electribe 2 firmware) with SynthStudio, a professional cross-platform audio production workstation. The integration enables:

1. **Bidirectional MIDI/USB communication** between OmniTribe hardware and SynthStudio
2. **Real-time parameter synchronization** (patterns, sounds, effects, performance state)
3. **Seamless workflow** for hardware/software collaboration
4. **USB device identification** and auto-discovery
5. **Fallback resilience** for browser-based operation (web app without Electron)

---

## Part 1: SynthStudio Codebase Architecture

### 1.1 Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React 19 + TypeScript 5.9 | v19.2.1 |
| **UI Framework** | Radix UI headless + TailwindCSS 4 | 4.1.14 |
| **Desktop** | Electron 40 (Chromium 130) | 40.6.1 |
| **Audio** | Web Audio API + Tone.js 15 | 15.1.22 |
| **Build Tool** | Vite 7 | 7.1.7 |
| **Package Manager** | pnpm | 10.15.1 |
| **Test Framework** | Vitest + Playwright | 2.1.4 / 1.58.2 |

### 1.2 Project Structure

```
/sessions/determined-fervent-planck/mnt/Synthstudio/
├── client/src/                           # React frontend (5,841 lines across audio/)
│   ├── audio/
│   │   ├── AudioEngine.ts               # Main engine (synthesis, scheduling, FX)
│   │   ├── MidiClockOut.ts              # MIDI clock sender (24 PPQN)
│   │   ├── MidiNoteOut.ts               # Per-part MIDI note triggering
│   │   ├── SynthEngine.ts               # Oscillators, ADSR, FM/Wavetable
│   │   ├── LooperEngine.ts              # Live loop recording/playback
│   │   ├── AudioRecorder.ts             # Multi-track recording to IndexedDB
│   │   ├── NanoKontrolFeedback.ts       # nanoKONTROL2 LED control
│   │   ├── SpectrumAnalyzer.ts          # Real-time FFT for metering
│   │   └── worklets/                    # AudioWorklet processors
│   ├── hooks/
│   │   ├── useMidi.ts                   # 1200+ lines: Web MIDI API integration
│   │   ├── useMidiEventBridge.ts        # Event dispatch to store
│   │   ├── useMidiLearn.ts              # Right-click MIDI learn UI
│   │   ├── useOscOutBridge.ts           # OSC output to network peers
│   │   └── [14 other hooks]
│   ├── store/
│   │   ├── useAudioEngineConfigStore.ts # Low-latency audio context config
│   │   ├── useMelodicPartStore.ts       # Pattern/note data per part
│   │   ├── useDrumMachineStore.ts       # Drum sequencer state
│   │   ├── useChordMemoryStore.ts       # Chord progression memory
│   │   ├── useSceneStore.ts             # Scene/snapshot system
│   │   └── [20+ other stores]
│   ├── utils/
│   │   ├── midiOutput.ts                # Web MIDI enumeration, send helpers
│   │   ├── midiTemplates.ts             # 13 hardware presets (Launchpad, MPC, Push, etc.)
│   │   ├── electribeImport.ts           # Parse Electribe 2 .e2s/.esx files
│   │   ├── korg/
│   │   │   ├── constants.ts             # ESX-1 / E2S format specs (offsets, sizes)
│   │   │   ├── esxParser.ts             # Binary parsing for .esx samples
│   │   │   └── e2sBankReader.ts         # Binary parsing for .all banks
│   │   └── [40+ other utilities]
│   └── components/
│       ├── MidiSettings/                # MIDI device selection, learn UI
│       ├── ChannelInspector/            # Per-channel FX, MIDI routing
│       ├── Mixer/                       # Volume, pan, mute, solo
│       └── [100+ UI components]
├── electron/
│   ├── main.ts                          # Window lifecycle, menus, global shortcuts
│   ├── preload.ts + preload-additions.ts # Secure IPC bridge (context isolation)
│   ├── collab-server.ts                 # WebSocket relay for LAN collaboration
│   ├── collab-discovery.ts              # mDNS session announcement
│   ├── osc-server.ts                    # OSC receiver/sender
│   ├── export.ts / export-stereo.ts     # WAV + MIDI export
│   ├── ipcValidators.ts                 # Input sanitization for security
│   ├── useElectron.ts                   # React hook with browser fallbacks
│   └── [14 other files]
├── server/
│   └── relay.ts                         # Public WebSocket relay for WAN collab
├── tests/
│   ├── features/                        # Store unit tests
│   └── e2e/                             # Playwright browser + Electron tests
├── package.json                         # 100+ dependencies (see below)
├── vite.config.ts                       # Build config (with Electron support)
├── tsconfig.json + tsconfig.electron.json
├── CLAUDE.md                            # Developer onboarding guide
├── ROADMAP.md                           # 28KB feature backlog
└── [assets, docs, scripts, etc.]
```

### 1.3 Existing MIDI Implementation

#### 1.3.1 **MidiClockOut (TASK-230, v2.83)**

**Purpose:** Send 24 PPQN clock ticks + transport messages to external sync master (like OmniTribe).

**File:** `/client/src/audio/MidiClockOut.ts` (175 lines)

**Architecture:**
- Stateless relative to AudioContext — all tick timings computed from `currentTime + BPM`
- Three operational modes:
  - `scheduleTicks(lookAheadUntil, bpm)` — pulled by AudioEngine._schedule(), calculates all ticks in window [lastTickTime, now+lookAhead], fires immediately
  - `start(now)` — sends 0xFA (Start), resets tick counter
  - `resume(now)` — sends 0xFB (Continue) + optional Song Position Pointer (SPP)
- Drift-resistant: uses monotonic AudioContext.currentTime, NOT setInterval/setTimeout
- Dependency injection: takes callback `(bytes: number[]) => void` for testing without Web MIDI

**Output messages:**
```
0xF8    — Timing Clock (24× per quarter-note at 120 BPM ≈ 50 pulses/sec)
0xFA    — Start (reset position to bar 1, beat 1)
0xFB    — Continue (resume without position reset)
0xFC    — Stop
0xF2 lsb msb  — Song Position Pointer (14-bit, 1 unit = 6 clock pulses)
```

**Integration point:** AudioEngine._schedule() calls `_midiClockOut.scheduleTicks()` every 16ms scheduling window (100ms lookahead).

#### 1.3.2 **MidiNoteOut (TASK-240, v2.92)**

**Purpose:** Trigger external MIDI instruments per drum part (e.g., play sounds on OmniTribe instead of locally).

**File:** `/client/src/audio/MidiNoteOut.ts` (320 lines)

**Architecture:**
- Per-part configuration map: `Map<partId, MidiPartConfig>`
- Config includes: outputId (MIDI device), channel (0-15), note (0-127), noteDurationMs (default 100ms), localSoundEnabled (layering flag)
- `triggerNote(partId, time, velocity)` called by AudioEngine._scheduleStep
- Retrigger policy: if note already pending, cancels previous Note-Off before sending new Note-On (prevents stuck notes)
- Note-Off timing via setTimeout (pragmatic — Web MIDI has no hardware-precise scheduling)
- `setEnabled(false)` flushes all pending Note-Offs immediately (prevents hardware stuck notes on disable)

**Output messages:**
```
0x90 | ch   note   velocity   — Note-On
0x80 | ch   note   0          — Note-Off (velocity always 0 for drum devices)
```

#### 1.3.3 **useMidi Hook (1200+ lines)**

**Purpose:** Centralized Web MIDI API integration with device discovery, learn workflow, CC mapping.

**File:** `/client/src/hooks/useMidi.ts`

**Capabilities:**
1. **Device enumeration** — discover all MIDI input/output devices, persist selection to localStorage
2. **Input handling** — Note-On/Off → pad trigger; CC → parameter mapping
3. **MIDI Learn** — interactive mapping of hardware controls to app parameters (auto-learn queue supports mixed CC+Note sequences)
4. **Clock sync** — receive external MIDI clock, sync BPM to external source
5. **13 hardware templates** — pre-configured mappings for Launchpad MK2/3, Push 2, MPC One, nanoKONTROL2, etc.
6. **CC mapping targets** (140+ atomic actions):
   - Transport: bpm, playStop, record, tapTempo, masterVolume, bpmUp/Down
   - Channel: volume, pan, mute, solo, fxParam (all 16 FX params scalable 0-127)
   - Patterns: select, next/prev, clear, fill, randomize, duplicate
   - Performance: toggleNoteRepeat, toggleMorph, scenelaunch
   - Advanced: chain (multi-step), runScript, loopTrigger, playSlicePad
7. **Right-click MIDI-learn** (v1.86) — quick binding without modal dialogs
8. **Output device routing** — separate control of clock-out device vs. feedback device vs. note-out device

**State structure:**
```typescript
interface MidiState {
  isAvailable: boolean;              // Web MIDI API available?
  isEnabled: boolean;                // User enabled MIDI?
  devices: MidiDevice[];             // Input devices
  outputDevices: MidiDevice[];       // Output devices
  activeDeviceId: string | null;     // Selected input
  activeOutputDeviceId: string | null; // Default output
  clockOutputDeviceId: string | null; // Dedicated clock output (v2.83)
  feedbackOutputDeviceId: string | null; // nanoKONTROL2 feedback (v2.84)
  mappings: MidiMapping[];           // CC → target bindings
  noteMappings: MidiNoteMapping[];   // Note → part/target bindings
  isLearning: boolean;               // Learn mode active?
  learnTarget: MidiLearnTarget | null;
  autoLearnQueue: AutoLearnEntry[];  // Sequential auto-learn
  clockSync: boolean;                // Sync to external MIDI clock?
  externalBpm: number | null;        // Detected external BPM
  midiOutEnabled: boolean;           // Note output active?
  midiOutChannel: number;            // Channel 1-16 (0=Ch10 drums)
}
```

**Low-level helpers in midiOutput.ts:**
```typescript
enumerateMidiOutputs(access)        // Discover MIDI outputs
getOutputById(access, id)           // Get MidiOutput by ID
sendMessage(access, outputId, bytes) // Send raw bytes safely
buildNoteOn(channel, note, velocity)
buildNoteOff(channel, note)
buildSongPositionPointer(midiBeat)
buildNanoKontrolLed(cc, on)         // nanoKONTROL2 LED control
```

#### 1.3.4 **AudioEngine Integration (Lines 474, 482, 816, 1214–1267)**

**File:** `/client/src/audio/AudioEngine.ts`

**Integration points:**
```typescript
class AudioEngineClass {
  private _midiClockOut = new MidiClockOut(null);    // Line 474
  private _midiNoteOut = new MidiNoteOut(null);      // Line 482
  private _midiOutCallback: ((note, velocity, partId) => void) | null; // Line 816

  // API to set senders (called from useMidi hook on device change)
  setMidiClockOutSender(sender: (bytes: number[]) => void) { 
    this._midiClockOut.setSender(sender); 
  }
  setMidiClockOutEnabled(enabled: boolean) {
    this._midiClockOut.setEnabled(enabled);
  }
  getMidiClockOut(): MidiClockOut { return this._midiClockOut; }

  setMidiNoteOutSender(sender: (outputId: string, bytes: number[]) => void) {
    this._midiNoteOut.setSender(sender);
  }
  setMidiNoteOutPartConfig(partId: string, config: MidiPartConfig) {
    this._midiNoteOut.setPartConfig(partId, config);
  }
  getMidiNoteOut(): MidiNoteOut { return this._midiNoteOut; }

  // Scheduling integration
  play() { this._midiClockOut.start(this._nextStepTime); }     // Line 1291
  stop() { this._midiClockOut.stop(); }                        // Line 1306
  
  _schedule() {  // Called every 16ms
    this._midiClockOut.scheduleTicks(clockLookAheadUntil, clockBpm); // Line 1401
  }

  _scheduleStep() {  // Called when step triggers
    this._midiNoteOut.triggerNote(part.id, scheduledTime, velocity); // Line 1587
  }
}

export const AudioEngine = new AudioEngineClass(); // Singleton
```

### 1.4 UI Integration Layer

#### 1.4.1 **MidiSettings Component**

- Device picker (dropdown for input/output/clock/feedback devices)
- Enable/disable toggles
- Learn workflow trigger
- Template preset loader
- Layout import/export

#### 1.4.2 **ChannelInspector Component**

- Per-part MIDI note/channel configuration
- Local vs. external sound toggle (layering control)
- FX parameter bindings

#### 1.4.3 **useElectron Hook** (Fallback Architecture)

**File:** `/electron/useElectron.ts`

Wraps all platform-specific functionality with browser safe stubs:
```typescript
const electron = useElectron();
if (electron.isElectron) {
  // Native file dialogs, IPC to main process
  const path = await electron.dialog.openFile();
} else {
  // Browser fallback (e.g., FileReader, IndexedDB)
  const path = await browseLocal();
}
```

### 1.5 Existing Device Communication

#### **Korg Format Parsing (ESX-1 / E2S)**

SynthStudio can import Electribe 2 sample banks and patterns:
- `/client/src/utils/electribeImport.ts` (30KB) — parse .e2s/.esx binary files
- `/client/src/utils/korg/` — low-level binary readers with format constants
- Bi-directional sync only supports **samples**, not yet **live parameter sync**

#### **OSC (Open Sound Control)**

- `/electron/osc-server.ts` — UDP receiver/sender for network control
- `/client/src/hooks/useOscOutBridge.ts` — dispatch audio engine changes to network peers
- Already supports collaborative editing over LAN

#### **WebSocket Relay**

- `/electron/collab-server.ts` — private LAN relay server for session sharing
- `/server/relay.ts` — public cloud relay for WAN collaboration
- Used for multi-user synchronization (not device-specific)

---

## Part 2: OmniTribe Integration Strategy

### 2.1 Communication Protocol Design

#### **Overview**

```
    SynthStudio (Electron/Web)
           ↕ USB / Serial
         Host Bridge
           ↕ Custom Protocol
    OmniTribe Device (Firmware)
```

The integration uses a **vendor-defined USB protocol** (not standard MIDI class), allowing:
1. Arbitrary message framing (not 3-byte MIDI packets)
2. Bidirectional sync without polling overhead
3. Firmware state versioning and capability negotiation

#### **Transport Layer**

| Mode | Path | Typical Use | Browser Support |
|------|------|-------------|-----------------|
| **USB (HID)** | SynthStudio ↔ OmniTribe | Desktop app primary | Partial (via WebUSB) |
| **USB (Serial)** | SynthStudio ↔ OmniTribe via CH34x/PL2303 | Fallback/generic | Partial (via Web Serial API) |
| **MIDI over USB** | SynthStudio ↔ OmniTribe | Minimal (clock/notes only) | Full (Web MIDI API) |

**Recommended:** USB with custom binary protocol (HID or serial class), with MIDI fallback for browser.

#### **Message Framing**

```
┌─────┬────────┬──────────┬─────────────┬──────┐
│ SoF │ MsgLen │ MsgType  │   Payload   │ CRC8 │
├─────┼────────┼──────────┼─────────────┼──────┤
│ 0xA5│  LE16  │ 1 byte   │ 0–1024 bytes│ 1    │
└─────┴────────┴──────────┴─────────────┴──────┘
```

- **SoF (Start of Frame):** 0xA5 (sync marker)
- **MsgLen:** little-endian u16 (0–1024 bytes payload)
- **MsgType:** see 2.2 below
- **Payload:** context-dependent (pattern data, SysEx, queries)
- **CRC8:** simple checksum (prevent corruption on noisy USB lines)

#### **Message Types**

```typescript
enum OmniTribeMsgType {
  // Handshake & Negotiation
  HELLO = 0x01,              // Host → Device: request capability
  HELLO_ACK = 0x02,          // Device → Host: send version, features
  
  // Realtime Transport (interleaved with below)
  CLOCK_TICK = 0x10,         // Host → Device: 24 PPQ tick
  TRANSPORT_START = 0x11,    // Host → Device: begin playback
  TRANSPORT_STOP = 0x12,     // Host → Device: stop playback
  TRANSPORT_CONTINUE = 0x13, // Host → Device: resume after pause
  SONG_POSITION = 0x14,      // Host → Device: 0xF2-equivalent (bar/beat seek)
  
  // Pattern/Sound Sync
  PATTERN_SELECT = 0x20,     // Host → Device: switch pattern
  PATTERN_DATA = 0x21,       // Host ↔ Device: step/note/velocity bulk
  SOUND_SELECT = 0x22,       // Host → Device: switch sound in pattern
  SOUND_PARAM = 0x23,        // Host ↔ Device: sound parameter (filter, amp, etc.)
  
  // Performance
  NOTE_ON = 0x30,            // Host → Device: trigger sound (alt to CLOCK_TICK+pattern)
  NOTE_OFF = 0x31,           // Host → Device: release note
  VELOCITY_CC = 0x32,        // Host → Device: control change (volume, filter, etc.)
  PERFORMANCE_MODE = 0x33,   // Host → Device: switch to step-recording mode
  
  // Device → Host (async unsolicited)
  DEVICE_STATE = 0x40,       // Device → Host: current playback state (bar, beat, pattern)
  HARDWARE_BUTTON = 0x41,    // Device → Host: user pressed button on device
  ENCODER_TURN = 0x42,       // Device → Host: user turned encoder/knob
  
  // Bulk operations
  REQUEST_PATTERNS = 0x50,   // Host → Device: send all 64 patterns
  RESPONSE_PATTERNS = 0x51,  // Device → Host: bulk pattern data
  REQUEST_SOUNDS = 0x52,     // Host → Device: send sound library
  RESPONSE_SOUNDS = 0x53,    // Device → Host: bulk sound data
  
  // Errors & Flow Control
  ACK = 0xF0,                // Generic acknowledgment
  NAK = 0xF1,                // Generic negative ack + error code
  HEARTBEAT = 0xFE,          // Bidirectional keep-alive (every 5s)
}
```

#### **Detailed Message Specs**

**HELLO (Host → Device)**
```
Payload: [protocolVersion: u8, hostCapabilities: u32]
Response: HELLO_ACK
Purpose: Initiate connection, advertise supported features
```

**HELLO_ACK (Device → Host)**
```
Payload: [
  protocolVersion: u8,
  firmwareVersion: u32,              // e.g., 0x03_00_00_00 (v3.0)
  deviceCapabilities: u32,           // bitmask: patterns? sounds? motions?
  maxPatterns: u16,
  maxSoundsPerPattern: u8,
  maxStepsPerPattern: u8,
  maxCCControls: u8,
]
Response: none (host received device info)
```

**TRANSPORT_START (Host → Device)**
```
Payload: [bpmDivided10: u8]  // 120 BPM → 0x0C, 90 BPM → 0x09
Purpose: Host is starting playback at specified BPM
Response: none (device immediately begins clock reception)
Note: First CLOCK_TICK follows within ~100ms
```

**CLOCK_TICK (Host → Device, realtime)**
```
Payload: none
Purpose: One of 24 ticks per quarter-note
Timing: ~20.8ms intervals at 120 BPM
Note: Device counts ticks internally to update step position
```

**PATTERN_DATA (Bidirectional)**
```
Payload: [
  patternIndex: u8,          // 0-63
  stepIndex: u8,             // 0-15 (or 0-31 if 1/32 resolution)
  soundIndex: u8,            // Which sound in pattern at this step
  velocity: u8,              // 0-127 (0=muted step)
  pitchOffset: i8,           // -12..+12 semitones
  probabilityPercent: u8,    // 0=skip, 50=50%, 100=always
  ccModulation: [
    cc1: u8, value1: u8,
    cc2: u8, value2: u8,
    … up to 4 CC pairs
  ]
]
Direction: Host → Device (one-shot sync)
Response: ACK if successful, NAK with error code if invalid
```

**DEVICE_STATE (Device → Host, async)**
```
Payload: [
  currentBar: u16,
  currentBeat: u8,
  currentStep: u8,
  currentPattern: u8,
  isPlaying: u8,             // 0 or 1
  recordingMode: u8,         // 0=off, 1=step, 2=realtime
]
Purpose: Unsolicited device state snapshot (sent every ~500ms or on change)
Typical reception: SynthStudio updates UI playhead, detects device stop
```

### 2.2 Firmware API (OmniTribe Side)

```c
// omnitribe_usb_protocol.h

// USB endpoint configuration
#define EP_OUT 0x01  // Host → Device (bulk)
#define EP_IN  0x82  // Device → Host (bulk)
#define ENDPOINT_SIZE 64
#define TIMEOUT_MS 5000

// Callback when host sends a message
void omni_usb_receive_message(const uint8_t *frame, uint16_t len) {
  const uint8_t sof = frame[0];
  const uint16_t msg_len = (frame[2] << 8) | frame[1];
  const uint8_t msg_type = frame[3];
  const uint8_t *payload = &frame[4];
  
  // CRC8 check (last byte)
  uint8_t crc_rx = frame[4 + msg_len];
  uint8_t crc_calc = crc8_calculate(frame, 4 + msg_len);
  if (crc_rx != crc_calc) {
    omni_usb_send_nak(NAK_CHECKSUM_ERROR);
    return;
  }
  
  switch (msg_type) {
    case HELLO:
      omni_handle_hello(payload, msg_len);
      break;
    case CLOCK_TICK:
      omni_handle_clock_tick();
      break;
    case PATTERN_DATA:
      omni_handle_pattern_data(payload, msg_len);
      break;
    // ... etc
  }
}

// Called by main scheduler (every 16ms or MIDI-clock-driven)
void omni_send_device_state() {
  uint8_t frame[16];
  frame[0] = 0xA5;              // SoF
  frame[1] = 8;                 // len (lo)
  frame[2] = 0;                 // len (hi)
  frame[3] = DEVICE_STATE;
  frame[4] = current_bar >> 8;
  frame[5] = current_bar & 0xFF;
  frame[6] = current_beat;
  frame[7] = current_step;
  frame[8] = current_pattern;
  frame[9] = is_playing ? 1 : 0;
  frame[10] = recording_mode;
  frame[11] = crc8_calculate(frame, 11);
  usb_bulk_send(EP_IN, frame, 12);
}
```

### 2.3 SynthStudio Integration Layer (New Module)

**New file:** `/electron/omnitribe-bridge.ts` (or `/client/src/utils/omnitribe-protocol.ts` for browser WebUSB)

**Architecture:**
```typescript
class OmniTribeBridge {
  private device: USBDevice | SerialPort | null = null;
  private messageHandlers: Map<number, (payload: Uint8Array) => void>;
  private pendingRequests: Map<number, { resolve, reject, timeout }>;
  private connectionState: "disconnected" | "connecting" | "connected" | "error";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  
  // Lifecycle
  async connect(vendorId: number, productId: number): Promise<void>
  async disconnect(): Promise<void>
  
  // Sending
  async send(msgType: OmniTribeMsgType, payload?: Uint8Array): Promise<void>
  async sendAndWait(msgType: OmniTribeMsgType, payload?: Uint8Array, timeoutMs: number): Promise<Uint8Array>
  
  // Receiving (callbacks)
  onMessage(msgType: OmniTribeMsgType, handler: (payload: Uint8Array) => void): void
  onDeviceState(handler: (state: DeviceState) => void): void
  onHardwareButton(handler: (button: ButtonEvent) => void): void
  
  // Integration with AudioEngine
  syncClockWithDevice(bpm: number): void
  syncPatternToDevice(patternIndex: number, steps: StepData[]): void
  syncSoundParamToDevice(soundIndex: number, param: string, value: number): void
  requestFullDeviceState(): Promise<FullDeviceState>
}
```

### 2.4 Electron IPC Handlers (New)

**New file:** `/electron/omnitribe-ipc.ts`

Bridges web frontend to native USB stack:

```typescript
// Renderer can request device operations via IPC
ipcMain.handle("omnitribe:connect", async (event, {vendorId, productId}) => {
  const bridge = getOrCreateOmniTribeBridge();
  await bridge.connect(vendorId, productId);
  return { success: true };
});

ipcMain.handle("omnitribe:send-pattern", async (event, {pattern, index}) => {
  const bridge = getOmniTribeBridge();
  await bridge.syncPatternToDevice(index, pattern.steps);
  return { success: true };
});

// Device state changes → broadcast to all renderer windows
bridge.onDeviceState((state) => {
  mainWindow?.webContents.send("omnitribe:device-state", state);
  fxWindows.forEach(w => w.webContents.send("omnitribe:device-state", state));
});
```

### 2.5 React Hook Integration (New)

**New file:** `/client/src/hooks/useOmniTribe.ts`

```typescript
export function useOmniTribe() {
  const [connectionState, setConnectionState] = useState<"disconnected" | "connected" | "error">("disconnected");
  const [deviceState, setDeviceState] = useState<OmniTribeDeviceState | null>(null);
  
  useEffect(() => {
    // Set up IPC listeners
    const unlistenState = useElectron().on("omnitribe:device-state", (state) => {
      setDeviceState(state);
    });
    
    return unlistenState;
  }, []);
  
  const connect = useCallback(async () => {
    const electron = useElectron();
    if (!electron.isElectron) {
      // Browser fallback: try WebUSB
      const device = await OmniTribeWebUSB.connect();
      // ...
    } else {
      // Electron: use native USB
      await electron.ipc.invoke("omnitribe:connect", {
        vendorId: OMNITRIBE_VENDOR_ID,
        productId: OMNITRIBE_PRODUCT_ID,
      });
    }
    setConnectionState("connected");
  }, []);
  
  const syncPattern = useCallback(async (patternIndex: number) => {
    const pattern = useDrumMachineStore().patterns[patternIndex];
    await useElectron().ipc.invoke("omnitribe:send-pattern", { pattern, index: patternIndex });
  }, []);
  
  return { connectionState, deviceState, connect, disconnect, syncPattern };
}
```

### 2.6 USB Device Identification

**Vendor IDs & Product IDs** (to be assigned by OmniTribe firmware team):

```typescript
// constants.ts
export const OMNITRIBE_DEVICES = [
  {
    name: "OmniTribe (Default Firmware)",
    vendorId: 0x2B00,      // Placeholder — update to actual Korg/OmniTribe USB VID
    productId: 0x1234,     // Placeholder
    interfaceClass: 0xFF,  // Vendor-defined (not MIDI class 0x01)
  },
  {
    name: "OmniTribe (Legacy)",
    vendorId: 0x2B00,
    productId: 0x1235,
    interfaceClass: 0xFF,
  },
];
```

**Auto-detection in MidiSettings UI:**

```typescript
function OmniTribeDeviceButton() {
  const [foundDevices, setFoundDevices] = useState<OmniTribeDevice[]>([]);
  
  useEffect(() => {
    // Scan for MIDI + USB devices
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess({ sysex: false }).then(onMidiAccessSuccess);
    }
    if (navigator.usb) {
      navigator.usb.getDevices().then((devices) => {
        const omnis = devices.filter(d => 
          OMNITRIBE_DEVICES.some(spec => 
            spec.vendorId === d.vendorId && spec.productId === d.productId
          )
        );
        setFoundDevices(omnis);
      });
    }
  }, []);
  
  return (
    <button onClick={() => connect()}>
      {foundDevices.length > 0 ? `Connect OmniTribe (${foundDevices.length} found)` : "OmniTribe not found"}
    </button>
  );
}
```

---

## Part 3: Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

- [ ] Define final USB VID/PID and message protocol with OmniTribe firmware team
- [ ] Implement `OmniTribeBridge` class (USB + fallback serial)
- [ ] Add Electron IPC handlers
- [ ] Test USB enumeration & connection handshake

### Phase 2: Realtime Sync (Weeks 2-3)

- [ ] Integrate clock out into AudioEngine scheduler
- [ ] Sync TRANSPORT_START/STOP/CONTINUE messages
- [ ] Implement `DEVICE_STATE` listener to detect device position changes
- [ ] Update UI playhead when device state arrives

### Phase 3: Pattern & Sound Sync (Weeks 3-4)

- [ ] Implement bidirectional PATTERN_DATA messages
- [ ] Sync drum patterns from SynthStudio to OmniTribe
- [ ] Allow editing patterns on device and pulling back to SynthStudio
- [ ] Sound parameter CC sync

### Phase 4: Performance Features (Weeks 4-5)

- [ ] Hardware button → SynthStudio action mapping
- [ ] Encoder/knob → parameter modulation
- [ ] Live recording mode on device detected in SynthStudio
- [ ] Step recording via UI with device feedback

### Phase 5: Browser Support (Week 5)

- [ ] WebUSB fallback for Chrome/Edge
- [ ] Web Serial API fallback for generic USB serial devices
- [ ] Graceful degradation warning in browser mode

### Phase 6: Testing & Polish (Week 6)

- [ ] Integration tests (device simulation)
- [ ] E2E tests with real hardware
- [ ] Error recovery scenarios (cable unplug, firmware mismatch)
- [ ] Documentation & user guide

---

## Part 4: Architecture Decisions & Trade-offs

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| **Custom binary protocol vs. MIDI** | More bandwidth-efficient, bidirectional sync, arbitrary payloads | Requires custom firmware; not class-compliant |
| **Dependency injection (Bridge callback)** | Testable without hardware; same pattern as MidiClockOut | Slight indirection in code |
| **Separate clock/note/pattern outputs** | Granular control; allows clock to Electribe + note to other device | More state to manage |
| **Electron + browser fallback** | Desktop-first with web secondary; fallback maintains feature parity | WebUSB limited in production (Android, iOS), browser lacks USB serial |
| **Heartbeat every 5s** | Detect cable unplug; prevent stale connection state | Overhead; could use interrupt-driven instead |
| **CRC8 checksum** | Lightweight error detection | Not cryptographic; won't detect all corruption (use CRC16+ for production) |
| **AsyncIterator pattern for received messages** | Natural JS async/await syntax | Requires modern runtime (Node 10+, all modern browsers) |

---

## Part 5: Security & Reliability

### USB Access Restrictions

1. **Electron:** Native USB library has full OS access; validate device VID/PID before connecting
2. **Browser WebUSB:** Requires HTTPS; user must grant permission in chooser dialog per session
3. **Web Serial:** Requires HTTPS; same permission model; useful for Windows FTDI/CH340 dongles

### Input Validation

All received payloads must be validated:
```typescript
function validateDeviceState(raw: Uint8Array): DeviceState {
  if (raw.length < 7) throw new Error("Invalid DEVICE_STATE length");
  return {
    currentBar: Math.min(9999, (raw[0] << 8) | raw[1]),
    currentBeat: Math.min(3, raw[2]),
    // ... etc, clamping to valid ranges
  };
}
```

### Resilience

- **Cable unplug:** Heartbeat timeout → auto-reconnect
- **Firmware mismatch:** HELLO_ACK protocol version check, fallback to MIDI-only mode
- **Timing drift:** AudioContext.currentTime monotonic; no scheduler jitter
- **Stuck notes:** MidiNoteOut._flushAllNoteOffs() on disconnect

---

## Part 6: Testing Strategy

### Unit Tests (Vitest)

```typescript
describe("OmniTribeBridge", () => {
  it("should encode CLOCK_TICK message correctly", () => {
    const msg = encodeMessage(CLOCK_TICK, new Uint8Array(0));
    expect(msg[0]).toBe(0xA5); // SoF
    expect(msg[3]).toBe(CLOCK_TICK);
    expect(msg[msg.length - 1]).toBe(calculateCrc8(msg.slice(0, -1)));
  });
  
  it("should validate DEVICE_STATE payload bounds", () => {
    const invalid = new Uint8Array([0xFF, 0xFF, 5, 20, 0, 0, 0]); // bar > 9999
    expect(() => validateDeviceState(invalid)).toThrow();
  });
});
```

### Integration Tests (Playwright)

```typescript
test("should sync drum pattern to OmniTribe and detect device playback", async ({ page }) => {
  // 1. Connect to device
  await page.click('button:has-text("Connect OmniTribe")');
  await expect(page.getByText("Connected")).toBeVisible();
  
  // 2. Create pattern
  await page.click('button:has-text("Select Pattern 1")');
  await page.click('[data-step-index="0"]'); // Add step
  
  // 3. Sync to device
  await page.click('button:has-text("Sync to Device")');
  await expect(page.getByText("Pattern 1 synced")).toBeVisible();
  
  // 4. Simulate device playback (mock OmniTribeBridge)
  await page.evaluate(() => {
    window.mockOmniTribeDeviceState({ currentStep: 2, isPlaying: true });
  });
  
  // 5. Verify UI updates
  await expect(page.getByTestId("playhead")).toHaveAttribute("data-step", "2");
});
```

### Simulation (Mock Device)

```typescript
class MockOmniTribeDevice implements OmniTribeHardware {
  private clockTickCounter = 0;
  private isPlaying = false;
  
  receive(msg: OmniTribeMessage) {
    if (msg.type === TRANSPORT_START) {
      this.isPlaying = true;
      this.clockTickCounter = 0;
      this.send({ type: HELLO_ACK, ...this.getCapabilities() });
    }
    if (msg.type === CLOCK_TICK && this.isPlaying) {
      this.clockTickCounter++;
      if (this.clockTickCounter % 6 === 0) { // Every 6 ticks = 1 beat
        this.simulateStepAdvance();
      }
    }
  }
  
  private simulateStepAdvance() {
    this.currentStep = (this.currentStep + 1) % 16;
    this.send({
      type: DEVICE_STATE,
      currentStep: this.currentStep,
      isPlaying: this.isPlaying,
    });
  }
}
```

---

## Part 7: Documentation & User Guide

### For Users

1. **Getting Started:** "Connecting OmniTribe to SynthStudio"
   - USB cable setup
   - Driver installation (if needed for serial fallback)
   - Auto-detection flow
   - First sync (pattern push)

2. **Synchronization Modes**
   - Clock-only: external MIDI sync
   - Bi-sync: patterns + sounds
   - Standalone: device-only editing with SynthStudio display

3. **Troubleshooting**
   - "Device not detected" — check USB cable, drivers
   - "Sync fails" — verify firmware version
   - "Stuck notes" — reconnect or send MIDI panic

### For Developers

1. **API Reference** — message types, payload structs, error codes
2. **Integration Guide** — how to add OmniTribe support to other DAWs
3. **Firmware Protocol Spec** — binary layout, CRC algorithm, timing constraints

---

## Appendix A: Dependencies & Imports

**New npm packages** (for Electron USB support):
```json
{
  "usb": "^2.12.0",              // libusb wrapper (desktop)
  "serialport": "^12.0.0",       // Serial port fallback (desktop)
  "web-usb": "^3.2.0"            // Type definitions (browser)
}
```

**Existing imports already available:**
- `web-midi-api` types (built-in browser API)
- `electron` IPC, dialog, etc. (already in devDependencies)

---

## Appendix B: Example Interaction Flow

```
Timeline:  SynthStudio (Web/Electron) ↔ OmniTribe Device

T=0s:      User clicks "Connect OmniTribe"
           → Electron: enumerate USB devices
           → Found OmniTribe (VID 0x2B00, PID 0x1234)
           → Open USB connection

T=0.1s:    SynthStudio sends HELLO (protocolVersion=1, features=...)
           ← OmniTribe responds HELLO_ACK (firmware=3.0, capabilities=...)
           → Display "Connected to OmniTribe v3.0"

T=1s:      User clicks PLAY
           → AudioEngine.play()
           → MidiClockOut.start(120 BPM)
           → Send TRANSPORT_START (0x0C = 120 BPM / 10)

T=1.02s:   First CLOCK_TICK sent (24 PPQ)
T=1.042s:  Second CLOCK_TICK sent
           ... (every 20.8ms until stop)

T=2s:      User drags drum sample onto Pattern 1, Step 3
           → AudioEngine._scheduleStep() for Part "Kick"
           → MidiNoteOut.triggerNote(partId="kick", velocity=100)
           → Sends NOTE_ON to OmniTribe (if routing configured)

T=2.5s:    Device button pressed (user holds "TAP TEMPO")
           ← OmniTribe sends HARDWARE_BUTTON (buttonId=5)
           → useOmniTribe hook receives event
           → Trigger tapTempo action in SynthStudio

T=5s:      Device playhead at Pattern 1, Step 8
           ← OmniTribe sends unsolicited DEVICE_STATE
           → SynthStudio updates UI playhead position
           → User sees both SynthStudio + hardware in sync

T=10s:     User clicks STOP
           → MidiClockOut.stop()
           → Send TRANSPORT_STOP
           ← OmniTribe stops clock reception, freezes playhead

T=10.1s:   Periodic heartbeat sent (still connected?)
           ← Device responds with current state
           → Connection confirmed
```

---

## Appendix C: Firmware Checklist for OmniTribe Team

**Pre-integration tasks:**

- [ ] Assign USB VID/PID (or use CDC/HID class descriptor)
- [ ] Implement USB/serial driver for Windows, macOS, Linux
- [ ] Implement message framing & CRC8 validation
- [ ] Implement clock tick counter from CLOCK_TICK messages
- [ ] Implement DEVICE_STATE broadcast (every 500ms or on change)
- [ ] Implement PATTERN_DATA receive (write to RAM, validate step bounds)
- [ ] Implement SOUND_PARAM receive (write to synth engine state)
- [ ] Test protocol with SynthStudio before mass release

---

## Summary

This architecture provides a **robust, testable, and future-proof** integration between OmniTribe firmware and SynthStudio. Key strengths:

1. **Leverage existing MIDI infrastructure** — MidiClockOut, MidiNoteOut, useMidi hook already battle-tested
2. **Fallback for browser** — WebUSB + Web Serial APIs ensure feature parity on web
3. **Separation of concerns** — Bridge class isolated from UI; easy to mock/test
4. **Extensibility** — Message types can be added without breaking old firmware
5. **Security** — Input validation, permission gates, graceful error handling

The implementation can be done incrementally: clock sync first (1 week), then patterns (2 weeks), performance features (1 week), browser support (1 week), testing (1 week) = **6 weeks end-to-end**.


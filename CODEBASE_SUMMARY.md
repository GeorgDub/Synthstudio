# SynthStudio Codebase Summary for OmniTribe Integration

## Quick Facts

| Aspect | Details |
|--------|---------|
| **Language** | TypeScript 5.9 + React 19 |
| **Build System** | Vite 7 + Electron 40 |
| **Audio Library** | Tone.js 15 + Web Audio API |
| **UI Framework** | Radix UI + TailwindCSS 4 |
| **MIDI** | Web MIDI API (built-in, no npm package) |
| **Test Framework** | Vitest + Playwright |
| **Platform** | Electron desktop + web browser (isomorphic) |
| **Total Audio Code** | 5,841 lines TypeScript across `/audio/` |
| **Package Manager** | pnpm (critical: never use npm) |
| **Node Version** | 18+ (Electron runs Chromium 130) |

## Key Architectural Patterns

### 1. **Singleton Audio Engine**
```typescript
// /client/src/audio/AudioEngine.ts
class AudioEngineClass { /* synthesis, scheduling, effects */ }
export const AudioEngine = new AudioEngineClass();

// Used everywhere as: AudioEngine.play(), AudioEngine.setMidi...()
```

### 2. **Custom Store Pattern (Not Zustand)**
```typescript
// /client/src/store/useSomeStore.ts
let _state = loadState();
const _listeners = new Set();
export function useSomeStore() {
  const [, rerender] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => _listeners.delete(rerender);
  }, []);
  return _state;
}
```

### 3. **Dependency Injection for MIDI (Testable)**
```typescript
// MidiClockOut takes callback, not navigator.requestMIDIAccess()
const clock = new MidiClockOut((bytes) => device.send(bytes));
```

### 4. **Isomorphic Electron + Web**
```typescript
// /electron/useElectron.ts — browser fallback for all IPC
const electron = useElectron();
if (electron.isElectron) {
  const file = await electron.dialog.openFile(); // Native
} else {
  const file = await FileReader.readAsArrayBuffer(); // Browser
}
```

### 5. **CSS Design Token System (No Hardcoded Colors)**
```typescript
// All colors via CSS variables
<div className="bg-bg-panel text-text-primary border border-border-color">
  // Maps to: --ss-bg-panel, --ss-text-primary, --ss-border
</div>
```

## Existing MIDI Implementation

### **MidiClockOut (v2.83)**
- **File:** `client/src/audio/MidiClockOut.ts` (175 lines)
- **What:** Sends 24 PPQN clock ticks + Start/Stop/Continue to external hardware
- **How:** Stateless relative to AudioContext; called by AudioEngine._schedule() every 16ms
- **Integration:** AudioEngine._midiClockOut.setSender(callback)
- **Output:** 0xF8 (clock), 0xFA (start), 0xFB (continue), 0xFC (stop), 0xF2 (song position)

### **MidiNoteOut (v2.92)**
- **File:** `client/src/audio/MidiNoteOut.ts` (320 lines)
- **What:** Triggers drum notes on external MIDI devices
- **Config:** Per-part mapping (note, channel, duration, local sound toggle)
- **Integration:** AudioEngine._midiNoteOut.triggerNote(partId, velocity)
- **Output:** 0x90/0x80 (note on/off), channel 0-15, note 0-127

### **useMidi Hook (1200+ lines)**
- **File:** `client/src/hooks/useMidi.ts`
- **Features:**
  - Device enumeration & selection
  - CC mapping (140+ targets)
  - Auto-learn workflow (sequential CC+Note capture)
  - 13 hardware presets (Launchpad, Push 2, nanoKONTROL2, Electribe, etc.)
  - Right-click MIDI-learn UI (v1.86+)
  - Clock sync (receive external MIDI clock)
  - Layout import/export (JSON format)
  - Separate clock/feedback/note-out device routing
- **Output:** Manages Web MIDI Access, persists selections to localStorage

### **Low-Level MIDI Helpers (midiOutput.ts)**
- `enumerateMidiOutputs(access)` — discover devices
- `getOutputById(access, id)` — get MidiOutput object
- `sendMessage(access, outputId, bytes)` — send bytes safely (catches errors)
- `buildNoteOn(channel, note, velocity)` — construct 3-byte message
- `buildSongPositionPointer(midiBeat)` — construct SPP message
- `buildNanoKontrolLed(cc, on)` — nanoKONTROL2 LED control

## Building Blocks for OmniTribe Integration

### Already Available
- ✅ Clock output infrastructure (MidiClockOut)
- ✅ Note output infrastructure (MidiNoteOut)
- ✅ Dependency injection pattern for testability
- ✅ Web MIDI API integration (useMidi)
- ✅ Electron IPC bridge pattern (useElectron)
- ✅ AsyncIterator pattern for realtime events
- ✅ Korg binary format parsers (ESX-1, E2S)
- ✅ Multi-window architecture (Electron)

### To Build
- ❌ USB/serial bridge (custom binary protocol, not MIDI)
- ❌ OmniTribeBridge class (USB enumeration + message framing)
- ❌ Electron USB IPC handlers
- ❌ React useOmniTribe hook
- ❌ Device state synchronization UI
- ❌ WebUSB / Web Serial fallback for browser
- ❌ Integration tests & hardware simulation

## File Organization for New Code

```
NEW:
  /electron/omnitribe-bridge.ts           # USB + serial communication
  /electron/omnitribe-ipc.ts              # Electron IPC handlers
  /client/src/hooks/useOmniTribe.ts       # React integration hook
  /client/src/utils/omnitribe-protocol.ts # Message encoding/decoding
  /client/src/components/OmniTribePanel/  # UI for connection + status
  /tests/integration/omnitribe-mock.test.ts
  
MODIFIED (minimal):
  /client/src/audio/AudioEngine.ts        # Add setOmniTribeSync() method
  /electron/main.ts                       # Register omnitribe-ipc handlers
  /client/src/components/MidiSettings/    # Add OmniTribe device button
```

## Key Interfaces to Implement

```typescript
// Message types (USB protocol)
enum OmniTribeMsgType {
  HELLO = 0x01, HELLO_ACK = 0x02,
  CLOCK_TICK = 0x10, TRANSPORT_START = 0x11,
  PATTERN_DATA = 0x21, SOUND_PARAM = 0x23,
  NOTE_ON = 0x30, NOTE_OFF = 0x31,
  DEVICE_STATE = 0x40, HARDWARE_BUTTON = 0x41,
  // ... etc (see full architecture doc)
}

// Per-part MIDI routing (extend MidiPartConfig)
interface OmniTribePartConfig extends MidiPartConfig {
  omniTribeDevice?: string;    // Device ID
  sendToOmniTribe?: boolean;   // Route via custom protocol
  syncPosition?: boolean;      // Sync step position back
}

// Device state from hardware
interface OmniTribeDeviceState {
  currentBar: number;
  currentBeat: number;
  currentStep: number;
  currentPattern: number;
  isPlaying: boolean;
  recordingMode: "off" | "step" | "realtime";
}
```

## Integration Checklist

- [ ] **Week 1:** Design USB protocol with firmware team, implement OmniTribeBridge class
- [ ] **Week 2:** Clock sync (START/STOP/TICK), device enumeration
- [ ] **Week 3:** Pattern + sound sync (bidirectional)
- [ ] **Week 4:** Performance features (hardware buttons, encoders)
- [ ] **Week 5:** Browser fallback (WebUSB, Web Serial)
- [ ] **Week 6:** Testing & documentation

## Important Notes

1. **Protocol:** Custom binary (not MIDI class) for bandwidth/bidirectional sync
2. **Electron:** USB/serial stack via native bindings (usb, serialport npm packages)
3. **Browser:** WebUSB + Web Serial API (HTTPS only, user permission required)
4. **Testing:** Mock OmniTribeDevice + Vitest + Playwright for integration tests
5. **Backward compatibility:** Falls back to MIDI-only if USB unavailable

---

See **OMNITRIBE_INTEGRATION_ARCHITECTURE.md** (974 lines) for complete protocol spec, firmware API, and implementation roadmap.

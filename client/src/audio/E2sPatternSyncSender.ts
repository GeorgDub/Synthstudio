/**
 * Synthstudio - E2sPatternSyncSender (v3.232)
 *
 * Side-effect MIDI-Sender fuer das E2S Pattern Sync (Out) Feature.
 *
 * Holdet einen eigenen, lazy-initialisierten MIDIAccess-Singleton (sysex:true) und
 * sendet bei Aufruf von syncE2sPattern() die zwei Pattern-Change-MIDI-Messages
 * (CC32 + PC) an den im useE2sPatternSyncStore konfigurierten Output-Port.
 *
 * Wird von App.tsx bei jedem Pattern-Wechsel aufgerufen (via useEffect-Listener
 * auf dm.activePatternId). Hat einen internen lastSentIndex-Dedup-Guard gegen
 * Spam waehrend Pattern-Morph / Scene-Launch / rapid switches.
 *
 * Pure-helper-Bezug: client/src/utils/korg/e2sPatternOut.ts (Message-Bau)
 * State-Bezug: client/src/store/useE2sPatternSyncStore.ts (Config)
 */
import { buildPatternChangeMessages } from "../utils/korg/e2sPatternOut";
import { getE2sPatternSyncState } from "../store/useE2sPatternSyncStore";

// Modul-Singleton MIDIAccess-Cache.
let _midiAccess: MIDIAccess | null = null;
let _midiAccessPromise: Promise<MIDIAccess> | null = null;
let _lastSentIndex: number | null = null;

/**
 * Holt (und cached) MIDIAccess. Nutzt sysex:true damit der Cache mit dem
 * existierenden useMidi-Permission-Grant kompatibel ist (gleiche Permission-
 * Erweiterung in v3.232 - electron/permissions.ts).
 */
async function ensureMidiAccess(): Promise<MIDIAccess | null> {
  if (_midiAccess) return _midiAccess;
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) return null;
  if (!_midiAccessPromise) {
    _midiAccessPromise = navigator.requestMIDIAccess({ sysex: true });
  }
  try {
    _midiAccess = await _midiAccessPromise;
    return _midiAccess;
  } catch {
    _midiAccessPromise = null;
    return null;
  }
}

/**
 * Sendet Pattern-Change an die E2/E2S, falls Feature enabled + Port gewaehlt.
 * Mit internem Dedup-Guard: wiederholtes Senden desselben Index wird unterdrueckt
 * (verhindert MIDI-Spam waehrend Pattern-Morph oder rapid Scene-Cycle).
 *
 * @param patternIndex 0-basierter Pattern-Index (wird intern geclamped auf 0..249)
 */
export async function syncE2sPattern(patternIndex: number): Promise<void> {
  const state = getE2sPatternSyncState();
  if (!state.enabled || !state.outputPortId) return;
  // Dedup-Guard: skip wenn identisch zum letzten erfolgreich gesendeten Index.
  if (_lastSentIndex === patternIndex) return;
  const access = await ensureMidiAccess();
  if (!access) return;
  const out = access.outputs.get(state.outputPortId);
  if (!out) return;
  const messages = buildPatternChangeMessages(patternIndex, state.channel);
  for (const msg of messages) {
    try { out.send(msg); } catch { /* port disconnected mid-send */ }
  }
  _lastSentIndex = patternIndex;
}

/** Test-only Reset. */
export function __resetE2sPatternSyncSenderForTests(): void {
  _midiAccess = null;
  _midiAccessPromise = null;
  _lastSentIndex = null;
}

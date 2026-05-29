/**
 * Synthstudio – patternBeatRepeatLive.ts (v3.189.0)
 *
 * Pure State-Machine fuer Live-Beat-Repeat im Performance-Mode.
 *
 * Unterschied zu v3.142 beatRepeat.ts:
 *   - beatRepeat.ts arbeitet OFFLINE auf AudioBuffer (volle Sample-Daten).
 *   - DIES HIER arbeitet auf boolean[]-Step-Patterns in REAL-TIME:
 *     Halte einen Buffer von N Steps, repetiere ihn kontinuierlich solange
 *     "active". Sequencer ruft pro Step nextStep() — Helper entscheidet, ob
 *     das normale Pattern oder die gefrorene Buffer-Schleife klingt.
 *
 * Counting-Semantik (Option A, strict):
 *   - currentRepeats zaehlt vollendete Cycles (Boundaries erreicht).
 *   - Trigger setzt currentRepeats = 0 und capturedAtStep = currentStep.
 *   - Jeder Step mit (step - capturedAtStep) % bufferLength === 0 und
 *     step > capturedAtStep zaehlt einen neuen Cycle: currentRepeats++.
 *   - Bei currentRepeats > maxRepeats → automatisches Release.
 *   - Mit maxRepeats = Infinity (Default) wird nie automatisch released.
 *
 * Defensive:
 *   - empty normalPattern → liefert active:false
 *   - NaN step → 0
 *   - bufferSteps clamp 1..64
 *
 * Pure & Node-testbar.
 *
 * Tests: tests/features/pattern-beat-repeat-live.test.ts
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BUFFER_STEPS = 4;
const MIN_BUFFER_STEPS = 1;
const MAX_BUFFER_STEPS = 64;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BeatRepeatLiveOptions {
  /** Buffer-Length in Steps. Default 4. */
  bufferSteps?: number;
  /** Wie oft das gleiche Pattern wiederholt wird wenn active. Default Infinity (until released). */
  maxRepeats?: number;
}

export interface BeatRepeatState {
  active: boolean;
  buffer: boolean[];
  bufferLength: number;
  currentRepeats: number;
  capturedAtStep: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create initial state. bufferSteps wird auf 1..64 geclamped (Default 4).
 */
export function createBeatRepeatState(bufferSteps?: number): BeatRepeatState {
  const len = clampBufferSteps(bufferSteps);
  return {
    active: false,
    buffer: new Array(len).fill(false),
    bufferLength: len,
    currentRepeats: 0,
    capturedAtStep: 0,
  };
}

/**
 * Trigger (activate) the repeat: capture current buffer ab currentStep,
 * start repeating. Wrap-around via Modulo bei currentPattern.length.
 *
 * Defensive: leeres Pattern → active:false, Buffer bleibt false-gefuellt.
 */
export function triggerBeatRepeat(
  state: BeatRepeatState,
  currentPattern: readonly boolean[],
  currentStep: number,
): BeatRepeatState {
  const len = state.bufferLength;
  const step = safeStep(currentStep);

  if (!currentPattern || currentPattern.length === 0) {
    return {
      active: false,
      buffer: new Array(len).fill(false),
      bufferLength: len,
      currentRepeats: 0,
      capturedAtStep: step,
    };
  }

  const pLen = currentPattern.length;
  const buffer: boolean[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const idx = ((step + i) % pLen + pLen) % pLen;
    buffer[i] = !!currentPattern[idx];
  }

  return {
    active: true,
    buffer,
    bufferLength: len,
    currentRepeats: 0,
    capturedAtStep: step,
  };
}

/**
 * Release the repeat: stop, return to normal pattern.
 * Buffer-Inhalt bleibt erhalten (fuer evtl. Re-Trigger Inspektion);
 * active wird auf false gesetzt, currentRepeats auf 0 reset.
 */
export function releaseBeatRepeat(state: BeatRepeatState): BeatRepeatState {
  return {
    ...state,
    active: false,
    currentRepeats: 0,
  };
}

/**
 * Liefert den naechsten Step-Wert + den aktualisierten State.
 *
 * Wichtig: das returnte `active` ist der STEP-VALUE (on/off) —
 * NICHT der state.active-Flag (Repeat-Engaged-Flag).
 *
 *  - Wenn !state.active oder leeres normalPattern → step-value aus
 *    normalPattern[step % length], state unveraendert.
 *  - Wenn state.active → step-value aus state.buffer[(step - capturedAtStep)
 *    % bufferLength]. Bei Cycle-Boundary (delta>0 && delta%bufferLength===0)
 *    wird currentRepeats inkrementiert; wenn dann > maxRepeats →
 *    automatisches Release, step-value faellt zurueck auf normalPattern.
 */
export function nextStep(
  state: BeatRepeatState,
  normalPattern: readonly boolean[],
  step: number,
  options?: BeatRepeatLiveOptions,
): { active: boolean; newState: BeatRepeatState } {
  const s = safeStep(step);
  const maxRepeats = options?.maxRepeats ?? Infinity;

  // Empty pattern: defensive — keine Wiedergabe moeglich, state unveraendert.
  if (!normalPattern || normalPattern.length === 0) {
    return { active: false, newState: state };
  }

  // Inactive: lies aus dem normalen Pattern.
  if (!state.active) {
    const idx = ((s % normalPattern.length) + normalPattern.length) % normalPattern.length;
    return { active: !!normalPattern[idx], newState: state };
  }

  // Active: lies aus dem gefrorenen Buffer.
  const bufLen = state.bufferLength;
  const delta = s - state.capturedAtStep;

  // Cycle-Boundary-Detection: ein neuer Cycle beginnt, wenn delta>0 und
  // delta-modulo-bufLen === 0. Negative delta (rueckwaerts) wird ignoriert —
  // Performance-Mode laeuft monoton vorwaerts.
  let nextRepeats = state.currentRepeats;
  if (delta > 0 && delta % bufLen === 0) {
    nextRepeats = state.currentRepeats + 1;
  }

  // Auto-Release: zu viele Cycles → fall back to normalPattern.
  if (nextRepeats > maxRepeats) {
    const released: BeatRepeatState = {
      ...state,
      active: false,
      currentRepeats: 0,
    };
    const idx = ((s % normalPattern.length) + normalPattern.length) % normalPattern.length;
    return { active: !!normalPattern[idx], newState: released };
  }

  // Normal active read: positive modulo (auch wenn delta<0 — defensive).
  const offset = ((delta % bufLen) + bufLen) % bufLen;
  const buffered = !!state.buffer[offset];

  return {
    active: buffered,
    newState:
      nextRepeats === state.currentRepeats
        ? state
        : { ...state, currentRepeats: nextRepeats },
  };
}

/**
 * Sequencer-Read-Remap für Live-Beat-Repeat (v3.240).
 *
 * Liefert für einen laufenden Sequencer-Step den EFFEKTIVEN Step-Index, aus dem
 * das (live) Pattern gelesen werden soll. Im Gegensatz zu nextStep() friert dies
 * keinen Buffer ein, sondern bildet ein N-Step-Fenster ab und loopt es:
 *
 *   readIndex(S) = capturedAtStep + ((S - capturedAtStep) mod bufferLength)
 *
 * Der Aufrufer (AudioEngine) wrappt das Ergebnis anschließend modulo der
 * Pattern-Länge, sodass das Fenster im Playback-Order über das Pattern wandert.
 *
 * Inaktiv oder Step vor dem Capture → Identität (normaler Pattern-Read).
 */
export function beatRepeatReadIndex(
  state: Pick<BeatRepeatState, "active" | "capturedAtStep" | "bufferLength">,
  stepIndex: number,
): number {
  const s = safeStep(stepIndex);
  if (!state.active) return s;
  const len = Math.floor(state.bufferLength);
  const bufLen = Number.isFinite(len) && len >= MIN_BUFFER_STEPS ? len : DEFAULT_BUFFER_STEPS;
  const captured = safeStep(state.capturedAtStep);
  const delta = s - captured;
  if (delta < 0) return s; // Step liegt vor dem Trigger → normales Pattern.
  return captured + (delta % bufLen);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function clampBufferSteps(v: number | undefined): number {
  if (!Number.isFinite(v as number)) return DEFAULT_BUFFER_STEPS;
  const n = Math.floor(v as number);
  if (n < MIN_BUFFER_STEPS) return MIN_BUFFER_STEPS;
  if (n > MAX_BUFFER_STEPS) return MAX_BUFFER_STEPS;
  return n;
}

function safeStep(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.floor(v);
}

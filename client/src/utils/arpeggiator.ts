// Synthstudio - arpeggiator.ts
// Pure TypeScript arpeggiator utility. No React.

export type ArpMode = "up" | "down" | "upDown" | "random" | "chord" | "converge" | "diverge" | "order";
export type ArpOctaves = 1 | 2 | 3;
export type ArpVelocityPattern = "flat" | "accent24" | "accent13" | "crescendo" | "decrescendo" | "random";

/**
 * Wohin der Arpeggiator seine Noten schickt:
 *  - "synth":   interne Synth-Stimme (lokal hörbar, kein Part nötig)
 *  - "channel": treibt einen ausgewählten Channel/Part (dessen Sample/Synth)
 *  - "midi":    sendet Note-On/Off an einen externen MIDI-Ausgang
 */
export type ArpOutputMode = "synth" | "channel" | "midi";

export const ARP_OUTPUT_MODE_LABELS: Record<ArpOutputMode, string> = {
  synth:   'Interner Synth',
  channel: 'Channel treiben',
  midi:    'MIDI-Ausgang',
};

export interface ArpOptions {
  notes: number[];
  mode: ArpMode;
  octaves: ArpOctaves;
  stepCount: number;
  seed?: number;
  velocityPattern?: ArpVelocityPattern;
  gateLength?: number;   // 0.1–1.0 (Länge jedes Arp-Steps)
  stepSkip?: number;     // 0=kein Skip, 1=jede 2. Note überspringen
}

export interface ArpStep {
  note: number;
  active: boolean;
  velocity: number;
  length?: number;
}

export const ARP_MODE_LABELS: Record<ArpMode, string> = {
  up:       'Aufwärts',
  down:     'Abwärts',
  upDown:   'Auf/Ab',
  random:   'Zufall',
  chord:    'Akkord',
  converge: 'Konvergieren',
  diverge:  'Divergieren',
  order:    'Eingabe-Reihenfolge',
};

export const ARP_VELOCITY_LABELS: Record<ArpVelocityPattern, string> = {
  flat:        'Gleichmäßig',
  accent24:    'Betonung 2+4',
  accent13:    'Betonung 1+3',
  crescendo:   'Anschwellend',
  decrescendo: 'Abschwellend',
  random:      'Zufällig',
};

function getVelocity(pattern: ArpVelocityPattern, stepIdx: number, totalNotes: number, rng: () => number): number {
  switch (pattern) {
    case "flat":        return 90;
    case "accent24":    return stepIdx % 2 === 1 ? 110 : 70;
    case "accent13":    return stepIdx % 2 === 0 ? 110 : 70;
    case "crescendo":   return Math.round(40 + (stepIdx / Math.max(1, totalNotes - 1)) * 87);
    case "decrescendo": return Math.round(127 - (stepIdx / Math.max(1, totalNotes - 1)) * 87);
    case "random":      return Math.round(50 + rng() * 77);
    default:            return 90;
  }
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPool(notes: number[], octaves: ArpOctaves): number[] {
  const pool: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const n of notes) pool.push(n + o * 12);
  }
  return pool;
}

export function applyArp(options: ArpOptions): ArpStep[] {
  const {
    notes, mode, octaves, stepCount, seed = 12345,
    velocityPattern = "flat", gateLength = 1, stepSkip = 0,
  } = options;
  const rand = mulberry32(seed);

  if (notes.length === 0) {
    return Array.from({ length: stepCount }, () => ({ note: 60, active: false, velocity: 0 }));
  }

  const poolAsc = buildPool(notes, octaves);
  const sortedNotes = [...notes].sort((a, b) => a - b);
  let pool: number[];

  switch (mode) {
    case 'up':     pool = poolAsc; break;
    case 'down':   pool = [...poolAsc].reverse(); break;
    case 'upDown': {
      const desc = [...poolAsc].reverse().slice(1, poolAsc.length - 1);
      pool = [...poolAsc, ...desc];
      break;
    }
    case 'converge': {
      // Noten von außen nach innen
      const temp: number[] = [];
      let lo = 0, hi = poolAsc.length - 1;
      while (lo <= hi) { temp.push(poolAsc[lo++]); if (lo <= hi) temp.push(poolAsc[hi--]); }
      pool = temp;
      break;
    }
    case 'diverge': {
      // Noten von innen nach außen
      const mid = Math.floor(poolAsc.length / 2);
      const temp: number[] = [];
      for (let d = 0; d <= mid; d++) {
        if (mid - d >= 0) temp.push(poolAsc[mid - d]);
        if (mid + d < poolAsc.length && d > 0) temp.push(poolAsc[mid + d]);
      }
      pool = temp;
      break;
    }
    case 'order':  pool = notes.map(n => n); break; // Eingabe-Reihenfolge
    case 'random':
    case 'chord':
    default: pool = poolAsc; break;
  }

  let noteIndex = 0;
  return Array.from({ length: stepCount }, (_, i) => {
    // Step-Skip: jede N+1-te Note ausblenden
    if (stepSkip > 0 && i % (stepSkip + 1) === stepSkip) {
      return { note: pool[noteIndex % pool.length], active: false, velocity: 0, length: gateLength };
    }

    if (mode === 'chord') {
      const vel = getVelocity(velocityPattern, i, stepCount, rand);
      return { note: sortedNotes[0], active: true, velocity: vel, length: gateLength };
    }
    if (mode === 'random') {
      const idx = Math.floor(rand() * pool.length);
      const vel = getVelocity(velocityPattern, i, stepCount, rand);
      return { note: pool[idx], active: true, velocity: vel, length: gateLength };
    }

    const vel = getVelocity(velocityPattern, noteIndex, pool.length, rand);
    const step = { note: pool[noteIndex % pool.length], active: true, velocity: vel, length: gateLength };
    noteIndex++;
    return step;
  });
}

/**
 * Wählt den Arp-Step für einen absoluten Sequencer-Step (wrappt modular über
 * die Arp-Step-Liste). Liefert nur aktive Steps zurück — inaktive (Skip / leere
 * Noten) ergeben `null`, damit der Aufrufer einfach `if (!ev) return` schreiben
 * kann. Pure: kein State, kein Side-Effect (für Engine-Playback + Tests).
 */
export function arpStepAt(steps: ArpStep[], absoluteStep: number): ArpStep | null {
  if (steps.length === 0) return null;
  const len = steps.length;
  const idx = ((absoluteStep % len) + len) % len; // sichere Modulo für negative Indizes
  const s = steps[idx];
  return s && s.active ? s : null;
}

/** MIDI-Notennummer → Frequenz in Hz (A4 = 69 = 440 Hz). */
export function arpMidiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
// Synthstudio - arpeggiator.ts
// Pure TypeScript arpeggiator utility. No React.

export type ArpMode = "up" | "down" | "upDown" | "random" | "chord";
export type ArpOctaves = 1 | 2 | 3;

export interface ArpOptions {
  notes: number[];
  mode: ArpMode;
  octaves: ArpOctaves;
  stepCount: number;
  seed?: number;
}

export interface ArpStep {
  note: number;
  active: boolean;
  velocity: number;
}

export const ARP_MODE_LABELS: Record<ArpMode, string> = {
  up:     'Aufwärts',
  down:   'Abwärts',
  upDown: 'Auf/Ab',
  random: 'Zufall',
  chord:  'Akkord',
};

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
  const { notes, mode, octaves, stepCount, seed = 12345 } = options;
  const rand = mulberry32(seed);

  if (notes.length === 0) {
    return Array.from({ length: stepCount }, () => ({ note: 60, active: false, velocity: 0 }));
  }

  const poolAsc = buildPool(notes, octaves);
  let pool: number[];
  switch (mode) {
    case 'up':     pool = poolAsc; break;
    case 'down':   pool = [...poolAsc].reverse(); break;
    case 'upDown': {
      const desc = [...poolAsc].reverse().slice(1, poolAsc.length - 1);
      pool = [...poolAsc, ...desc];
      break;
    }
    case 'random':
    case 'chord':
    default: pool = poolAsc; break;
  }

  return Array.from({ length: stepCount }, (_, i) => {
    if (mode === 'chord') {
      return { note: poolAsc[0], active: true, velocity: 100 };
    }
    if (mode === 'random') {
      const idx = Math.floor(rand() * pool.length);
      return { note: pool[idx], active: true, velocity: 75 + Math.floor(rand() * 45) };
    }
    return { note: pool[i % pool.length], active: true, velocity: 100 };
  });
}
/**
 * Synthstudio – patternFollowActionChain.ts (v3.187.0)
 *
 * Pattern-Follow-Action-Chain-Resolver: Pure-Helper, der die naechste
 * Pattern-ID basierend auf einer Follow-Action-Definition + State liefert.
 *
 * Foundation fuer kuenftige Song-Mode/Arrangement-Logik. Vergleichbar mit
 * Ableton-Live "Follow Actions" oder Elektron "Pattern Chain".
 *
 * Public Surface:
 *  - resolveFollowAction: Hauptfunktion, liefert { nextPatternId, nextState }
 *  - FOLLOW_ACTION_LABELS: human-readable Action-Labels fuer UI
 *  - FollowActionType / FollowActionDef / FollowState Typen
 *
 * Determinismus via mulberry32 (inline, kein Cross-Util-Import).
 * Eingaben (patterns, action, state, weights) werden niemals mutiert.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export type FollowActionType =
  | "none"             // Stop or loop current pattern
  | "next"             // → next pattern in list
  | "prev"             // → previous
  | "random"           // → random pattern in list
  | "specific"         // → specific pattern by ID
  | "chain"            // → sequence of patterns
  | "weighted";        // → weighted random

export interface FollowActionDef {
  type: FollowActionType;
  /** Bei "specific": target-id. */
  targetId?: string;
  /** Bei "chain": liste der pattern-IDs, abgefragt via chainPosition. */
  chainIds?: readonly string[];
  /** Bei "weighted": [{id, weight}]. */
  weights?: readonly { id: string; weight: number }[];
  /**
   * Wie oft das current pattern wiederholt wird bevor Action greift.
   * Default 1 — d.h. "spiele 1x, dann action".
   */
  repeatCount?: number;
}

export interface FollowState {
  currentPatternId: string;
  currentRepeats: number;
  chainPosition: number;
}

// ─── UI Labels ───────────────────────────────────────────────────────────────

export const FOLLOW_ACTION_LABELS: Record<FollowActionType, string> = {
  none:     "None (Loop/Stop)",
  next:     "Next Pattern",
  prev:     "Previous Pattern",
  random:   "Random Pattern",
  specific: "Specific Pattern",
  chain:    "Chain Sequence",
  weighted: "Weighted Random",
};

// ─── PRNG: mulberry32 (inline) ────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = Number.isFinite(seed) ? Math.floor(seed) | 0 : 1;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Sanitizers ───────────────────────────────────────────────────────────────

function sanitizeRepeatCount(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value)) return 1;
  const n = Math.floor(value);
  if (n < 1) return 1;
  return n;
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

/**
 * Liefert die naechste Pattern-ID + State-Update.
 *
 * Falls noch nicht genug repeats: stay on current pattern (incrementiert repeats).
 * Sonst: resolve action.
 *
 * @param patterns  Liste aller verfuegbaren Patterns (read-only, nicht mutiert).
 * @param action    Follow-Action-Definition.
 * @param state     Aktueller Follow-State.
 * @param seed      Optionaler PRNG-Seed fuer "random" / "weighted" (default 1).
 */
export function resolveFollowAction(
  patterns: readonly { id: string }[],
  action: FollowActionDef,
  state: FollowState,
  seed?: number,
): { nextPatternId: string; nextState: FollowState } {
  // 1) Empty-Patterns-Defensive: kein Movement moeglich, bleib auf current
  if (patterns.length === 0) {
    return {
      nextPatternId: state.currentPatternId,
      nextState: {
        ...state,
        currentRepeats: state.currentRepeats + 1,
      },
    };
  }

  const repeatCount = sanitizeRepeatCount(action.repeatCount);

  // 2) Stay-Logik: wenn noch nicht genug repeats erreicht
  if (state.currentRepeats < repeatCount - 1) {
    return {
      nextPatternId: state.currentPatternId,
      nextState: {
        ...state,
        currentRepeats: state.currentRepeats + 1,
      },
    };
  }

  // 3) Action greift — currentRepeats wird auf 0 zurueckgesetzt
  const currentIdx = patterns.findIndex((p) => p.id === state.currentPatternId);
  const rngSeed = Number.isFinite(seed) ? (seed as number) : 1;

  let nextPatternId = state.currentPatternId;
  let nextChainPosition = state.chainPosition;

  switch (action.type) {
    case "none": {
      nextPatternId = state.currentPatternId;
      break;
    }

    case "next": {
      // currentIdx=-1 (currentId nicht in patterns) → idx 0 als Fallback
      const baseIdx = currentIdx < 0 ? -1 : currentIdx;
      const idx = (baseIdx + 1) % patterns.length;
      nextPatternId = patterns[idx].id;
      break;
    }

    case "prev": {
      const len = patterns.length;
      // currentIdx=-1 → letzter Index als Fallback (prev von "nirgends" = letzter)
      const baseIdx = currentIdx < 0 ? len : currentIdx;
      const idx = (baseIdx - 1 + len) % len;
      nextPatternId = patterns[idx].id;
      break;
    }

    case "random": {
      const rng = makeRng(rngSeed);
      const idx = Math.floor(rng() * patterns.length) % patterns.length;
      nextPatternId = patterns[idx].id;
      break;
    }

    case "specific": {
      const target = action.targetId;
      if (target && patterns.some((p) => p.id === target)) {
        nextPatternId = target;
      } else {
        nextPatternId = state.currentPatternId;
      }
      break;
    }

    case "chain": {
      const chainIds = action.chainIds;
      if (!chainIds || chainIds.length === 0) {
        nextPatternId = state.currentPatternId;
      } else {
        const pos = state.chainPosition;
        const safePos = ((pos % chainIds.length) + chainIds.length) % chainIds.length;
        const candidate = chainIds[safePos];
        // Wenn candidate nicht in patterns ist, fallback auf currentId
        if (patterns.some((p) => p.id === candidate)) {
          nextPatternId = candidate;
        } else {
          nextPatternId = state.currentPatternId;
        }
        nextChainPosition = safePos + 1;
      }
      break;
    }

    case "weighted": {
      const weights = action.weights;
      if (!weights || weights.length === 0) {
        nextPatternId = state.currentPatternId;
        break;
      }
      // Nur positive weights beruecksichtigen
      let total = 0;
      for (const w of weights) {
        if (Number.isFinite(w.weight) && w.weight > 0) total += w.weight;
      }
      if (total <= 0) {
        // alle weights <=0 / NaN: defensive Fallback auf currentId
        nextPatternId = state.currentPatternId;
        break;
      }
      const rng = makeRng(rngSeed);
      const pick = rng() * total;
      let cum = 0;
      let chosen: string = state.currentPatternId;
      for (const w of weights) {
        if (!Number.isFinite(w.weight) || w.weight <= 0) continue;
        cum += w.weight;
        if (pick < cum) {
          chosen = w.id;
          break;
        }
      }
      // Validate chosen ist in patterns; sonst currentId
      if (patterns.some((p) => p.id === chosen)) {
        nextPatternId = chosen;
      } else {
        nextPatternId = state.currentPatternId;
      }
      break;
    }
  }

  return {
    nextPatternId,
    nextState: {
      currentPatternId: nextPatternId,
      currentRepeats: 0,
      chainPosition: nextChainPosition,
    },
  };
}

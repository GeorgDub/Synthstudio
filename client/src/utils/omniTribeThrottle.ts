/**
 * omniTribeThrottle.ts — Trailing-Throttle pro Param-Key fuer NRPN-Sends.
 *
 * Slider-Drag feuert onChange potenziell auf jedem Maus-Move (60-120 Hz).
 * Die Bridge throttled selber auf 100/sec, queue-flush koennte aber bei
 * mehreren parallelen Slidern weiter ausfuellen. Wir reduzieren deshalb
 * pro Param-Key (z.B. "0:0x19:0x00") VOR der Bridge: max 1 Send / 16 ms
 * (~60 Hz), mit garantierter Trailing-Auslieferung des letzten Werts.
 *
 * Begruendung: leading-Wert geht nicht verloren, weil der erste call
 * sofort sendet (kein pending → immediate send). Folge-Calls innerhalb
 * MIN_INTERVAL_MS werden coalesced, der zuletzt empfangene Wert wird
 * via setTimeout am Intervall-Ende geflushed (trailing-Edge).
 *
 * Isomorph: kein DOM/window-Access. Sicher in Node-Tests (Vitest).
 */

export interface ThrottledSenderOptions {
  /** Minimum Intervall in ms zwischen Sends fuer denselben Key. Default 16ms (~60 Hz). */
  minIntervalMs?: number;
}

interface SlotState {
  lastSentAt: number;
  pendingValue: unknown[] | null;
  timerId: ReturnType<typeof setTimeout> | null;
}

/**
 * Erzeugt einen throttled-Sender. Jeder Key (z.B. NRPN-Adresse als String)
 * hat seinen eigenen Slot — Sliders pro Param interferieren nicht.
 *
 * Beispiel:
 *   const send = makeThrottledSender((args) => omniTribeBridge.setParam(...args));
 *   send("0:25:0", [0, 0x19, 0x00, value]);   // Granular Grain-Size Part 0
 */
export function makeThrottledSender<TArgs extends unknown[]>(
  fn: (args: TArgs) => void,
  options: ThrottledSenderOptions = {},
): {
  send: (key: string, args: TArgs) => void;
  flush: (key?: string) => void;
  cancel: (key?: string) => void;
} {
  const minIntervalMs = options.minIntervalMs ?? 16;
  const slots = new Map<string, SlotState>();
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  function deliver(key: string, slot: SlotState) {
    if (slot.pendingValue === null) return;
    const args = slot.pendingValue as TArgs;
    slot.pendingValue = null;
    slot.lastSentAt = now();
    fn(args);
  }

  function send(key: string, args: TArgs): void {
    let slot = slots.get(key);
    if (!slot) {
      slot = { lastSentAt: 0, pendingValue: null, timerId: null };
      slots.set(key, slot);
    }
    const elapsed = now() - slot.lastSentAt;
    if (elapsed >= minIntervalMs && slot.timerId === null) {
      // Leading-Edge: sofort senden
      slot.lastSentAt = now();
      fn(args);
      return;
    }
    // Trailing-Coalesce: letzten Wert merken, Timer scheduler
    slot.pendingValue = args as unknown[];
    if (slot.timerId === null) {
      const wait = Math.max(0, minIntervalMs - elapsed);
      slot.timerId = setTimeout(() => {
        if (slot) {
          slot.timerId = null;
          deliver(key, slot);
        }
      }, wait);
    }
  }

  function flush(key?: string): void {
    if (key !== undefined) {
      const slot = slots.get(key);
      if (!slot) return;
      if (slot.timerId !== null) {
        clearTimeout(slot.timerId);
        slot.timerId = null;
      }
      deliver(key, slot);
      return;
    }
    for (const [k, s] of slots) {
      if (s.timerId !== null) {
        clearTimeout(s.timerId);
        s.timerId = null;
      }
      deliver(k, s);
    }
  }

  function cancel(key?: string): void {
    if (key !== undefined) {
      const slot = slots.get(key);
      if (!slot) return;
      if (slot.timerId !== null) {
        clearTimeout(slot.timerId);
        slot.timerId = null;
      }
      slot.pendingValue = null;
      slot.lastSentAt = 0;
      return;
    }
    for (const s of slots.values()) {
      if (s.timerId !== null) {
        clearTimeout(s.timerId);
        s.timerId = null;
      }
      s.pendingValue = null;
      s.lastSentAt = 0;
    }
  }

  return { send, flush, cancel };
}

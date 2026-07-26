/**
 * Synthstudio — useKorgRemoteStore (v3.269.0)
 *
 * Zustand + Persistenz der Korg-Remote-Regeln: „Controller-CC X steuert
 * Parameter Y von Part Z auf der Electribe".
 *
 * Die Übersetzung selbst liegt rein in `utils/korg/korgRemote.ts`, das Senden
 * in `audio/KorgRemoteSender.ts`.
 *
 * Persistenz: localStorage — Hardware-Setup, keine Projekteigenschaft.
 * Pattern: Modul-Singleton + Hook, analog `useE2sPatternSyncStore`.
 */
import { useEffect, useReducer } from "react";
import {
  makeKorgRemoteRule,
  type KorgRemoteRule,
} from "../utils/korg/korgRemote";
import { clampChannel0 } from "../utils/korg/e2ControlChange";

const STORAGE_KEY = "synthstudio:korg-remote:v1";

export interface KorgRemoteState {
  /** Master-Schalter. Aus = es geht garantiert nichts ans Gerät. */
  enabled: boolean;
  /** Global-Channel des Geräts (0..15) — nur für Master-FX-Parameter. */
  globalChannel: number;
  rules: KorgRemoteRule[];
  /**
   * Learn-Modus: das nächste eingehende CC wird an dieses Ziel gebunden.
   * `null` = kein Learn aktiv.
   */
  learnTarget: { part: number; param: string } | null;
}

function defaultState(): KorgRemoteState {
  return { enabled: false, globalChannel: 0, rules: [], learnTarget: null };
}

function loadState(): KorgRemoteState {
  if (typeof localStorage === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<KorgRemoteState> | null;
    if (!parsed || typeof parsed !== "object") return defaultState();
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules
          .filter((r): r is KorgRemoteRule => !!r && typeof r === "object" && typeof r.id === "string")
          .map((r) => makeKorgRemoteRule(r))
      : [];
    return {
      enabled: parsed.enabled === true,
      globalChannel: typeof parsed.globalChannel === "number" ? clampChannel0(parsed.globalChannel) : 0,
      rules,
      // Learn ist flüchtig: ein beim Beenden offener Learn-Modus darf nach dem
      // Neustart nicht heimlich den ersten Regler kapern.
      learnTarget: null,
    };
  } catch {
    return defaultState();
  }
}

function persist(state: KorgRemoteState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, learnTarget: null }),
    );
  } catch {
    // Quota / Privacy-Mode — bewusst still.
  }
}

let _state: KorgRemoteState = loadState();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((fn) => fn());
}

function commit(next: KorgRemoteState): void {
  _state = next;
  persist(_state);
  notify();
}

// ─── Getter / Setter ────────────────────────────────────────────────────────

export function getKorgRemoteState(): KorgRemoteState {
  return _state;
}

export function setKorgRemoteEnabled(enabled: boolean): void {
  if (_state.enabled === enabled) return;
  commit({ ..._state, enabled });
}

export function setKorgRemoteGlobalChannel(channel: number): void {
  const clamped = clampChannel0(channel);
  if (_state.globalChannel === clamped) return;
  commit({ ..._state, globalChannel: clamped });
}

export function addKorgRemoteRule(init: Partial<KorgRemoteRule> = {}): KorgRemoteRule {
  const rule = makeKorgRemoteRule({ ...init, id: init.id ?? nextRuleId() });
  commit({ ..._state, rules: [..._state.rules, rule] });
  return rule;
}

export function addKorgRemoteRules(rules: readonly KorgRemoteRule[]): void {
  if (rules.length === 0) return;
  commit({ ..._state, rules: [..._state.rules, ...rules.map((r) => makeKorgRemoteRule(r))] });
}

export function updateKorgRemoteRule(id: string, patch: Partial<KorgRemoteRule>): void {
  const rules = _state.rules.map((r) =>
    r.id === id ? makeKorgRemoteRule({ ...r, ...patch, id: r.id }) : r,
  );
  commit({ ..._state, rules });
}

export function removeKorgRemoteRule(id: string): void {
  const rules = _state.rules.filter((r) => r.id !== id);
  if (rules.length === _state.rules.length) return;
  commit({ ..._state, rules });
}

export function clearKorgRemoteRules(): void {
  if (_state.rules.length === 0) return;
  commit({ ..._state, rules: [] });
}

/** Startet Learn für ein Ziel. Erneuter Aufruf mit demselben Ziel bricht ab. */
export function startKorgRemoteLearn(part: number, param: string): void {
  const cur = _state.learnTarget;
  if (cur && cur.part === part && cur.param === param) {
    commit({ ..._state, learnTarget: null });
    return;
  }
  commit({ ..._state, learnTarget: { part, param } });
}

export function cancelKorgRemoteLearn(): void {
  if (!_state.learnTarget) return;
  commit({ ..._state, learnTarget: null });
}

/**
 * Schließt einen laufenden Learn mit dem gerade bewegten Regler ab.
 *
 * Eine bereits bestehende Regel für dasselbe **Ziel** wird ersetzt statt
 * ergänzt — sonst würde ein zweiter Learn-Versuch am selben Parameter zwei
 * Regler auf denselben Parameter legen, was sich wie ein Wackelkontakt anfühlt.
 *
 * @returns die entstandene Regel, oder `null` wenn kein Learn aktiv war.
 */
export function completeKorgRemoteLearn(cc: number, channel: number): KorgRemoteRule | null {
  const target = _state.learnTarget;
  if (!target) return null;
  const rule = makeKorgRemoteRule({
    id: nextRuleId(),
    srcCc: cc,
    srcChannel: channel,
    part: target.part,
    param: target.param,
  });
  const rules = _state.rules.filter(
    (r) => !(r.part === target.part && r.param === target.param),
  );
  commit({ ..._state, rules: [...rules, rule], learnTarget: null });
  return rule;
}

let _ruleCounter = 0;
function nextRuleId(): string {
  _ruleCounter += 1;
  return `kr-${Date.now().toString(36)}-${_ruleCounter}`;
}

/**
 * Test-only: Zustand neu aus localStorage lesen. Nur so ist der Parse-Pfad
 * (inkl. kaputter Inhalte) prüfbar — beim Modul-Import läuft er genau einmal.
 */
export function __reloadKorgRemoteForTests(): void {
  _state = loadState();
  notify();
}

/** Test-only Reset. */
export function __resetKorgRemoteForTests(): void {
  _state = defaultState();
  _ruleCounter = 0;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  notify();
}

// ─── React Hook ─────────────────────────────────────────────────────────────

export interface KorgRemoteStoreApi extends KorgRemoteState {
  setEnabled: (v: boolean) => void;
  setGlobalChannel: (v: number) => void;
  addRule: (init?: Partial<KorgRemoteRule>) => KorgRemoteRule;
  addRules: (rules: readonly KorgRemoteRule[]) => void;
  updateRule: (id: string, patch: Partial<KorgRemoteRule>) => void;
  removeRule: (id: string) => void;
  clearRules: () => void;
  startLearn: (part: number, param: string) => void;
  cancelLearn: () => void;
}

export function useKorgRemoteStore(): KorgRemoteStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return {
    ..._state,
    setEnabled: setKorgRemoteEnabled,
    setGlobalChannel: setKorgRemoteGlobalChannel,
    addRule: addKorgRemoteRule,
    addRules: addKorgRemoteRules,
    updateRule: updateKorgRemoteRule,
    removeRule: removeKorgRemoteRule,
    clearRules: clearKorgRemoteRules,
    startLearn: startKorgRemoteLearn,
    cancelLearn: cancelKorgRemoteLearn,
  };
}

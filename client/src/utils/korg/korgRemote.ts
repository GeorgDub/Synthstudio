/**
 * Synthstudio — Korg-Remote-Regelwerk (v3.269.0)
 *
 * Reine Übersetzungslogik „eingehendes Controller-CC → ausgehendes
 * Electribe-CC". Kein Web-MIDI, keine Persistenz — beides liegt woanders
 * (`audio/KorgRemoteSender.ts`, `store/useKorgRemoteStore.ts`).
 *
 * Eine Regel bindet **ein** Controller-CC an **einen** Geräteparameter eines
 * Parts. Mehrere Regeln dürfen dasselbe Quell-CC benutzen: ein Fader kann so
 * denselben Wert an mehrere Parts schicken (Gruppen-Level) oder gleichzeitig
 * Cutoff und Resonance fahren.
 */
import {
  buildE2CcMessage,
  clampMidi7,
  clampPart,
  findE2CcParam,
  scaleMidiToRange,
  type E2ParamDef,
} from "./e2ControlChange";

export interface KorgRemoteRule {
  /** Stabile ID für Listen-Updates. */
  id: string;
  /** Regel aktiv? Erlaubt Ausschalten ohne Löschen. */
  enabled: boolean;
  /** Quell-CC vom Controller, 0..127. */
  srcCc: number;
  /** Quell-Kanal 1..16, oder `0` für „egal" (Omni). */
  srcChannel: number;
  /** Ziel-Part 1..16. Bei globalen Parametern ohne Wirkung. */
  part: number;
  /** Schlüssel aus `E2_CC_PARAMS`. */
  param: string;
  /** Unteres Ende des Zielbereichs, 0..127. */
  min: number;
  /** Oberes Ende. Darf kleiner als `min` sein → invertiert. */
  max: number;
}

/** Eine sendebereite Nachricht samt auslösender Regel (fürs UI-Feedback). */
export interface KorgRemoteMessage {
  rule: KorgRemoteRule;
  param: E2ParamDef;
  bytes: [number, number, number];
  /** Der bereits skalierte Zielwert — praktisch für Anzeige und Tests. */
  value: number;
}

/** Eingehendes Control-Change vom Controller. */
export interface IncomingCc {
  /** CC-Nummer 0..127. */
  cc: number;
  /** MIDI-Kanal **1..16** (wie ihn `useMidi` liefert, nicht 0-basiert). */
  channel: number;
  /** CC-Wert 0..127. */
  value: number;
}

/**
 * Passt die Regel auf dieses CC?
 *
 * `srcChannel === 0` heißt Omni. Das ist der sinnvolle Default: die meisten
 * Controller senden auf Kanal 1, aber manche lassen sich pro Bank umstellen,
 * und dann soll die Regel nicht stillschweigend aufhören zu greifen.
 */
export function ruleMatchesCc(rule: KorgRemoteRule, msg: IncomingCc): boolean {
  if (!rule.enabled) return false;
  if (clampMidi7(rule.srcCc) !== clampMidi7(msg.cc)) return false;
  if (rule.srcChannel === 0) return true;
  return rule.srcChannel === msg.channel;
}

/**
 * Übersetzt ein eingehendes CC in alle daraus folgenden Geräte-Nachrichten.
 *
 * Regeln mit unbekanntem `param` werden übersprungen statt zu werfen — eine
 * aus einer neueren Version importierte Regel darf den Live-Betrieb nicht
 * abbrechen.
 *
 * @param globalChannel 0..15, Global-Channel des Geräts (für Master-FX).
 */
export function buildKorgRemoteMessages(
  rules: readonly KorgRemoteRule[],
  msg: IncomingCc,
  globalChannel = 0,
): KorgRemoteMessage[] {
  const out: KorgRemoteMessage[] = [];
  for (const rule of rules) {
    if (!ruleMatchesCc(rule, msg)) continue;
    const param = findE2CcParam(rule.param);
    if (!param) continue;
    const value = scaleMidiToRange(msg.value, rule.min, rule.max);
    out.push({
      rule,
      param,
      value,
      bytes: buildE2CcMessage(param, rule.part, value, globalChannel),
    });
  }
  return out;
}

/** Erzeugt eine Regel mit vernünftigen Vorgaben (voller Wertebereich, Omni). */
export function makeKorgRemoteRule(
  init: Partial<KorgRemoteRule> & Pick<KorgRemoteRule, "id">,
): KorgRemoteRule {
  return {
    id: init.id,
    enabled: init.enabled !== false,
    srcCc: clampMidi7(init.srcCc ?? 0),
    srcChannel:
      typeof init.srcChannel === "number" && init.srcChannel >= 1 && init.srcChannel <= 16
        ? Math.round(init.srcChannel)
        : 0,
    part: clampPart(init.part ?? 1),
    param: typeof init.param === "string" && findE2CcParam(init.param) ? init.param : "ampLevel",
    min: clampMidi7(init.min ?? 0),
    max: clampMidi7(init.max ?? 127),
  };
}

/**
 * Erzeugt einen kompletten Fader-Satz: ein CC pro Part, aufsteigend.
 *
 * Zugeschnitten auf den AKAI MIDImix, dessen 8 Kanal-Fader auf CC 19, 23, 27,
 * 31, 49, 53, 57, 61 liegen — deshalb nimmt die Funktion die CC-Liste entgegen
 * statt sie zu berechnen. Für andere Controller einfach eine andere Liste.
 */
export function buildRuleBank(
  ccNumbers: readonly number[],
  param: string,
  opts: { startPart?: number; srcChannel?: number; idPrefix?: string } = {},
): KorgRemoteRule[] {
  const startPart = clampPart(opts.startPart ?? 1);
  const prefix = opts.idPrefix ?? "bank";
  return ccNumbers.map((cc, i) =>
    makeKorgRemoteRule({
      id: `${prefix}-${param}-${i}`,
      srcCc: cc,
      srcChannel: opts.srcChannel ?? 0,
      part: startPart + i,
      param,
    }),
  );
}

/** Die 8 Kanal-Fader des AKAI MIDImix (Werkseinstellung). */
export const MIDIMIX_FADER_CCS: readonly number[] = [19, 23, 27, 31, 49, 53, 57, 61] as const;

/** Die 8 obersten Encoder-Reihen des AKAI MIDImix (Werkseinstellung). */
export const MIDIMIX_KNOB_ROW1_CCS: readonly number[] = [16, 20, 24, 28, 46, 50, 54, 58] as const;

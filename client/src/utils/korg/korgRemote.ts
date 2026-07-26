/**
 * Synthstudio — Korg-Remote-Regelwerk (v3.270.0)
 *
 * Reine Übersetzungslogik „eingehendes Controller-CC → ausgehende
 * Gerätenachrichten". Kein Web-MIDI, keine Persistenz — beides liegt woanders
 * (`audio/KorgRemoteSender.ts`, `store/useKorgRemoteStore.ts`).
 *
 * Eine Regel bindet **ein** Controller-CC an **ein** Ziel auf dem Gerät.
 * Mehrere Regeln dürfen dasselbe Quell-CC benutzen: ein Fader kann so denselben
 * Wert an mehrere Parts schicken (Gruppen-Level) oder gleichzeitig Cutoff und
 * Resonance fahren.
 *
 * Zwei Klassen von Zielen:
 *
 *   - **`cc`** — Stock-Control-Change auf dem Part-Kanal. Funktioniert auf
 *     jedem Gerät, auch ohne Hacktribe.
 *   - **NRPN** (`panel`, `fxParam`, `globalParam`, `seqParam`) — die
 *     schreibende Hacktribe-Schicht: einzelne FX-Parameter, das Bedienfeld
 *     selbst und Motion-Sequence-Steps. **Setzt Hacktribe-Firmware voraus**;
 *     ein Stock-Gerät ignoriert diese Nachrichten.
 */
import {
  buildE2CcMessage,
  clampMidi7,
  clampPart,
  findE2CcParam,
  scaleMidiToRange,
} from "./e2ControlChange";
import {
  MFX_SLOT,
  PANEL_MODE,
  buildGlobalParam,
  buildPanelControl,
  buildSequenceParam,
  buildSetFxParam,
  fxSlotForPart,
  labelForPanelMode,
  type MidiTriple,
  type PanelMode,
} from "./hacktribeNrpn";

/** Ein Insert-FX-Slot eines Parts, oder das Master-FX. */
export type FxSlotRef = 0 | 1 | "mfx";

/** Wohin eine Regel schreibt. */
export type KorgRemoteTarget =
  /** Stock-CC auf dem Part-Kanal — funktioniert ohne Hacktribe. */
  | { kind: "cc"; part: number; param: string }
  /** Bedienfeld des Geräts: Mute/Solo/Trigger/… pro Pad. Hacktribe. */
  | { kind: "panel"; mode: PanelMode; padIndex: number }
  /** Einzelner Parameter eines FX-Slots. Hacktribe. */
  | { kind: "fxParam"; part: number; slot: FxSlotRef; paramIndex: number }
  /** Global-Parameter des Geräts. Hacktribe. */
  | { kind: "globalParam"; paramIndex: number }
  /** Parameter eines einzelnen Sequencer-Steps (Motion). Hacktribe. */
  | { kind: "seqParam"; stepIndex: number; paramIndex: number };

/** Die Ziel-Arten in stabiler UI-Reihenfolge (harmlos → mächtig). */
export const KORG_TARGET_KINDS: readonly KorgRemoteTarget["kind"][] = [
  "cc",
  "panel",
  "fxParam",
  "globalParam",
  "seqParam",
] as const;

/** Braucht dieses Ziel Hacktribe-Firmware? */
export function targetNeedsHacktribe(kind: KorgRemoteTarget["kind"]): boolean {
  return kind !== "cc";
}

/** Kurzes Label für die Ziel-Art. */
export function labelForTargetKind(kind: KorgRemoteTarget["kind"]): string {
  switch (kind) {
    case "cc": return "Klang (CC)";
    case "panel": return "Panel";
    case "fxParam": return "FX-Parameter";
    case "globalParam": return "Global";
    case "seqParam": return "Step / Motion";
  }
}

export interface KorgRemoteRule {
  /** Stabile ID für Listen-Updates. */
  id: string;
  /** Regel aktiv? Erlaubt Ausschalten ohne Löschen. */
  enabled: boolean;
  /** Quell-CC vom Controller, 0..127. */
  srcCc: number;
  /** Quell-Kanal 1..16, oder `0` für „egal" (Omni). */
  srcChannel: number;
  /** Was auf dem Gerät geschrieben wird. */
  target: KorgRemoteTarget;
  /** Unteres Ende des Zielbereichs, 0..127. */
  min: number;
  /** Oberes Ende. Darf kleiner als `min` sein → invertiert. */
  max: number;
}

/** Eine sendebereite Regel-Auslösung. */
export interface KorgRemoteMessage {
  rule: KorgRemoteRule;
  /**
   * Alle CC-Nachrichten dieser Auslösung, **in Sendereihenfolge**. Bei einem
   * `cc`-Ziel genau eine, bei NRPN-Zielen vier (MSB/LSB/DATA-MSB/DATA-LSB).
   */
  messages: MidiTriple[];
  /** Der bereits skalierte Zielwert — für Anzeige und Tests. */
  value: number;
  /** Menschenlesbare Beschreibung des Ziels. */
  label: string;
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

/** Menschenlesbare Beschreibung eines Ziels, z. B. „Part 3 · Cutoff (CC 74)". */
export function describeKorgRemoteTarget(target: KorgRemoteTarget): string {
  switch (target.kind) {
    case "cc": {
      const p = findE2CcParam(target.param);
      if (!p) return `Part ${target.part} · ${target.param}`;
      return p.scope === "global"
        ? `Global · ${p.label} (CC ${p.cc})`
        : `Part ${clampPart(target.part)} · ${p.label} (CC ${p.cc})`;
    }
    case "panel":
      return `Panel · ${labelForPanelMode(target.mode)} Pad ${target.padIndex}`;
    case "fxParam": {
      const where = target.slot === "mfx" ? "MFX" : `Part ${clampPart(target.part)} IFX ${target.slot + 1}`;
      return `${where} · Param ${target.paramIndex}`;
    }
    case "globalParam":
      return `Global-Param ${target.paramIndex}`;
    case "seqParam":
      return `Step ${target.stepIndex} · Param ${target.paramIndex}`;
  }
}

/**
 * Zeigen zwei Ziele auf dieselbe Stelle im Gerät?
 *
 * Wird gebraucht, damit ein zweiter Learn-Versuch am selben Ziel die alte Regel
 * **ersetzt** statt einen zweiten Regler danebenzulegen — zwei Regler auf einem
 * Parameter fühlen sich im Betrieb wie ein Wackelkontakt an.
 */
export function korgTargetsEqual(a: KorgRemoteTarget, b: KorgRemoteTarget): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "cc":
      return a.part === (b as typeof a).part && a.param === (b as typeof a).param;
    case "panel":
      return a.mode === (b as typeof a).mode && a.padIndex === (b as typeof a).padIndex;
    case "fxParam":
      return (
        a.part === (b as typeof a).part &&
        a.slot === (b as typeof a).slot &&
        a.paramIndex === (b as typeof a).paramIndex
      );
    case "globalParam":
      return a.paramIndex === (b as typeof a).paramIndex;
    case "seqParam":
      return (
        a.stepIndex === (b as typeof a).stepIndex &&
        a.paramIndex === (b as typeof a).paramIndex
      );
  }
}

/**
 * Baut die Nachrichten für ein Ziel.
 *
 * @param globalChannel 0..15. Trägt zwei Rollen: Zielkanal für globale
 *   CC-Parameter (Master-FX) **und** Kanal für sämtliche NRPN-Nachrichten. Die
 *   NRPN-Schicht adressiert den Part über den Slot-Index im Nachrichtenrumpf,
 *   nicht über den Kanal — deshalb geht alles davon über einen Kanal.
 */
function buildMessagesForTarget(
  target: KorgRemoteTarget,
  value: number,
  globalChannel: number,
): MidiTriple[] | null {
  switch (target.kind) {
    case "cc": {
      const param = findE2CcParam(target.param);
      if (!param) return null;
      return [buildE2CcMessage(param, target.part, value, globalChannel)];
    }
    case "panel":
      return buildPanelControl(globalChannel, target.mode, target.padIndex, value);
    case "fxParam": {
      const slot =
        target.slot === "mfx" ? MFX_SLOT : fxSlotForPart(target.part, target.slot);
      return buildSetFxParam(globalChannel, slot, target.paramIndex, value);
    }
    case "globalParam":
      return buildGlobalParam(globalChannel, target.paramIndex, value);
    case "seqParam":
      return buildSequenceParam(globalChannel, target.stepIndex, target.paramIndex, value);
  }
}

/**
 * Übersetzt ein eingehendes CC in alle daraus folgenden Gerätenachrichten.
 *
 * Regeln mit unbekanntem Ziel werden übersprungen statt zu werfen — eine aus
 * einer neueren Version importierte Regel darf den Live-Betrieb nicht
 * abbrechen.
 */
export function buildKorgRemoteMessages(
  rules: readonly KorgRemoteRule[],
  msg: IncomingCc,
  globalChannel = 0,
): KorgRemoteMessage[] {
  const out: KorgRemoteMessage[] = [];
  for (const rule of rules) {
    if (!ruleMatchesCc(rule, msg)) continue;
    const value = scaleMidiToRange(msg.value, rule.min, rule.max);
    const messages = buildMessagesForTarget(rule.target, value, globalChannel);
    if (!messages) continue;
    out.push({ rule, messages, value, label: describeKorgRemoteTarget(rule.target) });
  }
  return out;
}

// ─── Normalisierung ─────────────────────────────────────────────────────────

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Bringt ein beliebiges Objekt in ein gültiges Ziel.
 *
 * Nimmt auch das **alte Regelformat** (`{part, param}` direkt auf der Regel,
 * vor der NRPN-Erweiterung) entgegen und hebt es auf ein `cc`-Ziel — sonst
 * verlöre jeder, der bereits Regeln angelegt hat, sie beim Update.
 */
export function normalizeTarget(raw: unknown): KorgRemoteTarget {
  const fallback: KorgRemoteTarget = { kind: "cc", part: 1, param: "ampLevel" };
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;

  // Altformat: keine `kind`-Angabe, aber `param` vorhanden.
  const kind = typeof o.kind === "string" ? o.kind : "cc";

  switch (kind) {
    case "panel": {
      const mode = typeof o.mode === "string" && o.mode in PANEL_MODE ? (o.mode as PanelMode) : "mute";
      return { kind: "panel", mode, padIndex: clampInt(o.padIndex, 0, 127, 0) };
    }
    case "fxParam": {
      const slot: FxSlotRef = o.slot === "mfx" ? "mfx" : o.slot === 1 ? 1 : 0;
      return {
        kind: "fxParam",
        part: clampPart(typeof o.part === "number" ? o.part : 1),
        slot,
        paramIndex: clampInt(o.paramIndex, 0, 127, 0),
      };
    }
    case "globalParam":
      return { kind: "globalParam", paramIndex: clampInt(o.paramIndex, 0, 0x3fff, 0) };
    case "seqParam":
      return {
        kind: "seqParam",
        stepIndex: clampInt(o.stepIndex, 0, 127, 0),
        paramIndex: clampInt(o.paramIndex, 0, 127, 0),
      };
    case "cc":
    default: {
      const param =
        typeof o.param === "string" && findE2CcParam(o.param) ? o.param : "ampLevel";
      return { kind: "cc", part: clampPart(typeof o.part === "number" ? o.part : 1), param };
    }
  }
}

/**
 * Eingabe für {@link makeKorgRemoteRule}.
 *
 * `part`/`param` sind das **Altformat** von vor der NRPN-Erweiterung, als eine
 * Regel nur CC-Ziele kannte. Sie stehen hier ausschließlich, damit persistierte
 * Regeln die Aktualisierung überleben — für neue Regeln `target` benutzen.
 */
export type KorgRemoteRuleInit = Partial<KorgRemoteRule> &
  Pick<KorgRemoteRule, "id"> & { part?: number; param?: string };

/** Erzeugt eine Regel mit vernünftigen Vorgaben (voller Wertebereich, Omni). */
export function makeKorgRemoteRule(init: KorgRemoteRuleInit): KorgRemoteRule {
  // Altformat-Migration: `part`/`param` lagen früher direkt auf der Regel.
  // Es genügt EINES der beiden Felder — eine halb beschriebene Altregel darf
  // nicht stillschweigend auf Part 1 zurückfallen, das wäre eine falsche Regel
  // statt einer erkennbar kaputten.
  const hasLegacy = typeof init.param === "string" || typeof init.part === "number";
  const rawTarget =
    init.target ?? (hasLegacy ? { kind: "cc", part: init.part, param: init.param } : undefined);

  return {
    id: init.id,
    enabled: init.enabled !== false,
    srcCc: clampMidi7(init.srcCc ?? 0),
    srcChannel:
      typeof init.srcChannel === "number" && init.srcChannel >= 1 && init.srcChannel <= 16
        ? Math.round(init.srcChannel)
        : 0,
    target: normalizeTarget(rawTarget),
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
      target: { kind: "cc", part: startPart + i, param },
    }),
  );
}

/**
 * Erzeugt einen Satz Panel-Regeln: ein CC pro Pad, aufsteigend.
 *
 * Für Taster gedacht (MIDImix Mute/Rec-Arm-Reihe). Der Wertebereich wird auf
 * 0..1 begrenzt, weil Panel-Schalter genau das erwarten — ein durchlaufender
 * Fader würde sonst je nach Stellung wilde Werte schicken.
 */
export function buildPanelBank(
  ccNumbers: readonly number[],
  mode: PanelMode,
  opts: { startPad?: number; srcChannel?: number; idPrefix?: string } = {},
): KorgRemoteRule[] {
  const startPad = Math.max(0, Math.round(opts.startPad ?? 0));
  const prefix = opts.idPrefix ?? "panel";
  return ccNumbers.map((cc, i) =>
    makeKorgRemoteRule({
      id: `${prefix}-${mode}-${i}`,
      srcCc: cc,
      srcChannel: opts.srcChannel ?? 0,
      target: { kind: "panel", mode, padIndex: startPad + i },
      min: 0,
      max: 1,
    }),
  );
}

/** Die 8 Kanal-Fader des AKAI MIDImix (Werkseinstellung). */
export const MIDIMIX_FADER_CCS: readonly number[] = [19, 23, 27, 31, 49, 53, 57, 61] as const;

/** Die obere Encoder-Reihe des AKAI MIDImix (Werkseinstellung). */
export const MIDIMIX_KNOB_ROW1_CCS: readonly number[] = [16, 20, 24, 28, 46, 50, 54, 58] as const;

/** Die mittlere Encoder-Reihe des AKAI MIDImix (Werkseinstellung). */
export const MIDIMIX_KNOB_ROW2_CCS: readonly number[] = [17, 21, 25, 29, 47, 51, 55, 59] as const;

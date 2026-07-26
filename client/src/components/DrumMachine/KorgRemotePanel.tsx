/**
 * Synthstudio — KorgRemotePanel (v3.270.0)
 *
 * Bedienoberfläche für die Fernsteuerung der echten Electribe 2:
 * Controller → Synthstudio → Korg.
 *
 * Zwei Klassen von Zielen, im selben Regelwerk:
 *
 *   - **Klang (CC)** — Stock-Control-Change auf dem Part-Kanal. Läuft auf jedem
 *     Gerät, auch ohne Hacktribe.
 *   - **Panel / FX-Parameter / Global / Step** — Hacktribes NRPN-Schicht. Damit
 *     lassen sich das Bedienfeld selbst, einzelne FX-Parameter und sogar
 *     Motion-Sequence-Steps von außen schreiben. Ein Stock-Gerät ignoriert das.
 *
 * Regeln liegen in `useKorgRemoteStore`, die Übersetzung in
 * `utils/korg/korgRemote.ts` + `utils/korg/hacktribeNrpn.ts`, das Senden in
 * `audio/KorgRemoteSender.ts`.
 */
import { useState } from "react";
import { useKorgRemoteStore } from "@/store/useKorgRemoteStore";
import { E2_CC_PARAMS, E2_PART_COUNT } from "@/utils/korg/e2ControlChange";
import { PANEL_MODE, labelForPanelMode, type PanelMode } from "@/utils/korg/hacktribeNrpn";
import {
  KORG_TARGET_KINDS,
  MIDIMIX_FADER_CCS,
  MIDIMIX_KNOB_ROW1_CCS,
  MIDIMIX_KNOB_ROW2_CCS,
  buildPanelBank,
  buildRuleBank,
  describeKorgRemoteTarget,
  labelForTargetKind,
  targetNeedsHacktribe,
  type FxSlotRef,
  type KorgRemoteRule,
  type KorgRemoteTarget,
} from "@/utils/korg/korgRemote";
import { toast } from "@/store/useToastStore";

const SELECT_CLASS =
  "bg-bg-base border border-border-color rounded px-1 py-0.5 text-[10px] text-text-primary";
const NUM_CLASS = `${SELECT_CLASS} w-14`;

/** Die 8 Mute-Taster des AKAI MIDImix (Werkseinstellung, Note-Modus aus). */
const MIDIMIX_MUTE_CCS = [1, 4, 7, 10, 13, 16, 19, 22] as const;

function partOptions() {
  return Array.from({ length: E2_PART_COUNT }, (_, i) => (
    <option key={i + 1} value={i + 1}>Part {i + 1}</option>
  ));
}

/**
 * Editor für ein Regel-Ziel. Wird sowohl in der Learn-Zeile als auch pro
 * Regel benutzt — die Feldsätze der fünf Ziel-Arten sollen sich an beiden
 * Stellen identisch verhalten.
 */
function TargetEditor({
  target,
  onChange,
  idPrefix,
}: {
  target: KorgRemoteTarget;
  onChange: (next: KorgRemoteTarget) => void;
  idPrefix: string;
}) {
  return (
    <>
      <select
        data-testid={`${idPrefix}-kind`}
        value={target.kind}
        onChange={(e) => {
          const kind = e.target.value as KorgRemoteTarget["kind"];
          // Beim Wechsel ein frisches, gültiges Ziel bauen statt Felder aus der
          // vorigen Art mitzuschleppen.
          switch (kind) {
            case "cc": return onChange({ kind: "cc", part: 1, param: "ampLevel" });
            case "panel": return onChange({ kind: "panel", mode: "mute", padIndex: 0 });
            case "fxParam": return onChange({ kind: "fxParam", part: 1, slot: 0, paramIndex: 0 });
            case "globalParam": return onChange({ kind: "globalParam", paramIndex: 0 });
            case "seqParam": return onChange({ kind: "seqParam", stepIndex: 0, paramIndex: 0 });
          }
        }}
        className={SELECT_CLASS}
        title="Art des Ziels. Alles außer „Klang (CC)“ braucht Hacktribe-Firmware."
      >
        {KORG_TARGET_KINDS.map((k) => (
          <option key={k} value={k}>
            {labelForTargetKind(k)}{targetNeedsHacktribe(k) ? " ⚡" : ""}
          </option>
        ))}
      </select>

      {target.kind === "cc" && (
        <>
          <select
            value={target.part}
            onChange={(e) => onChange({ ...target, part: Number(e.target.value) })}
            className={SELECT_CLASS}
          >
            {partOptions()}
          </select>
          <select
            data-testid={`${idPrefix}-cc-param`}
            value={target.param}
            onChange={(e) => onChange({ ...target, param: e.target.value })}
            className={SELECT_CLASS}
          >
            {E2_CC_PARAMS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}{p.scope === "global" ? " (global)" : ""}
              </option>
            ))}
          </select>
        </>
      )}

      {target.kind === "panel" && (
        <>
          <select
            data-testid={`${idPrefix}-panel-mode`}
            value={target.mode}
            onChange={(e) => onChange({ ...target, mode: e.target.value as PanelMode })}
            className={SELECT_CLASS}
            title="Welche Panel-Funktion des Geräts bedient wird"
          >
            {(Object.keys(PANEL_MODE) as PanelMode[]).map((m) => (
              <option key={m} value={m}>{labelForPanelMode(m)}</option>
            ))}
          </select>
          <label className="text-[10px] text-text-dim flex items-center gap-1">
            Pad
            <input
              type="number"
              min={0}
              max={127}
              value={target.padIndex}
              onChange={(e) => onChange({ ...target, padIndex: Number(e.target.value) })}
              className={NUM_CLASS}
              title="Pad-/Part-Nummer, wie das Gerät sie zählt — 0-basiert, Part 1 ist also Pad 0"
            />
          </label>
        </>
      )}

      {target.kind === "fxParam" && (
        <>
          <select
            value={target.slot === "mfx" ? "mfx" : String(target.slot)}
            onChange={(e) => {
              const v = e.target.value;
              const slot: FxSlotRef = v === "mfx" ? "mfx" : v === "1" ? 1 : 0;
              onChange({ ...target, slot });
            }}
            className={SELECT_CLASS}
            title="Insert-FX-Slot des Parts, oder das Master-FX"
          >
            <option value="0">IFX 1</option>
            <option value="1">IFX 2</option>
            <option value="mfx">MFX</option>
          </select>
          {target.slot !== "mfx" && (
            <select
              value={target.part}
              onChange={(e) => onChange({ ...target, part: Number(e.target.value) })}
              className={SELECT_CLASS}
            >
              {partOptions()}
            </select>
          )}
          <label className="text-[10px] text-text-dim flex items-center gap-1">
            Param#
            <input
              type="number"
              min={0}
              max={127}
              value={target.paramIndex}
              onChange={(e) => onChange({ ...target, paramIndex: Number(e.target.value) })}
              className={NUM_CLASS}
              title="Index im Parameter-Struct des GERADE GELADENEN FX-Device — bedeutet je nach eingestelltem Effekt etwas anderes"
            />
          </label>
        </>
      )}

      {target.kind === "globalParam" && (
        <label className="text-[10px] text-text-dim flex items-center gap-1">
          Param#
          <input
            type="number"
            min={0}
            max={16383}
            value={target.paramIndex}
            onChange={(e) => onChange({ ...target, paramIndex: Number(e.target.value) })}
            className={`${SELECT_CLASS} w-20`}
            title="14-bit Global-Parameter-Index"
          />
        </label>
      )}

      {target.kind === "seqParam" && (
        <>
          <label className="text-[10px] text-text-dim flex items-center gap-1">
            Step
            <input
              type="number"
              min={0}
              max={127}
              value={target.stepIndex}
              onChange={(e) => onChange({ ...target, stepIndex: Number(e.target.value) })}
              className={NUM_CLASS}
              title="0-basierter Step im aktiven Pattern"
            />
          </label>
          <label className="text-[10px] text-text-dim flex items-center gap-1">
            Param#
            <input
              type="number"
              min={0}
              max={127}
              value={target.paramIndex}
              onChange={(e) => onChange({ ...target, paramIndex: Number(e.target.value) })}
              className={NUM_CLASS}
            />
          </label>
        </>
      )}
    </>
  );
}

export function KorgRemotePanel({ onClose }: { onClose?: () => void }) {
  const remote = useKorgRemoteStore();
  const [learnTargetDraft, setLearnTargetDraft] = useState<KorgRemoteTarget>({
    kind: "cc",
    part: 1,
    param: "ampLevel",
  });

  const learning = remote.learnTarget;
  const usesNrpn = remote.rules.some((r) => targetNeedsHacktribe(r.target.kind));

  function addBank(rules: KorgRemoteRule[], label: string) {
    remote.addRules(rules);
    toast(`${rules.length} Regeln angelegt: ${label}`, { kind: "success" });
  }

  return (
    <div className="p-2 space-y-2 text-text-primary" data-testid="korg-remote-panel">
      {/* ── Kopfzeile ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          data-testid="korg-remote-enable"
          onClick={() => remote.setEnabled(!remote.enabled)}
          aria-pressed={remote.enabled}
          title={
            remote.enabled
              ? "Fernsteuerung aktiv — eingehende CCs werden an die Korg weitergereicht"
              : "Fernsteuerung aus — es geht garantiert nichts an das Gerät"
          }
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            remote.enabled
              ? "bg-accent-success/25 text-accent-success border border-accent-success/60"
              : "bg-bg-elevated text-text-dim hover:text-text-primary",
          ].join(" ")}
        >
          {remote.enabled ? "● Aktiv" : "○ Aus"}
        </button>

        <label className="text-[10px] text-text-muted flex items-center gap-1">
          Global-Channel
          <select
            data-testid="korg-remote-global-channel"
            value={remote.globalChannel}
            onChange={(e) => remote.setGlobalChannel(Number(e.target.value))}
            className={SELECT_CLASS}
            title="Global-Channel des Geräts. Zielkanal für Master-FX-CCs und für ALLE NRPN-Nachrichten — die adressieren den Part über den Slot-Index, nicht über den Kanal."
          >
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i} value={i}>{i + 1}</option>
            ))}
          </select>
        </label>

        <span className="text-[10px] text-text-dim">
          {remote.rules.length} Regel{remote.rules.length === 1 ? "" : "n"}
        </span>

        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary"
          >
            Schließen
          </button>
        )}
      </div>

      <p className="text-[10px] text-text-muted leading-snug">
        <strong>Klang (CC)</strong> adressiert Parts über den MIDI-Kanal (Part 1 → Kanal 1) und
        läuft auf jedem Gerät. Die mit <strong>⚡</strong> markierten Ziele nutzen Hacktribes
        NRPN-Schicht — Bedienfeld, einzelne FX-Parameter und Motion-Steps. Ein Stock-Gerät
        ignoriert sie stillschweigend.
      </p>

      {usesNrpn && (
        <p
          data-testid="korg-remote-hacktribe-hint"
          className="text-[10px] text-accent-secondary leading-snug border border-accent-secondary/40 rounded px-2 py-1"
        >
          ⚡ Es sind NRPN-Regeln aktiv. Das setzt <strong>Hacktribe-Firmware</strong> voraus.
          Geschrieben werden nur flüchtige Parameter — kein Flash, keine RAM-Adressen. Ein
          Fehlgriff kostet höchstens einen Power-Cycle.
        </p>
      )}

      {/* ── Schnellstart ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-text-dim">MIDImix:</span>
        <button
          data-testid="korg-remote-preset-faders"
          onClick={() =>
            addBank(
              buildRuleBank(MIDIMIX_FADER_CCS, "ampLevel", { idPrefix: `mm-lvl-${remote.rules.length}` }),
              "8 Fader → Level Part 1–8",
            )
          }
          title="Die 8 Kanal-Fader (Werks-CCs 19/23/27/31/49/53/57/61) auf Level von Part 1–8"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
        >
          8 Fader → Level 1–8
        </button>
        <button
          data-testid="korg-remote-preset-knobs"
          onClick={() =>
            addBank(
              buildRuleBank(MIDIMIX_KNOB_ROW1_CCS, "cutoff", { idPrefix: `mm-cut-${remote.rules.length}` }),
              "8 Regler → Cutoff Part 1–8",
            )
          }
          title="Obere Encoder-Reihe (Werks-CCs 16/20/24/28/46/50/54/58) auf Cutoff von Part 1–8"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
        >
          8 Regler → Cutoff 1–8
        </button>
        <button
          data-testid="korg-remote-preset-res"
          onClick={() =>
            addBank(
              buildRuleBank(MIDIMIX_KNOB_ROW2_CCS, "resonance", { idPrefix: `mm-res-${remote.rules.length}` }),
              "8 Regler → Resonance Part 1–8",
            )
          }
          title="Mittlere Encoder-Reihe (Werks-CCs 17/21/25/29/47/51/55/59) auf Resonance von Part 1–8"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
        >
          8 Regler → Reso 1–8
        </button>
        <button
          data-testid="korg-remote-preset-mutes"
          onClick={() =>
            addBank(
              buildPanelBank(MIDIMIX_MUTE_CCS, "mute", { idPrefix: `mm-mute-${remote.rules.length}` }),
              "8 Mute-Taster → Part-Mute am Gerät",
            )
          }
          title="Die 8 Mute-Taster auf Part-Mute am Gerät (Hacktribe-NRPN, Wertebereich 0/1)"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-accent-secondary transition-colors"
        >
          ⚡ 8 Taster → Mute 1–8
        </button>
        {remote.rules.length > 0 && (
          <button
            data-testid="korg-remote-clear"
            onClick={() => remote.clearRules()}
            className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-accent-danger transition-colors"
          >
            Alle löschen
          </button>
        )}
      </div>

      {/* ── Learn ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap bg-bg-base rounded border border-border-color px-2 py-1">
        <span className="text-[10px] text-text-dim">Lernen:</span>
        <TargetEditor
          target={learnTargetDraft}
          onChange={setLearnTargetDraft}
          idPrefix="korg-remote-learn"
        />
        <button
          data-testid="korg-remote-learn"
          onClick={() => remote.startLearn(learnTargetDraft)}
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            learning
              ? "bg-accent-danger/30 text-accent-danger border border-accent-danger/60 animate-pulse"
              : "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30",
          ].join(" ")}
          title="Klicken, dann am Controller den gewünschten Regler bewegen"
        >
          {learning ? "Regler bewegen… (Klick = Abbruch)" : "Learn"}
        </button>
        {learning && (
          <span className="text-[10px] text-text-muted">
            Ziel: {describeKorgRemoteTarget(learning)} — der bewegte Regler ersetzt eine
            vorhandene Regel für dasselbe Ziel.
          </span>
        )}
      </div>

      {/* ── Regelliste ─────────────────────────────────────────────────── */}
      {remote.rules.length === 0 ? (
        <p className="text-[10px] text-text-dim">
          Noch keine Regel. Schnellstart oben benutzen oder einzeln lernen.
        </p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {remote.rules.map((rule) => (
            <div
              key={rule.id}
              data-testid="korg-remote-rule"
              className="flex items-center gap-1 flex-wrap bg-bg-base rounded border border-border-color px-1.5 py-1"
            >
              <button
                onClick={() => remote.updateRule(rule.id, { enabled: !rule.enabled })}
                aria-pressed={rule.enabled}
                title={rule.enabled ? "Regel aktiv" : "Regel pausiert"}
                className={[
                  "px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors",
                  rule.enabled
                    ? "bg-accent-success/20 text-accent-success"
                    : "bg-bg-elevated text-text-dim",
                ].join(" ")}
              >
                {rule.enabled ? "●" : "○"}
              </button>

              <span className="text-[10px] text-text-muted font-mono w-14">CC {rule.srcCc}</span>
              <select
                value={rule.srcChannel}
                onChange={(e) => remote.updateRule(rule.id, { srcChannel: Number(e.target.value) })}
                className={SELECT_CLASS}
                title="Quell-Kanal des Controllers — „alle“ ist meist richtig"
              >
                <option value={0}>alle</option>
                {Array.from({ length: 16 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>Ch {i + 1}</option>
                ))}
              </select>

              <span className="text-[10px] text-text-dim">→</span>

              <TargetEditor
                target={rule.target}
                onChange={(target) => remote.updateRule(rule.id, { target })}
                idPrefix={`korg-remote-rule-${rule.id}`}
              />

              <label className="text-[10px] text-text-dim flex items-center gap-1">
                Bereich
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={rule.min}
                  onChange={(e) => remote.updateRule(rule.id, { min: Number(e.target.value) })}
                  className={`${SELECT_CLASS} w-12`}
                  title="Wert bei Regler ganz unten"
                />
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={rule.max}
                  onChange={(e) => remote.updateRule(rule.id, { max: Number(e.target.value) })}
                  className={`${SELECT_CLASS} w-12`}
                  title="Wert bei Regler ganz oben. Kleiner als der linke Wert kehrt die Richtung um."
                />
              </label>

              <button
                onClick={() => remote.removeRule(rule.id)}
                title="Regel löschen"
                className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-accent-danger transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default KorgRemotePanel;

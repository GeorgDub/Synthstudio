/**
 * Synthstudio — KorgRemotePanel (v3.269.0)
 *
 * Bedienoberfläche für die CC-Fernsteuerung der echten Electribe 2:
 * Controller → Synthstudio → Korg.
 *
 * Der Controller (z. B. AKAI MIDImix) muss nichts von der Korg wissen —
 * Synthstudio übersetzt sein CC in das Geräte-CC auf dem Part-Kanal. Damit
 * lassen sich Part-Level, Filter und FX der Korg von denselben Fadern fahren,
 * die sonst den Synthstudio-Mixer bedienen.
 *
 * Regeln liegen in `useKorgRemoteStore`, die Übersetzung in
 * `utils/korg/korgRemote.ts`, das Senden in `audio/KorgRemoteSender.ts`.
 */
import { useKorgRemoteStore } from "@/store/useKorgRemoteStore";
import {
  E2_CC_PARAMS,
  E2_PART_COUNT,
  findE2CcParam,
} from "@/utils/korg/e2ControlChange";
import {
  MIDIMIX_FADER_CCS,
  MIDIMIX_KNOB_ROW1_CCS,
  buildRuleBank,
} from "@/utils/korg/korgRemote";
import { toast } from "@/store/useToastStore";
import { useState } from "react";

const SELECT_CLASS =
  "bg-bg-base border border-border-color rounded px-1 py-0.5 text-[10px] text-text-primary";

export function KorgRemotePanel({ onClose }: { onClose?: () => void }) {
  const remote = useKorgRemoteStore();
  const [learnPart, setLearnPart] = useState(1);
  const [learnParam, setLearnParam] = useState("ampLevel");

  const learning = remote.learnTarget;
  const learnParamDef = findE2CcParam(learnParam);

  function addBank(ccs: readonly number[], param: string, label: string) {
    const rules = buildRuleBank(ccs, param, { idPrefix: `mm-${param}-${remote.rules.length}` });
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
            title="Global-Channel des Geräts — nur für Master-FX-Parameter (MFX X/Y, MFX On/Off). Part-Parameter gehen immer auf den Part-Kanal."
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
        Part = MIDI-Kanal auf dem Gerät (Part 1 → Kanal 1). Nur Klangparameter,
        kein Sysex — läuft auf Stock-Firmware genauso wie auf Hacktribe und
        schreibt nichts dauerhaft ins Gerät.
      </p>

      {/* ── Schnellstart ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-text-dim">MIDImix:</span>
        <button
          data-testid="korg-remote-preset-faders"
          onClick={() => addBank(MIDIMIX_FADER_CCS, "ampLevel", "8 Fader → Level Part 1–8")}
          title="Die 8 Kanal-Fader (Werks-CCs 19/23/27/31/49/53/57/61) auf Level von Part 1–8"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
        >
          8 Fader → Level 1–8
        </button>
        <button
          data-testid="korg-remote-preset-knobs"
          onClick={() => addBank(MIDIMIX_KNOB_ROW1_CCS, "cutoff", "8 Regler → Cutoff Part 1–8")}
          title="Die obere Encoder-Reihe (Werks-CCs 16/20/24/28/46/50/54/58) auf Cutoff von Part 1–8"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-text-primary transition-colors"
        >
          8 Regler → Cutoff 1–8
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
        <select
          data-testid="korg-remote-learn-part"
          value={learnPart}
          onChange={(e) => setLearnPart(Number(e.target.value))}
          className={SELECT_CLASS}
          disabled={learnParamDef?.scope === "global"}
          title={
            learnParamDef?.scope === "global"
              ? "Master-FX gilt global — kein Part auswählbar"
              : "Ziel-Part auf dem Gerät"
          }
        >
          {Array.from({ length: E2_PART_COUNT }, (_, i) => (
            <option key={i + 1} value={i + 1}>Part {i + 1}</option>
          ))}
        </select>
        <select
          data-testid="korg-remote-learn-param"
          value={learnParam}
          onChange={(e) => setLearnParam(e.target.value)}
          className={SELECT_CLASS}
        >
          {E2_CC_PARAMS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}{p.scope === "global" ? " (global)" : ""}
            </option>
          ))}
        </select>
        <button
          data-testid="korg-remote-learn"
          onClick={() => remote.startLearn(learnPart, learnParam)}
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
            Der bewegte Regler ersetzt eine vorhandene Regel für dasselbe Ziel.
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
          {remote.rules.map((rule) => {
            const param = findE2CcParam(rule.param);
            return (
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

                <span className="text-[10px] text-text-muted font-mono w-14">
                  CC {rule.srcCc}
                </span>
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

                <select
                  value={rule.part}
                  onChange={(e) => remote.updateRule(rule.id, { part: Number(e.target.value) })}
                  className={SELECT_CLASS}
                  disabled={param?.scope === "global"}
                >
                  {Array.from({ length: E2_PART_COUNT }, (_, i) => (
                    <option key={i + 1} value={i + 1}>Part {i + 1}</option>
                  ))}
                </select>
                <select
                  value={rule.param}
                  onChange={(e) => remote.updateRule(rule.id, { param: e.target.value })}
                  className={SELECT_CLASS}
                >
                  {E2_CC_PARAMS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>

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
            );
          })}
        </div>
      )}
    </div>
  );
}

export default KorgRemotePanel;

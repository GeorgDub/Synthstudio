/**
 * Synthstudio — MidiFilterBar (v3.269.0)
 *
 * Kompakter Chip-Cluster für die Sequencer-Toolbar: welche MIDI-Eingänge und
 * welche Nachrichtenklassen dürfen Synthstudio gerade erreichen?
 *
 * Bewusst direkt auf dem Home-Screen und nicht in den MIDI-Einstellungen: das
 * ist ein Live-Handgriff. Wer mitten im Set auf der Korg zu spielen anfängt,
 * will deren Rückkanal mit einem Klick zumachen — nicht durch drei Dialoge.
 *
 * Zustand liegt in `useMidiInputFilterStore`, die Entscheidungslogik in
 * `utils/midiInputFilter.ts`.
 */
import { useMidiContext } from "@/context/MidiContext";
import { useMidiInputFilterStore } from "@/store/useMidiInputFilterStore";
import {
  MIDI_MESSAGE_CLASSES,
  countBlockedClasses,
  describeMidiClass,
  isDeviceMuted,
  labelForMidiClass,
} from "@/utils/midiInputFilter";

/** Wie viele Gerätechips maximal inline stehen, bevor gekürzt wird. */
const MAX_INLINE_DEVICES = 4;

export function MidiFilterBar() {
  const midi = useMidiContext();
  const filter = useMidiInputFilterStore();

  const devices = midi?.devices ?? [];
  const blocked = countBlockedClasses(filter.classes);
  const mutedCount = devices.filter((d) => isDeviceMuted(filter, d.name)).length;
  const anythingFiltered = filter.masterMute || blocked > 0 || mutedCount > 0;

  return (
    <div
      data-testid="midi-filter-bar"
      className={[
        "flex items-center gap-1 rounded border px-1 py-0.5 bg-bg-base",
        anythingFiltered ? "border-accent-danger/60" : "border-border-color",
      ].join(" ")}
      title="MIDI-Eingangsfilter — steuert, was von außen bei Synthstudio ankommt"
    >
      {/* Not-Aus für den gesamten Eingang. */}
      <button
        data-testid="midi-filter-master"
        onClick={() => filter.setMasterMute(!filter.masterMute)}
        title={
          filter.masterMute
            ? "MIDI-Eingang ist KOMPLETT stumm — nichts von außen erreicht Synthstudio. Klick zum Öffnen."
            : "MIDI-Eingang offen. Klick schaltet allen Eingang stumm (Not-Aus)."
        }
        aria-pressed={filter.masterMute}
        className={[
          "px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors flex items-center gap-1",
          filter.masterMute
            ? "bg-accent-danger/30 text-accent-danger border border-accent-danger/60"
            : "bg-bg-elevated text-text-dim hover:text-text-primary",
        ].join(" ")}
      >
        <span aria-hidden="true">{filter.masterMute ? "🔇" : "🎛"}</span>
        <span>MIDI-In</span>
      </button>

      {/* Pro Gerät: der eigentliche Live-Handgriff („Korg zu"). */}
      {devices.slice(0, MAX_INLINE_DEVICES).map((dev) => {
        const muted = isDeviceMuted(filter, dev.name);
        return (
          <button
            key={dev.id}
            data-testid="midi-filter-device"
            data-device-name={dev.name}
            onClick={() => filter.toggleDeviceMute(dev.name)}
            aria-pressed={muted}
            title={
              muted
                ? `„${dev.name}" ist stumm — Synthstudio ignoriert dieses Gerät komplett. Klick zum Aktivieren.`
                : `„${dev.name}" kommt durch. Klick macht das Gerät stumm (auf der Hardware spielen, ohne dass Synthstudio mitzieht).`
            }
            className={[
              "px-1.5 py-0.5 rounded text-[10px] transition-colors max-w-[92px] truncate",
              muted
                ? "bg-accent-danger/25 text-accent-danger line-through"
                : "bg-bg-elevated text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {dev.name}
          </button>
        );
      })}
      {devices.length > MAX_INLINE_DEVICES && (
        <span
          className="text-[9px] text-text-dim"
          title={devices
            .slice(MAX_INLINE_DEVICES)
            .map((d) => d.name)
            .join(", ")}
        >
          +{devices.length - MAX_INLINE_DEVICES}
        </span>
      )}
      {devices.length === 0 && (
        <span className="text-[9px] text-text-dim px-1">kein Eingang</span>
      )}

      <div className="w-px h-4 bg-border-color mx-0.5" aria-hidden="true" />

      {/* Pro Nachrichtenklasse. */}
      {MIDI_MESSAGE_CLASSES.map((cls) => {
        const on = filter.classes[cls] !== false;
        return (
          <button
            key={cls}
            data-testid="midi-filter-class"
            data-class={cls}
            onClick={() => filter.toggleClass(cls)}
            aria-pressed={!on}
            title={`${describeMidiClass(cls)} — aktuell ${on ? "durchgelassen" : "blockiert"}. Klick zum Umschalten.`}
            className={[
              "px-1.5 py-0.5 rounded text-[10px] transition-colors",
              on
                ? "bg-bg-elevated text-text-muted hover:text-text-primary"
                : "bg-accent-danger/25 text-accent-danger line-through",
            ].join(" ")}
          >
            {labelForMidiClass(cls)}
          </button>
        );
      })}

      <div className="w-px h-4 bg-border-color mx-0.5" aria-hidden="true" />

      {/* Multi-Input: Voraussetzung dafür, dass Pro-Gerät-Mutes überhaupt
          etwas zu tun haben. */}
      <button
        data-testid="midi-filter-listen-all"
        onClick={() => filter.setListenAllInputs(!filter.listenAllInputs)}
        aria-pressed={filter.listenAllInputs}
        title={
          filter.listenAllInputs
            ? "Alle MIDI-Eingänge werden gehört (Korg + Controller gleichzeitig). Klick beschränkt auf das in den MIDI-Einstellungen gewählte Gerät."
            : "Nur das in den MIDI-Einstellungen gewählte Gerät wird gehört. Klick hört auf allen Eingängen — nötig für Korg + Controller parallel."
        }
        className={[
          "px-1.5 py-0.5 rounded text-[10px] transition-colors",
          filter.listenAllInputs
            ? "bg-accent-primary/20 text-accent-primary"
            : "bg-bg-elevated text-text-dim hover:text-text-primary",
        ].join(" ")}
      >
        {filter.listenAllInputs ? "Alle In" : "1 In"}
      </button>

      {anythingFiltered && (
        <button
          data-testid="midi-filter-reset"
          onClick={() => filter.reset()}
          title="Alle Filter aufheben — jedes Gerät und jede Nachrichtenklasse wieder durchlassen"
          className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated text-text-dim hover:text-accent-success transition-colors"
        >
          ↺
        </button>
      )}
    </div>
  );
}

export default MidiFilterBar;

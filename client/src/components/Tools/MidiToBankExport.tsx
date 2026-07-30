/**
 * MidiToBankExport.tsx — Tools-Panel: MIDI-Datei → Pattern-Slots einer echten
 * `.e2sallpat`-Bank, **mit Takt-Auswahl**.
 *
 * Zum bestehenden Weg: der Import in der DrumMachine (`midiParser.js`) rechnet
 * `step % stepCount` und faltet damit eine ganze Datei in einen Takt. Hier
 * bleibt die Position absolut — ein gewählter Takt-Bereich wird auf so viele
 * Patterns verteilt, wie er braucht.
 *
 * Dieselbe Zurückhaltung wie in `E2sBankExport`: der Container wird **nicht**
 * fabriziert. Du lädst eine echte Basis-Bank, wir überschreiben nur die
 * gewählten Slots; alles andere bleibt byte-exakt.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "@/store/useToastStore";
import { parseMidiFileDetailed, type DetailedMidiFile } from "@/utils/smfParser";
import {
  barCount,
  describeMidiToE2,
  midiToE2Patterns,
  type E2StepLength,
  type MidiPartMapping,
} from "@/utils/korg/midiToE2Pattern";
import { buildE2PatternBody } from "@/utils/e2sExport";
import {
  writePatternBodiesIntoAllpat,
  isFullAllpatContainer,
  allpatMinSizeFor,
  ALLPAT_PATTERN_COUNT,
  E2AllpatError,
} from "@/utils/korg/e2AllpatBuild";

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(
    new Blob([copy], { type: "application/octet-stream" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const STEP_LENGTHS: E2StepLength[] = [16, 32, 64];

export function MidiToBankExport() {
  const midiInputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);

  const [midi, setMidi] = useState<DetailedMidiFile | null>(null);
  const [midiName, setMidiName] = useState("");
  const [barFrom, setBarFrom] = useState(1);
  const [barTo, setBarTo] = useState(1);
  const [stepsPerPattern, setStepsPerPattern] = useState<E2StepLength>(16);
  const [mapping, setMapping] = useState<MidiPartMapping>("pitch");
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [startSlot, setStartSlot] = useState(0);
  const [busy, setBusy] = useState(false);

  const totalBars = midi ? barCount(midi) : 0;

  /**
   * Vorschau: dieselbe Rechnung wie beim Export, nur ohne Datei zu schreiben.
   * So sieht man vorher, wie viele Patterns entstehen und was wegfällt — statt
   * es hinterher am Gerät zu merken.
   */
  const preview = useMemo(() => {
    if (!midi) return null;
    return midiToE2Patterns(midi, {
      barFrom, barTo, stepsPerPattern, mapping,
      tracks: selectedTracks,
      namePrefix: midiName.replace(/\.midi?$/i, "").slice(0, 10) || "MIDI",
    });
  }, [midi, barFrom, barTo, stepsPerPattern, mapping, selectedTracks, midiName]);

  const onMidi = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const parsed = parseMidiFileDetailed(new Uint8Array(await f.arrayBuffer()));
      setMidi(parsed);
      setMidiName(f.name);
      const bars = barCount(parsed);
      setBarFrom(1);
      setBarTo(bars);
      // Alle Spuren mit Noten vorauswählen — die leeren wären nur Rauschen.
      setSelectedTracks(parsed.tracks.filter(t => t.noteCount > 0).map(t => t.index));
      toast(
        `${f.name}: ${bars} Takt(e), ${parsed.notes.length} Note(n), ` +
          `${parsed.tracks.length} Spur(en)` +
          (parsed.bpm ? ` · ${parsed.bpm} BPM` : ""),
        { kind: "success", duration: 5000 },
      );
    } catch (err) {
      toast(`MIDI-Datei nicht lesbar: ${err instanceof Error ? err.message : String(err)}`, {
        kind: "error", duration: 6000,
      });
    }
  }, []);

  const onBase = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f || !preview) return;
      setBusy(true);
      try {
        const base = new Uint8Array(await f.arrayBuffer());
        if (!isFullAllpatContainer(base)) {
          toast(
            `Basis-Bank zu klein (${base.length} B). Erwartet eine volle ` +
              `.e2sallpat (≥ ${allpatMinSizeFor(ALLPAT_PATTERN_COUNT - 1)} B).`,
            { kind: "error", duration: 5000 },
          );
          return;
        }
        const writes = preview.patterns
          .slice(0, ALLPAT_PATTERN_COUNT - startSlot)
          .map((p, i) => ({ index: startSlot + i, body: buildE2PatternBody(p) }));
        if (writes.length === 0) {
          toast("Keine Patterns zu schreiben.", { kind: "warning" });
          return;
        }
        const out = writePatternBodiesIntoAllpat(base, writes);
        const stamp = f.name.replace(/\.(e2sallpat|all)$/i, "");
        downloadBytes(out, `${stamp}-midi.e2sallpat`);
        toast(
          `${writes.length} Pattern(s) in Slots ${startSlot}–${startSlot + writes.length - 1} ` +
            `geschrieben. ${describeMidiToE2(preview.report)}`,
          { kind: "success", duration: 9000 },
        );
      } catch (err) {
        const msg = err instanceof E2AllpatError || err instanceof Error
          ? err.message : String(err);
        toast(`Export fehlgeschlagen: ${msg}`, { kind: "error", duration: 5000 });
      } finally {
        setBusy(false);
      }
    },
    [preview, startSlot],
  );

  function toggleTrack(index: number): void {
    setSelectedTracks(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index].sort((a, b) => a - b),
    );
  }

  const numberField =
    "w-16 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary";

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            🎼 MIDI → Bank (mit Takten)
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Übernimmt eine MIDI-Datei <b>taktweise</b> in eine bestehende
            Geräte-Bank. Anders als der Pattern-Import in der DrumMachine bleibt
            die Position erhalten: Takt 5 landet nicht auf Takt 1.
          </p>
        </div>

        <button
          data-testid="midi-bank-pick-midi"
          onClick={() => midiInputRef.current?.click()}
          className="flex items-center gap-1 text-xs px-3 py-2 rounded bg-bg-elevated text-text-primary hover:text-accent-primary transition-colors"
        >
          🎹 MIDI-Datei wählen…
        </button>
        <input
          ref={midiInputRef}
          type="file"
          accept=".mid,.midi"
          className="hidden"
          onChange={onMidi}
          data-testid="midi-bank-midi-input"
        />

        {midi && (
          <>
            <div className="text-xs text-text-muted space-y-1 pt-2 border-t border-border-color">
              <p>
                <b>{midiName}</b> · {totalBars} Takt(e) ·{" "}
                {midi.notes.length} Note(n) ·{" "}
                {midi.timeSignature.numerator}/{midi.timeSignature.denominator}
                {!midi.timeSignatureFromFile && (
                  <span className="text-accent-warning"> (angenommen)</span>
                )}
                {midi.bpm ? ` · ${midi.bpm} BPM` : " · kein Tempo in der Datei"}
              </p>
            </div>

            {/* Takt-Bereich */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-text-muted">Takt</label>
              <input
                data-testid="midi-bank-bar-from"
                type="number" min={1} max={Math.max(1, totalBars)}
                value={barFrom}
                onChange={e => setBarFrom(Math.max(1, Number(e.target.value) || 1))}
                className={numberField}
              />
              <span className="text-xs text-text-muted">bis</span>
              <input
                data-testid="midi-bank-bar-to"
                type="number" min={1} max={Math.max(1, totalBars)}
                value={barTo}
                onChange={e => setBarTo(Math.max(1, Number(e.target.value) || 1))}
                className={numberField}
              />
              <button
                data-testid="midi-bank-bar-all"
                onClick={() => { setBarFrom(1); setBarTo(Math.max(1, totalBars)); }}
                className="text-[10px] px-2 py-1 rounded bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
              >
                alle
              </button>
            </div>

            {/* Pattern-Länge + Zuordnung */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-muted">Steps/Pattern</label>
                <select
                  data-testid="midi-bank-steps"
                  value={stepsPerPattern}
                  onChange={e => setStepsPerPattern(Number(e.target.value) as E2StepLength)}
                  className="text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
                >
                  {STEP_LENGTHS.map(n => (
                    <option key={n} value={n}>{n} ({n / 16} Takt{n > 16 ? "e" : ""})</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-muted">Parts nach</label>
                <select
                  data-testid="midi-bank-mapping"
                  value={mapping}
                  onChange={e => setMapping(e.target.value as MidiPartMapping)}
                  className="text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
                  title="Tonhöhe: jede Note bekommt ihren Part (Drums). Spur: jede Spur wird ein Part, die Tonhöhe bleibt im Step (Melodie)."
                >
                  <option value="pitch">Tonhöhe (Drums)</option>
                  <option value="track">Spur (Melodie)</option>
                </select>
              </div>
            </div>

            {/* Spur-Auswahl */}
            <div className="space-y-1">
              <p className="text-xs text-text-muted">Spuren</p>
              <div className="flex flex-wrap gap-1.5">
                {midi.tracks.filter(t => t.noteCount > 0).map(t => (
                  <button
                    key={t.index}
                    data-testid={`midi-bank-track-${t.index}`}
                    onClick={() => toggleTrack(t.index)}
                    className={
                      selectedTracks.includes(t.index)
                        ? "text-[10px] px-2 py-1 rounded bg-accent-primary/20 text-accent-primary border border-accent-primary/40"
                        : "text-[10px] px-2 py-1 rounded bg-bg-elevated text-text-dim border border-transparent hover:text-text-primary transition-colors"
                    }
                  >
                    {t.index + 1}. {t.name || "ohne Namen"} · {t.noteCount}
                    {t.channels.includes(9) && " 🥁"}
                  </button>
                ))}
              </div>
            </div>

            {/* Vorschau — was passiert, BEVOR geschrieben wird */}
            {preview && (
              <div
                data-testid="midi-bank-preview"
                className="text-xs p-2 rounded bg-bg-base border border-border-color space-y-1"
              >
                <p className="text-text-primary">{describeMidiToE2(preview.report)}</p>
                {preview.report.partSources.length > 0 && (
                  <p className="text-[10px] text-text-dim">
                    Parts:{" "}
                    {preview.report.partSources
                      .map(s => `${s.partIndex + 1}=${s.label}`)
                      .join(", ")}
                  </p>
                )}
                {(preview.report.unmappedNotes > 0 ||
                  preview.report.collisions.length > 0) && (
                  <p className="text-[10px] text-accent-warning">
                    Nicht alles passt in 16 Parts bzw. auf einen Step je Part —
                    Einzelheiten oben. Weniger Spuren wählen oder Bereich
                    verkleinern hilft.
                  </p>
                )}
              </div>
            )}

            {/* Ziel-Slot + Export */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border-color">
              <label className="text-xs text-text-muted">Start-Slot</label>
              <input
                data-testid="midi-bank-start-slot"
                type="number" min={0} max={ALLPAT_PATTERN_COUNT - 1}
                value={startSlot}
                onChange={e =>
                  setStartSlot(
                    Math.max(0, Math.min(ALLPAT_PATTERN_COUNT - 1, Number(e.target.value) || 0)),
                  )
                }
                className={numberField}
              />
              <span className="text-[10px] text-text-dim">
                {preview
                  ? `${Math.min(preview.report.patternCount, ALLPAT_PATTERN_COUNT - startSlot)} von ${preview.report.patternCount} Pattern(s) passen ab Slot ${startSlot}`
                  : ""}
              </span>
            </div>

            <button
              data-testid="midi-bank-export"
              disabled={busy || !preview || preview.report.patternCount === 0}
              onClick={() => baseInputRef.current?.click()}
              className="flex items-center gap-1 text-xs px-3 py-2 rounded bg-accent-primary text-bg-base font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {busy ? "Schreibe…" : "Basis-Bank wählen & exportieren"}
            </button>
            <input
              ref={baseInputRef}
              type="file"
              accept=".e2sallpat,.all"
              className="hidden"
              onChange={onBase}
              data-testid="midi-bank-base-input"
            />
          </>
        )}

        <p className="text-[10px] text-text-dim">
          Der Container wird nicht erzeugt: lade ein echtes Bank-Backup deines
          Geräts, wir überschreiben nur die gewählten Slots. Sample-Zuordnung
          passiert nicht mit — die Parts triggern, was im jeweiligen Slot deiner
          Sample-Bank liegt.
        </p>
      </div>
    </div>
  );
}

# Agent: Audio-Engine & Performance

**Bereich:** `electron/waveform.ts`, `electron/export.ts`, `client/src/lib/audio/*`
**Branch:** `electron-dev`
**Priorität:** Mittel

---

## Rolle & Verantwortlichkeit

Du bist der **Audio-Engine-Agent**. Deine Aufgabe ist es, die Audio-Verarbeitung, -Analyse und den -Export für die Desktop-Umgebung zu optimieren. Du nutzt die Vorteile des direkten Dateisystemzugriffs und der nativen Node.js-Umgebung, um die Limitierungen der Web Audio API zu umgehen.

Im Browser ist die Audio-Verarbeitung auf den AudioContext beschränkt, der im Hauptthread läuft und bei großen Dateien die UI blockieren kann. In Electron kannst du Audio-Daten direkt aus dem Dateisystem lesen, in Worker-Threads analysieren und als native Dateien schreiben.

---

## Technologie-Stack & Skills

| Technologie | Verwendungszweck |
|---|---|
| Node.js `Buffer` | Binäre Audio-Daten lesen und schreiben |
| Node.js `fs` | Direkter Dateisystemzugriff |
| Node.js `worker_threads` | Parallele Audio-Analyse ohne UI-Blockierung |
| WAV-Format | Header-Parsing, PCM-Daten-Extraktion |
| MIDI-Format | SMF (Standard MIDI File) Format 1 |
| Tone.js (Renderer) | Web Audio API für Playback und Echtzeit-Effekte |

---

## Vorhandene Implementierung

### `electron/waveform.ts`

Der WAV-Header-Parser liest folgende Felder direkt aus dem Binär-Buffer:

| Feld | Offset | Typ | Beschreibung |
|---|---|---|---|
| `sampleRate` | fmt+8 | UInt32LE | z.B. 44100, 48000 |
| `channels` | fmt+2 | UInt16LE | 1 = Mono, 2 = Stereo |
| `bitDepth` | fmt+14 | UInt16LE | 8, 16, 24 oder 32 |
| `dataOffset` | data-Chunk | UInt32LE | Byte-Position der PCM-Daten |
| `dataSize` | data-Chunk | UInt32LE | Größe der PCM-Daten |

Die Waveform-Extraktion (`extractWavPeaks`) liest maximal 50 MB und teilt die Frames in `numPeaks` Blöcke auf. Pro Block wird der maximale Absolutwert als Peak-Wert gespeichert.

Für komprimierte Formate (MP3, OGG, FLAC) gibt es eine Schätzfunktion (`estimatePeaksForCompressedAudio`), die konsistente Pseudo-Zufallswerte basierend auf der Dateigröße generiert.

### `electron/export.ts`

Der WAV-Export (`writeWavFile`) schreibt:
- 44-Byte RIFF-Header mit korrekten Chunk-Größen
- PCM-Daten als Int16LE (Float32 → Int16 Konvertierung mit Clamping)

Der MIDI-Export (`writeMidiFile`) schreibt:
- SMF Format 1 (mehrere Tracks)
- Tempo-Track mit Microseconds-per-Beat
- Note-On/Note-Off Events mit korrekten VarLen-Delta-Times

---

## Offene Aufgaben

### Priorität Hoch

**1. Stereo-Support im WAV-Export**
Der aktuelle WAV-Export unterstützt nur Mono. Erweitere `writeWavFile` für Stereo-Ausgabe:

```typescript
// Aktuell: Mono (1 Kanal)
// Soll: Stereo (2 Kanäle, interleaved L/R/L/R/...)
function writeWavFile(
  filePath: string,
  leftChannel: Float32Array,
  rightChannel: Float32Array, // NEU
  sampleRate: number,
): void {
  const numChannels = 2;
  // Interleaving: [L0, R0, L1, R1, ...]
  for (let i = 0; i < leftChannel.length; i++) {
    writeInt16(leftChannel[i]);
    writeInt16(rightChannel[i]);
  }
}
```

**2. MP3-Dekodierung für echte Waveforms**
Aktuell werden für MP3-Dateien nur geschätzte Waveforms angezeigt. Integriere `@ffmpeg/ffmpeg` oder `node-lame` für echte PCM-Extraktion:

```typescript
// Option A: FFmpeg (plattformübergreifend, aber groß)
// Option B: node-lame (nur MP3, kleiner)
// Option C: Electron's nativeImage + offscreen canvas (experimentell)
```

### Priorität Mittel

**3. Worker-Thread für Waveform-Analyse**
Verlagere die Waveform-Berechnung in einen Worker-Thread, um den Main-Prozess nicht zu blockieren:

```typescript
// electron/workers/waveform.worker.ts
import { workerData, parentPort } from "worker_threads";
// ... Analyse-Logik
parentPort?.postMessage({ peaks, duration });
```

**4. Batch-Waveform-Generierung**
Implementiere einen IPC-Kanal `waveform:get-peaks-batch`, der mehrere Dateien parallel analysiert und Ergebnisse streamt.

---

## Prompts & Anweisungen

**Speicher-Effizienz:** Lese große Audio-Dateien niemals vollständig in den RAM. Nutze Streams oder lese nur die benötigten Bytes (z.B. nur die ersten 50 MB für Waveform-Analyse).

**Korrekte WAV-Implementierung:** Der WAV-Header muss exakt der RIFF-Spezifikation entsprechen. Falsche Chunk-Größen führen zu Abspiel-Fehlern in anderen Anwendungen.

**MIDI-Präzision:** VarLen-Encoding muss korrekt implementiert sein. Teste MIDI-Exporte mit externen Tools (z.B. GarageBand, Ableton) um Kompatibilität sicherzustellen.

**Keine AudioContext-Abhängigkeit im Main-Prozess:** Der Main-Prozess hat keinen Zugriff auf die Web Audio API. Alle Audio-Analysen müssen über reine Buffer-Operationen erfolgen.

---

## Audio-Format-Referenz

| Format | Unterstützung | Methode |
|---|---|---|
| WAV (PCM 16-bit) | Vollständig | Header-Parser + Peak-Extraktion |
| WAV (PCM 24-bit) | Vollständig | 3-Byte-Lesen mit Vorzeichen-Erweiterung |
| WAV (PCM 32-bit Float) | Vollständig | `readFloatLE` |
| MP3 | Schätzung | Dateigröße → Dauer-Schätzung |
| OGG/FLAC | Schätzung | Dateigröße → Dauer-Schätzung |
| AIFF | Vollständig (WAV-ähnlich) | Eigener Header-Parser nötig |

---

## Schnittstellen zu anderen Agenten

| Agent | Kommunikation |
|---|---|
| IPC-Bridge-Agent | Definiert Typen für Waveform-Daten und Export-Optionen |
| Frontend-Agent | Nutzt Waveform-Peaks für Canvas-Rendering |
| Backend-Agent | Koordiniert Dateisystem-Zugriffe |

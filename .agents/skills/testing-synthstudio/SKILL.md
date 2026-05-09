---
name: testing-synthstudio
description: Test SynthStudio DrumMachine and SampleBrowser features end-to-end. Use when verifying UI changes to the sequencer toolbar, sample import, or audio engine parameters.
---

# Testing SynthStudio

## Dev Server Setup

```bash
cd /home/ubuntu/Synthstudio
pnpm install
pnpm dev  # starts Vite dev server on http://localhost:5173
```

## App Layout

- **Left sidebar**: SampleBrowser (always visible, ~280px wide)
  - Toolbar buttons: `+ Dateien`, `+ Ordner`, `+ ZIP`
  - Category filter tabs: Alle, Kicks, Snares, Hi-Hats, FX, etc.
  - Each sample shows a colored category badge (KIC, SNA, HIH, FX, etc.)
- **Main area**: Tab-based (Sequencer, Mixer, Song-Modus, Humanizer, Tools, Kollaboration)
  - Default tab is **Sequencer** (DrumMachine)
- **DrumMachine toolbar** (top of sequencer area):
  - Pattern selector, Auflösung (resolution) buttons, BPM controls
  - **Swing** slider (0–100%) with status bar indicator
  - **Transpose** −/+ buttons with numeric display
  - **RPT** (Note-Repeat) toggle + rate dropdown (1/8, 1/16, 1/32)
  - `+ Kanal` button
- **Status bar** (bottom): Shows active Swing %, Transpose value, NOTE-REPEAT rate

## Creating Test Fixtures

### Test ZIP for Sample Import
```bash
sudo apt-get install -y sox
mkdir -p /tmp/test-samples/kicks /tmp/test-samples/snares /tmp/test-samples/hihats /tmp/test-samples/fx
sox -n /tmp/test-samples/kicks/kick_808_deep.wav synth 0.3 sine 60 fade 0 0.3 0.1
sox -n /tmp/test-samples/snares/snare_tight.wav synth 0.2 noise fade 0 0.2 0.05
sox -n /tmp/test-samples/hihats/hihat_closed.wav synth 0.1 noise fade 0 0.1 0.02
sox -n /tmp/test-samples/fx/crash_impact.wav synth 0.5 noise fade 0 0.5 0.2
cd /tmp/test-samples && zip -r /tmp/test-samplepack.zip kicks/ snares/ hihats/ fx/
```

The auto-categorization recognizes folder names like `kicks`, `snares`, `hihats`, `claps`, `toms`, `percussion`, `fx`, `loops`, `vocals`.

## Testing Tips

- The toolbar buttons (especially Transpose −/+) are small. If GUI clicks miss, use Playwright CDP at `http://localhost:29229` to find exact coordinates or click programmatically.
- Rapid programmatic clicks on stateful buttons may only register once due to React state batching. Add ~300ms delays between clicks.
- The app content area might not fill the full browser width — this is by design, not a window sizing issue.
- The `+ ZIP` button in the SampleBrowser triggers a hidden file input (`accept=".zip"`). In the file dialog, navigate to where your test ZIP is stored.
- Audio playback verification (swing timing, pitch transposition, note-repeat triggering) requires listening to output — can only be verified at UI/state level in headless environments.
- Unit tests: `pnpm test` (vitest, 500+ tests)
- Type checking: `pnpm check`
  - Pre-existing TS errors in `SpectrumAnalyzer.ts` and `collab-*.ts` are known and unrelated to new features.

## Key Source Files

| Feature | File |
|---------|------|
| ZIP Import + Auto-categorization | `client/src/components/SampleBrowser/SampleBrowser.tsx` |
| Swing / Transpose (audio engine) | `client/src/audio/AudioEngine.ts` |
| Swing / Transpose / RPT (UI) | `client/src/components/DrumMachine/DrumMachine.tsx` |
| Store actions | `client/src/store/useDrumMachineStore.ts` |

## Devin Secrets Needed

No secrets required — the app runs fully locally without authentication.

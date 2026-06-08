/**
 * Smoke-Test: nativer MIDI-OUTPUT-Pfad (#11).
 *
 * Treibt das ECHTE electron/midi-native.ts (compiled .cjs) gegen die real
 * vorhandenen Ausgänge dieser Maschine (hier: "Microsoft GS Wavetable Synth").
 * Verifiziert: loadNativeMidi → listMidiPorts → openMidiOutput → sendMidi
 * (Note-On/Off) → closeMidiPort, alles ohne Throw.
 *
 * Scope-Hinweis (Advisor): diese Maschine hat 0 MIDI-Inputs, daher prüft
 * der Smoke-Test NUR den Output-Pfad. Input-Routing + OmniTribe bleiben
 * unit-getestet (injizierte Bridge), bis echte Hardware-E2E möglich ist.
 */
const midi = require("../electron-dist/midi-native.cjs");

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
  console.log("  ok:", msg);
}

const load = midi.loadNativeMidi();
assert(load.ok, `loadNativeMidi → ${JSON.stringify(load)}`);

const ports = midi.listMidiPorts();
assert(ports.success, "listMidiPorts success");
console.log("  inputs:", JSON.stringify(ports.inputs));
console.log("  outputs:", JSON.stringify(ports.outputs));
assert(Array.isArray(ports.outputs) && ports.outputs.length > 0,
  "mindestens 1 Output vorhanden");

const status = midi.getMidiStatus();
console.log("  status:", JSON.stringify(status));
assert(status.available === true, "status.available === true");
assert(status.virtualPortsSupported === false, "virtualPorts false (win32)");

// Bevorzugt einen GS/Wavetable-Synth, sonst Port 0.
let target = ports.outputs.find((p) => /gs|wavetable|synth/i.test(p.name));
if (!target) target = ports.outputs[0];
console.log("  → öffne Output:", JSON.stringify(target));

const open = midi.openMidiOutput(target.index);
assert(open.success && open.handle, `openMidiOutput → ${JSON.stringify(open)}`);
assert(midi.getMidiStatus().openOutputs === 1, "openOutputs === 1");

// C-Dur-Arpeggio als hörbarer Beweis (GS-Synth spielt es ab).
const notes = [60, 64, 67, 72];
let sentOk = true;
for (const n of notes) {
  const on = midi.sendMidi(open.handle, [0x90, n, 100]);
  const off = midi.sendMidi(open.handle, [0x80, n, 0]);
  if (!on.success || !off.success) sentOk = false;
}
assert(sentOk, "sendMidi Note-On/Off für alle Noten ohne Fehler");

// Out-of-range Handle → sauberer Fehler, kein Throw.
const bad = midi.sendMidi("out:999", [0x90, 60, 100]);
assert(bad.success === false, `unbekanntes Handle → success:false (${bad.error})`);

const close = midi.closeMidiPort(open.handle);
assert(close.success, "closeMidiPort success");
assert(midi.getMidiStatus().openOutputs === 0, "openOutputs zurück auf 0");

midi.closeAllMidi();
console.log("\nSMOKE PASS: nativer Output-Pfad funktioniert end-to-end.");

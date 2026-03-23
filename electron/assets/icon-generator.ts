/**
 * Synthstudio – App-Icon Generator (Backend-Agent)
 *
 * Generiert ein 512×512 PNG-Icon für Synthstudio.
 * Voraussetzung: pnpm add -D canvas
 * Ausführen:     npx tsx electron/assets/icon-generator.ts
 */
import * as path from "path";
import * as fs from "fs";

const OUTPUT_DIR = path.resolve(__dirname, "../../assets");

async function generateIcon(): Promise<void> {
  // Canvas-Modul dynamisch laden (optionale Abhängigkeit)
  let canvasModule: typeof import("canvas");
  try {
    canvasModule = require("canvas") as typeof import("canvas");
  } catch {
    console.warn("[IconGen] Paket 'canvas' nicht gefunden.");
    console.info("[IconGen] Installation: pnpm add -D canvas");
    console.info("[IconGen] Alternativ: Platziere manuell icon.png (512×512) in assets/");
    process.exit(0);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const SIZE = 512;
  const canvas = canvasModule.createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  // ── Hintergrund ──────────────────────────────────────────────────────────
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Äußerer Glow-Ring ────────────────────────────────────────────────────
  const glow = ctx.createRadialGradient(
    SIZE / 2, SIZE / 2, SIZE * 0.15,
    SIZE / 2, SIZE / 2, SIZE * 0.48
  );
  glow.addColorStop(0, "rgba(6,182,212,0.3)");
  glow.addColorStop(0.5, "rgba(6,182,212,0.15)");
  glow.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE * 0.48, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // ── Cyan-Kreis (Rand) ────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE * 0.42, 0, Math.PI * 2);
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 6;
  ctx.stroke();

  // ── Innerer dunkler Kreis ────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = "#0f172a";
  ctx.fill();

  // ── Wellenform-Linie ─────────────────────────────────────────────────────
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.7;
  const waveY = SIZE / 2 + 70;
  const waveW = SIZE * 0.52;
  const waveX = (SIZE - waveW) / 2;
  ctx.beginPath();
  for (let i = 0; i <= waveW; i += 3) {
    const y = waveY + Math.sin((i / waveW) * Math.PI * 5) * 14 * Math.sin((i / waveW) * Math.PI);
    if (i === 0) ctx.moveTo(waveX + i, y);
    else ctx.lineTo(waveX + i, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ── 'ESX' Haupttext ──────────────────────────────────────────────────────
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.floor(SIZE * 0.24)}px "Courier New", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ESX", SIZE / 2, SIZE / 2 - 18);

  // ── Untertitel ───────────────────────────────────────────────────────────
  ctx.fillStyle = "#06b6d4";
  ctx.font = `${Math.floor(SIZE * 0.075)}px "Courier New", monospace`;
  ctx.fillText("1  STUDIO", SIZE / 2, SIZE / 2 + 38);

  // ── Speichern ────────────────────────────────────────────────────────────
  const outPath = path.join(OUTPUT_DIR, "icon.png");
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log(`[IconGen] Gespeichert: ${outPath}`);

  console.info("\n[IconGen] Konvertierung zu anderen Formaten:");
  console.info("  ICO (Windows):  pnpm add -D png-to-ico");
  console.info("                  npx png-to-ico assets/icon.png > assets/icon.ico");
  console.info("  ICNS (macOS):   brew install libicns && png2icns assets/icon.icns assets/icon.png");
  console.info("  Online-Tool:    https://www.icoconverter.com/");
}

generateIcon().catch(console.error);

/**
 * Synthstudio – App-Icon Ersteller (Build-Agent)
 *
 * Vollständiges Script zum Generieren aller App-Icons.
 * Erstellt icon.png (512×512) und gibt Anweisungen für ICO/ICNS.
 *
 * Voraussetzung: pnpm add -D canvas
 * Ausführen:     npx tsx electron/assets/create-icons.ts
 */
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";

// ESM-kompatibler __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, "../../assets");

// ─── Icon-Generierung ─────────────────────────────────────────────────────────

async function createPngIcon(): Promise<string> {
  let createCanvas: (w: number, h: number) => import("canvas").Canvas;

  try {
    const canvasModule = await import("canvas") as typeof import("canvas");
    createCanvas = canvasModule.createCanvas;
  } catch {
    console.error("\n[Icons] ❌ Paket 'canvas' nicht installiert.");
    console.info("[Icons] Installation: pnpm add -D canvas");
    console.info("[Icons] Oder: Platziere manuell eine icon.png (512×512) in assets/\n");
    process.exit(1);
  }

  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  const SIZE = 512;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  // ── Hintergrund ──────────────────────────────────────────────────────────
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Äußerer Glow ─────────────────────────────────────────────────────────
  const outerGlow = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE * 0.5);
  outerGlow.addColorStop(0, "rgba(6,182,212,0.08)");
  outerGlow.addColorStop(1, "transparent");
  ctx.fillStyle = outerGlow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Haupt-Kreis (Rand) ────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE * 0.44, 0, Math.PI * 2);
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 8;
  ctx.stroke();

  // ── Innerer Kreis-Gradient ────────────────────────────────────────────────
  const innerGrad = ctx.createRadialGradient(SIZE / 2, SIZE / 2 - 30, 20, SIZE / 2, SIZE / 2, SIZE * 0.4);
  innerGrad.addColorStop(0, "#1e293b");
  innerGrad.addColorStop(1, "#0f172a");
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = innerGrad;
  ctx.fill();

  // ── Horizontale Trennlinie ────────────────────────────────────────────────
  ctx.strokeStyle = "rgba(6,182,212,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SIZE * 0.2, SIZE / 2 + 10);
  ctx.lineTo(SIZE * 0.8, SIZE / 2 + 10);
  ctx.stroke();

  // ── Wellenform ────────────────────────────────────────────────────────────
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 3.5;
  ctx.globalAlpha = 0.8;
  const waveY = SIZE / 2 + 65;
  const waveW = SIZE * 0.55;
  const waveX = (SIZE - waveW) / 2;
  ctx.beginPath();
  for (let i = 0; i <= waveW; i += 2) {
    const t = i / waveW;
    const envelope = Math.sin(t * Math.PI); // Einhüllende
    const y = waveY + Math.sin(t * Math.PI * 6) * 16 * envelope;
    if (i === 0) ctx.moveTo(waveX + i, y);
    else ctx.lineTo(waveX + i, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // ── Haupttext 'ESX' ───────────────────────────────────────────────────────
  ctx.fillStyle = "#f8fafc";
  ctx.font = `bold ${Math.floor(SIZE * 0.25)}px "Courier New", Courier, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Schatten
  ctx.shadowColor = "rgba(6,182,212,0.5)";
  ctx.shadowBlur = 20;
  ctx.fillText("ESX", SIZE / 2, SIZE / 2 - 22);
  ctx.shadowBlur = 0;

  // ── Untertitel ────────────────────────────────────────────────────────────
  ctx.fillStyle = "#06b6d4";
  ctx.font = `${Math.floor(SIZE * 0.072)}px "Courier New", Courier, monospace`;
  ctx.fillText("1  STUDIO", SIZE / 2, SIZE / 2 + 32);

  // ── Speichern ─────────────────────────────────────────────────────────────
  const outPath = path.join(ASSETS_DIR, "icon.png");
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log(`[Icons] ✅ icon.png erstellt: ${outPath}`);
  return outPath;
}

// ─── Konvertierungs-Anweisungen ───────────────────────────────────────────────

function printConversionInstructions(pngPath: string): void {
  const platform = os.platform();

  console.info("\n╔════════════════════════════════════════════════════════╗");
  console.info("║         Icon-Konvertierung – Nächste Schritte          ║");
  console.info("╚════════════════════════════════════════════════════════╝\n");

  console.info("── Windows ICO ─────────────────────────────────────────");
  console.info("  pnpm add -D png-to-ico");
  console.info(`  npx png-to-ico ${pngPath} > assets/icon.ico\n`);

  console.info("── macOS ICNS ──────────────────────────────────────────");
  if (platform === "darwin") {
    console.info("  # Automatisch (macOS):");
    console.info("  mkdir icon.iconset");
    const sizes = [16, 32, 64, 128, 256, 512];
    sizes.forEach((s) => {
      console.info(`  sips -z ${s} ${s} assets/icon.png --out icon.iconset/icon_${s}x${s}.png`);
    });
    console.info("  iconutil -c icns icon.iconset -o assets/icon.icns");
    console.info("  rm -rf icon.iconset\n");
  } else {
    console.info("  # Linux (libicns):");
    console.info("  sudo apt-get install -y libicns-utils");
    console.info("  png2icns assets/icon.icns assets/icon.png\n");
  }

  console.info("── Online-Tools ────────────────────────────────────────");
  console.info("  ICO:  https://www.icoconverter.com/");
  console.info("  ICNS: https://cloudconvert.com/png-to-icns\n");

  console.info("── Alle Formate auf einmal (empfohlen) ─────────────────");
  console.info("  pnpm add -D electron-icon-builder");
  console.info("  npx electron-icon-builder --input=assets/icon.png --output=assets/\n");
}

// ─── Hauptfunktion ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info("\n[Icons] Synthstudio App-Icons werden erstellt...\n");

  const pngPath = await createPngIcon();
  printConversionInstructions(pngPath);

  console.info("[Icons] Fertig! Nächster Schritt: pnpm build:electron\n");
}

main().catch((err) => {
  console.error("[Icons] Fehler:", err);
  process.exit(1);
});

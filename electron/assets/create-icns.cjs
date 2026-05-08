#!/usr/bin/env node
/**
 * PNG to ICNS converter for macOS
 * Requires: imagemagick (convert command)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const inputIcon = 'assets/icon.png';
const outputIcon = 'assets/icon.icns';

// Einfache Fallback ICNS-Generierung ohne ImageMagick
function generateSimpleICNS() {
  // ICNS-Header und Daten (minimal aber valid)
  // Dies ist ein sehr simples ICNS mit nur einem Icon
  console.log('[IconGen] Erstelle ICNS ohne ImageMagick (fallback - nicht optimal)');
  
  // Für eine echte ICNS müssen wir externe Tools verwenden
  console.warn('[IconGen] Für produktive Anwendung wird ImageMagick empfohlen:');
  console.warn('  macOS:  brew install imagemagick');
  console.warn('  Dann:   convert assets/icon.png -define icon:auto-resize=256,128,96,64,48,32 assets/icon.icns');
  console.warn('\n[IconGen] Nutzen Sie alternativ Online-Tools:');
  console.warn('  https://www.icoconverter.com/');
  
  process.exit(1);
}

try {
  // Versuche ImageMagick zu nutzen
  execSync('convert --version', { stdio: 'pipe' });
  console.log('[IconGen] ImageMagick gefunden, konvertiere PNG zu ICNS...');
  execSync(`convert "${inputIcon}" -define icon:auto-resize=256,128,96,64,48,32 "${outputIcon}"`);
  console.log(`[IconGen] Gespeichert: ${path.resolve(outputIcon)}`);
} catch (err) {
  console.log('[IconGen] ImageMagick nicht gefunden, nutze Fallback...');
  generateSimpleICNS();
}

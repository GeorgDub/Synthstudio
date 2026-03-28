#!/usr/bin/env node
// Benennt alle .js-Dateien in electron-dist/ zu .cjs um
// und korrigiert require()-Pfade entsprechend
'use strict';

const fs = require('fs');
const path = require('path');

function walk(dir) {
  if (!fs.existsSync(dir)) {
    console.error('Verzeichnis nicht gefunden:', dir);
    process.exit(1);
  }
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      walk(full);
    } else if (f.endsWith('.js')) {
      const cjs = full.slice(0, -3) + '.cjs';
      let src = fs.readFileSync(full, 'utf8');
      // Relative require()-Pfade auf .cjs umstellen
      src = src.replace(/require\((['"])(\.[^'"]+)\1\)/g, (m, q, p) => {
        if (p.endsWith('.cjs') || p.endsWith('.json') || p.endsWith('.node')) return m;
        return `require(${q}${p}.cjs${q})`;
      });
      fs.writeFileSync(cjs, src);
      fs.unlinkSync(full);
      console.log(`  ${f} → ${path.basename(cjs)}`);
    }
  }
}

console.log('Benenne electron-dist/*.js → *.cjs um...');
walk('electron-dist');
console.log('Fertig.');

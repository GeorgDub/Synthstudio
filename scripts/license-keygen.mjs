#!/usr/bin/env node
/**
 * license-keygen.mjs — Ed25519-Schlüsselpaar erzeugen und Lizenzschlüssel
 * signieren (TASK-276).
 *
 * Hintergrund: die Offline-Validierung (licenseValidator.ts) ist fertig, aber
 * `LICENSE_PUBLIC_KEY_HEX` steht auf dem Null-Platzhalter — echte Schlüssel
 * können damit nie validieren. Dieses Werkzeug schließt genau diese Lücke;
 * es trifft KEINE Produktentscheidung und fasst den Master-Key nicht an.
 *
 * ⚠️ Der private Schlüssel gehört NICHT ins Repo und NICHT ins Bundle.
 *    Er lebt dort, wo Schlüssel gemintet werden (lokal oder im Signier-
 *    Webhook). Dieses Skript schreibt ihn deshalb nur nach stdout bzw. in
 *    eine Datei, die du selbst benennst.
 *
 * Benutzung:
 *
 *   # 1) Schlüsselpaar erzeugen (einmalig)
 *   node scripts/license-keygen.mjs keygen
 *     -> gibt PUBLIC (für licenseConfig.ts) und SECRET (geheim halten) aus
 *
 *   # 2) Lizenzschlüssel signieren
 *   node scripts/license-keygen.mjs sign \
 *        --secret <hex> --email kunde@example.com [--days 365]
 *     -> gibt den fertigen Lizenzschlüssel aus
 *
 *   # 3) Gegenprobe: signierten Schlüssel gegen einen Public-Key prüfen
 *   node scripts/license-keygen.mjs verify --public <hex> --key <lizenz>
 */
import * as ed from "@noble/ed25519";
import { randomBytes } from "node:crypto";

// Nur die *Async*-Varianten benutzen: die holen sha512 selbst aus WebCrypto,
// das Node seit v19 global bereitstellt. Genau so macht es auch
// licenseValidator.ts — dort wird kein Hash-Provider gesetzt. (Die sync-
// Varianten bräuchten einen, und `etc` ist in dieser Version eingefroren.)
const PRODUCT_ID = "synthstudio-pro-1";

function base64UrlEncode(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return new Uint8Array(
    Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64"),
  );
}

function hexToBytes(hex) {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`kein gültiger Hex-String: ${hex}`);
  }
  return new Uint8Array(clean.match(/../g).map((b) => parseInt(b, 16)));
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function cmdKeygen() {
  const secret = new Uint8Array(randomBytes(32));
  const publicKey = await ed.getPublicKeyAsync(secret);

  console.log("Ed25519-Schlüsselpaar erzeugt.\n");
  console.log("PUBLIC KEY (32 Byte hex) — hier einsetzen:");
  console.log("  client/src/utils/licenseConfig.ts -> LICENSE_PUBLIC_KEY_HEX\n");
  console.log(`  "${bytesToHex(publicKey)}"\n`);
  console.log("SECRET KEY (32 Byte hex) — GEHEIM HALTEN, nie ins Repo:\n");
  console.log(`  ${bytesToHex(secret)}\n`);
  console.log("Der geheime Schlüssel erscheint nur jetzt. Sicher ablegen.");
}

async function cmdSign() {
  const secretHex = arg("secret");
  const email = arg("email");
  const days = arg("days");
  if (!secretHex || !email) {
    throw new Error("sign braucht --secret <hex> und --email <adresse>");
  }
  const expiresAt =
    days === undefined ? null : Date.now() + Number(days) * 24 * 60 * 60 * 1000;
  if (days !== undefined && !Number.isFinite(expiresAt)) {
    throw new Error(`--days ist keine Zahl: ${days}`);
  }

  const payload = { email, expiresAt, productId: PRODUCT_ID };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await ed.signAsync(payloadBytes, hexToBytes(secretHex));
  const key = `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(sig)}`;

  console.log(`Lizenz für ${email}`);
  console.log(
    `Gültig: ${expiresAt === null ? "unbefristet" : new Date(expiresAt).toISOString()}\n`,
  );
  console.log(key);
}

async function cmdVerify() {
  const publicHex = arg("public");
  const key = arg("key");
  if (!publicHex || !key) {
    throw new Error("verify braucht --public <hex> und --key <lizenz>");
  }
  const [payloadPart, sigPart] = key.trim().split(".");
  if (!payloadPart || !sigPart) {
    throw new Error("Lizenzschlüssel hat nicht die Form <payload>.<signatur>");
  }
  const payloadBytes = base64UrlDecode(payloadPart);
  const ok = await ed.verifyAsync(
    base64UrlDecode(sigPart),
    payloadBytes,
    hexToBytes(publicHex),
  );
  console.log(ok ? "GÜLTIG" : "UNGÜLTIG");
  if (ok) console.log(new TextDecoder().decode(payloadBytes));
  if (!ok) process.exitCode = 1;
}

const cmd = process.argv[2];
const table = { keygen: cmdKeygen, sign: cmdSign, verify: cmdVerify };
if (!table[cmd]) {
  console.error("Benutzung: license-keygen.mjs <keygen|sign|verify> [Optionen]");
  console.error("Details im Kopf dieser Datei.");
  process.exit(2);
}
table[cmd]().catch((err) => {
  console.error(`Fehler: ${err.message}`);
  process.exit(1);
});

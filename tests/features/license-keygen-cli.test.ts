/**
 * license-keygen-cli.test.ts — belegt, dass `scripts/license-keygen.mjs`
 * Schlüssel erzeugt, die der Validator der App tatsächlich akzeptiert.
 *
 * Warum das der eigentliche Test ist: dass die CLI ihre eigenen Signaturen
 * wieder verifiziert, beweist nichts — beide Seiten wären dann nur
 * miteinander konsistent. Erst der Durchlauf durch `validateLicenseKey`
 * (dieselbe Funktion, die die App benutzt) zeigt, dass ein gemintetes
 * Schlüsselpaar produktiv trägt.
 *
 * Hintergrund: `LICENSE_PUBLIC_KEY_HEX` steht im Repo auf dem Null-
 * Platzhalter, echte Schlüssel können damit nie validieren. Die CLI schließt
 * diese Lücke (TASK-276). Sie trifft keine Produktentscheidung und fasst den
 * Master-Key nicht an.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateLicenseKey } from "@/utils/licenseValidator";
import { LICENSE_PRODUCT_ID } from "@/utils/licenseConfig";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = resolve(REPO, "scripts/license-keygen.mjs");

function run(...args: string[]): string {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8" });
}

function keypair(): { publicHex: string; secretHex: string } {
  const out = run("keygen");
  const pub = out.match(/"([0-9a-f]{64})"/)?.[1];
  const sec = out.match(/^ {2}([0-9a-f]{64})$/m)?.[1];
  if (!pub || !sec) throw new Error(`keygen-Ausgabe unlesbar:\n${out}`);
  return { publicHex: pub, secretHex: sec };
}

function mint(secretHex: string, email: string, days?: number): string {
  const args = ["sign", "--secret", secretHex, "--email", email];
  if (days !== undefined) args.push("--days", String(days));
  return run(...args).trim().split("\n").pop()!.trim();
}

describe("license-keygen CLI ↔ App-Validator", () => {
  it("erzeugt ein Schlüsselpaar, dessen Lizenz die App akzeptiert", async () => {
    const { publicHex, secretHex } = keypair();
    const key = mint(secretHex, "kunde@example.com", 365);

    const res = await validateLicenseKey(key, publicHex);
    expect(res.valid, `Validator lehnte ab: ${JSON.stringify(res)}`).toBe(true);
    if (res.valid) {
      expect(res.payload.email).toBe("kunde@example.com");
      expect(res.payload.productId).toBe(LICENSE_PRODUCT_ID);
      expect(res.payload.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it("kann unbefristete Lizenzen minten (ohne --days)", async () => {
    const { publicHex, secretHex } = keypair();
    const key = mint(secretHex, "perpetual@example.com");

    const res = await validateLicenseKey(key, publicHex);
    expect(res.valid).toBe(true);
    if (res.valid) expect(res.payload.expiresAt).toBeNull();
  });

  it("weist eine Lizenz zurück, die zu einem anderen Schlüsselpaar gehört", async () => {
    // Der Kern der Sache: die Signatur muss an DAS Paar gebunden sein.
    const a = keypair();
    const b = keypair();
    const key = mint(a.secretHex, "kunde@example.com", 30);

    const res = await validateLicenseKey(key, b.publicHex);
    expect(res.valid).toBe(false);
  });

  it("weist einen manipulierten Payload zurück", async () => {
    const { publicHex, secretHex } = keypair();
    const key = mint(secretHex, "kunde@example.com", 30);
    const [payloadB64, sigB64] = key.split(".");

    // Payload umschreiben, Signatur unverändert lassen.
    const payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    payload.email = "angreifer@example.com";
    const tampered =
      Buffer.from(JSON.stringify(payload))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "") +
      "." +
      sigB64;

    const res = await validateLicenseKey(tampered, publicHex);
    expect(res.valid).toBe(false);
  });

  it("das verify-Unterkommando stimmt mit dem App-Validator überein", () => {
    const { publicHex, secretHex } = keypair();
    const key = mint(secretHex, "kunde@example.com", 10);
    expect(run("verify", "--public", publicHex, "--key", key)).toContain("GÜLTIG");
  });
});

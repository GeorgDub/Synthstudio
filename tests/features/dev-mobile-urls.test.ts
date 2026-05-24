import { describe, expect, it } from "vitest";
import {
  buildCodespaceUrl,
  buildMobileUrls,
  detectCodespace,
  // @ts-expect-error — .mjs without types, helpers are plain JS
} from "../../scripts/dev-mobile.mjs";

describe("buildMobileUrls", () => {
  it("baut https-URLs aus LAN-Interfaces", () => {
    const result = buildMobileUrls(
      [
        { name: "eth0", address: "192.168.1.42" },
        { name: "wlan0", address: "10.0.0.7" },
      ],
      { protocol: "https:", port: 5173 }
    );
    expect(result).toEqual([
      { iface: "eth0", url: "https://192.168.1.42:5173" },
      { iface: "wlan0", url: "https://10.0.0.7:5173" },
    ]);
  });

  it("gibt leeres Array zurück wenn keine Interfaces vorhanden", () => {
    const result = buildMobileUrls([], { protocol: "https:", port: 5173 });
    expect(result).toEqual([]);
  });

  it("respektiert Port und Protokoll-Override", () => {
    const result = buildMobileUrls(
      [{ name: "en0", address: "172.16.0.5" }],
      { protocol: "http:", port: 4000 }
    );
    expect(result[0].url).toBe("http://172.16.0.5:4000");
  });
});

describe("detectCodespace", () => {
  it("erkennt aktive Codespaces-Session", () => {
    const result = detectCodespace({
      CODESPACES: "true",
      CODESPACE_NAME: "fuzzy-octopus-abc123",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
    });
    expect(result).toEqual({
      name: "fuzzy-octopus-abc123",
      domain: "app.github.dev",
    });
  });

  it("gibt null zurück wenn CODESPACES env fehlt", () => {
    expect(detectCodespace({})).toBeNull();
  });

  it("gibt null zurück wenn Name oder Domain fehlt", () => {
    expect(
      detectCodespace({
        CODESPACES: "true",
        CODESPACE_NAME: "fuzzy-octopus-abc123",
      })
    ).toBeNull();
  });
});

describe("buildCodespaceUrl", () => {
  it("baut Public-URL aus Name + Domain + Port", () => {
    const url = buildCodespaceUrl(
      { name: "fuzzy-octopus-abc123", domain: "app.github.dev" },
      5173
    );
    expect(url).toBe("https://fuzzy-octopus-abc123-5173.app.github.dev");
  });
});

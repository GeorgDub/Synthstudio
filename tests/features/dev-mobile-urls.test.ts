import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs without types, helper is plain JS
import { buildLocalUrl } from "../../scripts/dev-mobile.mjs";

describe("buildLocalUrl", () => {
  it("baut die localhost-URL mit dem Default-Port", () => {
    expect(buildLocalUrl(5173)).toBe("http://localhost:5173");
  });

  it("respektiert custom Port", () => {
    expect(buildLocalUrl(4000)).toBe("http://localhost:4000");
  });

  it("verwendet localhost, nicht 127.0.0.1, damit OS-Hosts-Aliasing greift", () => {
    expect(buildLocalUrl(8080)).toMatch(/localhost/);
  });
});

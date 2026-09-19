import { describe, expect, it } from "vitest";
import { normalizeModelAssetUrl } from "./modelAssetUrl";

describe("normalizeModelAssetUrl", () => {
  it("accepts public and remote GLB paths", () => {
    expect(normalizeModelAssetUrl(" /demo-assets/desk.glb ")).toBe(
      "/demo-assets/desk.glb",
    );
    expect(normalizeModelAssetUrl("https://cdn.example/desk.glb")).toBe(
      "https://cdn.example/desk.glb",
    );
  });

  it("rejects empty and executable URLs", () => {
    expect(() => normalizeModelAssetUrl(" ")).toThrow(
      "A model asset URL is required.",
    );
    expect(() => normalizeModelAssetUrl("javascript:alert(1)")).toThrow(
      "unsupported protocol",
    );
  });
});

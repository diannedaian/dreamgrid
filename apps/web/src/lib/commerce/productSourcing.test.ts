import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppConfig } from "../config";
import {
  importProductFromUrl,
  manualDraft,
  merchantFromUrl,
  searchProducts,
} from "./productSourcing";

const config = createAppConfig({ VITE_API_BASE_URL: "http://api.test" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importProductFromUrl", () => {
  it("posts the url and returns the draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sourceUrl: "https://shop.example/desk",
        title: "Desk",
        priceUsd: 99,
        styleTags: [],
        colorTags: [],
        confidence: 0.8,
        extractionMethod: "structured-data",
        missing: [],
      }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const draft = await importProductFromUrl("https://shop.example/desk", { titleHint: "Desk" }, config);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v1/products/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://shop.example/desk", titleHint: "Desk" }),
      }),
    );
    expect(draft.title).toBe("Desk");
    expect(draft.extractionMethod).toBe("structured-data");
  });

  it("falls back to a manual draft when the API is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const draft = await importProductFromUrl("https://www.ikea.com/x", {}, config);

    expect(draft.extractionMethod).toBe("manual");
    expect(draft.merchant).toBe("ikea.com");
    expect(draft.missing).toContain("dimensionsM");
    expect(draft.note).toMatch(/offline/);
  });

  it("falls back on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));

    const draft = await importProductFromUrl("https://shop.example/x", {}, config);

    expect(draft.extractionMethod).toBe("manual");
    expect(draft.note).toMatch(/500/);
  });
});

describe("searchProducts", () => {
  it("returns results and the source disclosure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          source: "fixture",
          results: [
            {
              sourceUrl: "https://shop.example/a",
              title: "A",
              styleTags: [],
              colorTags: [],
              confidence: 1,
              extractionMethod: "fixture",
              missing: [],
            },
            { junk: true },
          ],
        }),
      } as Response),
    );

    const result = await searchProducts({ category: "desk" }, undefined, config);

    expect(result.source).toBe("fixture");
    expect(result.results).toHaveLength(1);
  });

  it("returns an empty offline result when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await searchProducts({ category: "desk" }, undefined, config);

    expect(result).toEqual({ results: [], source: "offline", note: expect.stringMatching(/offline/) });
  });
});

describe("helpers", () => {
  it("derives a merchant from a url", () => {
    expect(merchantFromUrl("https://www.wayfair.com/furniture/x")).toBe("wayfair.com");
    expect(merchantFromUrl("not a url")).toBe("Unknown merchant");
  });

  it("builds a manual draft listing every missing field", () => {
    expect(manualDraft("", "typed in").missing).toEqual([
      "title",
      "priceUsd",
      "imageUrl",
      "dimensionsM",
      "category",
    ]);
  });
});

describe("null fields from the API", () => {
  it("become undefined so mergeDrafts and the form treat them as missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sourceUrl: "https://shop.example/x", title: "X", priceUsd: null, dimensionsM: null, imageUrl: null, styleTags: [], colorTags: [], confidence: 0.5, extractionMethod: "llm", missing: ["priceUsd", "dimensionsM"] }),
    } as Response));
    const draft = await importProductFromUrl("https://shop.example/x", {}, config);
    expect("priceUsd" in draft).toBe(false);
    expect(draft.dimensionsM).toBeUndefined();
    expect(draft.missing).toEqual(["priceUsd", "dimensionsM"]);
  });
});

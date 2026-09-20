import type { DimensionsM, ProductCategory } from "@dreamgrid/contracts";

import { appConfig, type AppConfig } from "../config";

export type ExtractionMethod = "structured-data" | "text-pattern" | "llm" | "fixture" | "manual";

/**
 * What the API can recover from a product page or a search hit. Every field
 * the `Product` contract requires may be missing; the user fills the gaps in
 * the import form before it becomes a real `Product`.
 */
export type ProductDraft = {
  sourceUrl: string;
  title?: string;
  priceUsd?: number;
  merchant?: string;
  imageUrl?: string;
  dimensionsM?: DimensionsM;
  category?: ProductCategory;
  styleTags: string[];
  colorTags: string[];
  /** 0..1; how much of the draft came from reliable data. */
  confidence: number;
  extractionMethod: ExtractionMethod;
  /** Names of `Product` fields the API could not fill. */
  missing: string[];
  /** Human-readable note about the source, e.g. why the fetch fell back. */
  note?: string;
};

/** Where to shop. Prices outside the US are converted to USD by the search provider. */
export type Region = "us" | "ca" | "uk" | "eu" | "au";

export const REGIONS: readonly { value: Region; label: string }[] = [
  { value: "us", label: "United States" },
  { value: "ca", label: "Canada" },
  { value: "uk", label: "United Kingdom" },
  { value: "eu", label: "European Union" },
  { value: "au", label: "Australia" },
];

export type ProductSearchQuery = {
  category: ProductCategory;
  keywords?: string;
  targetDimensionsM?: DimensionsM;
  maxPriceUsd?: number;
  styleTags?: string[];
  region?: Region;
  limit?: number;
};

export type SearchProviderName = "fixture" | "openai" | "serpapi";

export type ProductSearchResult = {
  results: ProductDraft[];
  /** Where the results came from; surfaced in the UI as a disclosure. */
  source: "live" | "fixture" | "offline";
  provider?: SearchProviderName;
  note?: string;
};

export function merchantFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown merchant";
  }
}

/** The draft used when the API is unreachable: the user fills everything in. */
export function manualDraft(sourceUrl: string, note: string): ProductDraft {
  return {
    sourceUrl,
    merchant: sourceUrl ? merchantFromUrl(sourceUrl) : undefined,
    styleTags: [],
    colorTags: [],
    confidence: 0,
    extractionMethod: "manual",
    missing: ["title", "priceUsd", "imageUrl", "dimensionsM", "category"],
    note,
  };
}

function isDraft(value: unknown): value is ProductDraft {
  return (
    typeof value === "object" &&
    value !== null &&
    "sourceUrl" in value &&
    typeof value.sourceUrl === "string" &&
    "extractionMethod" in value &&
    typeof value.extractionMethod === "string"
  );
}

/** The API sends `null` for what it could not fill; the rest of the pipeline reads `undefined`. */
function normalizeDraft(draft: ProductDraft): ProductDraft {
  const out = { ...draft } as Record<string, unknown>;
  for (const key of Object.keys(out)) if (out[key] === null) delete out[key];
  out.styleTags ??= [];
  out.colorTags ??= [];
  out.missing ??= [];
  return out as unknown as ProductDraft;
}

async function postJson(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  config: AppConfig,
): Promise<unknown> {
  const response = await fetch(config.apiUrl(path), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(`${path} failed with status ${response.status}.`);
  }
  return response.json();
}

/**
 * Ask the API to read a product page. Never throws: any failure returns a
 * manual draft so the import form still opens.
 */
export async function importProductFromUrl(
  url: string,
  options: { titleHint?: string; signal?: AbortSignal } = {},
  config: AppConfig = appConfig,
): Promise<ProductDraft> {
  const { titleHint, signal } = options;
  try {
    const payload = await postJson(
      "/api/v1/products/import",
      titleHint ? { url, titleHint } : { url },
      signal,
      config,
    );
    if (!isDraft(payload)) {
      throw new Error("Import returned an invalid draft.");
    }
    return normalizeDraft(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return manualDraft(url, `Could not read the page (${reason}). Enter the details by hand.`);
  }
}

/**
 * Search for products that fit a category, size, and price. Never throws: an
 * unreachable API yields an empty offline result.
 */
export async function searchProducts(
  query: ProductSearchQuery,
  signal?: AbortSignal,
  config: AppConfig = appConfig,
): Promise<ProductSearchResult> {
  try {
    const payload = await postJson("/api/v1/products/search", query, signal, config);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("results" in payload) ||
      !Array.isArray(payload.results)
    ) {
      throw new Error("Search returned an invalid response.");
    }
    const results = payload.results.filter(isDraft).map(normalizeDraft);
    const source =
      "source" in payload && (payload.source === "live" || payload.source === "fixture")
        ? payload.source
        : "live";
    const note = "note" in payload && typeof payload.note === "string" ? payload.note : undefined;
    const provider =
      "provider" in payload &&
      (payload.provider === "fixture" || payload.provider === "openai" || payload.provider === "serpapi")
        ? payload.provider
        : undefined;
    return { results, source, provider, note };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return { results: [], source: "offline", note: `Search is unavailable (${reason}).` };
  }
}

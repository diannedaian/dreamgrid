import type { ProductCategory } from "@dreamgrid/contracts";
import { useState, type FormEvent } from "react";

import {
  searchProducts,
  type ProductDraft,
  type ProductSearchQuery,
  type ProductSearchResult,
} from "../lib/commerce/productSourcing";
import { PRODUCT_CATEGORIES } from "./draftToProduct";
import { formatUsd } from "./format";
import { rankSearchResults, type RankedResult } from "./productSearch";
import { LENGTH_UNITS, toMeters, type LengthUnit } from "./units";

export type ProductSearchFormProps = {
  /** Prefills the price limit; typically the remaining budget. */
  defaultMaxPriceUsd?: number;
  /** The user picked a result; the parent opens it in the import form. */
  onPickResult: (draft: ProductDraft) => void;
  /** Injected for tests; defaults to the real API adapter. */
  search?: (query: ProductSearchQuery) => Promise<ProductSearchResult>;
};

const SOURCE_LABEL = {
  live: "Results from AI web search. Confirm price and size on the store page.",
  fixture: "Demo results from a fixture, not live listings.",
  offline: "Search is unavailable right now.",
} as const;

/**
 * "I need a desk about 120 x 60 x 75 cm for under $43." Ranks the API's
 * candidates by price, size, and style fit. Unstyled.
 */
export function ProductSearchForm({
  defaultMaxPriceUsd,
  onPickResult,
  search = searchProducts,
}: ProductSearchFormProps) {
  const [category, setCategory] = useState<ProductCategory>("desk");
  const [keywords, setKeywords] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [unit, setUnit] = useState<LengthUnit>("cm");
  const [maxPrice, setMaxPrice] = useState(
    defaultMaxPriceUsd !== undefined && defaultMaxPriceUsd > 0 ? String(defaultMaxPriceUsd) : "",
  );
  const [styleTags, setStyleTags] = useState("");
  const [searching, setSearching] = useState(false);
  const [outcome, setOutcome] = useState<{ result: ProductSearchResult; ranked: RankedResult[] }>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const dims = [width, height, depth].map(Number);
    const query: ProductSearchQuery = {
      category,
      keywords: keywords.trim() || undefined,
      targetDimensionsM: dims.every((n) => Number.isFinite(n) && n > 0)
        ? [toMeters(dims[0], unit), toMeters(dims[1], unit), toMeters(dims[2], unit)]
        : undefined,
      maxPriceUsd: maxPrice.trim() !== "" && Number(maxPrice) >= 0 ? Number(maxPrice) : undefined,
      styleTags: styleTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    };
    setSearching(true);
    try {
      const result = await search(query);
      setOutcome({ result, ranked: rankSearchResults(query, result.results) });
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="commerce-search" aria-labelledby="commerce-search-title">
      <h2 id="commerce-search-title">Find a product that fits</h2>

      <form onSubmit={handleSubmit}>
        <label>
          I need a
          <select value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Keywords
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="small white" />
        </label>
        <fieldset>
          <legend>About this size (optional)</legend>
          <label>
            Width <input type="number" min={0} step="any" value={width} onChange={(e) => setWidth(e.target.value)} />
          </label>
          <label>
            Height <input type="number" min={0} step="any" value={height} onChange={(e) => setHeight(e.target.value)} />
          </label>
          <label>
            Depth <input type="number" min={0} step="any" value={depth} onChange={(e) => setDepth(e.target.value)} />
          </label>
          <label>
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)}>
              {LENGTH_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <label>
          Max price (USD)
          <input type="number" min={0} step="any" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
        </label>
        <label>
          Style (comma separated)
          <input value={styleTags} onChange={(e) => setStyleTags(e.target.value)} placeholder="minimal, cozy" />
        </label>
        <button type="submit" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {outcome && (
        <div className="commerce-search__results">
          <p role="status">
            {SOURCE_LABEL[outcome.result.source]}
            {outcome.result.note ? ` ${outcome.result.note}` : ""}
          </p>
          {outcome.ranked.length === 0 ? (
            <p>No results. Try fewer constraints, or add the product by link or by hand.</p>
          ) : (
            <ol>
              {outcome.ranked.map(({ draft, reasons, overBudgetUsd }) => (
                <li key={draft.sourceUrl} className={overBudgetUsd > 0 ? "commerce-search__over" : undefined}>
                  <strong>{draft.title ?? draft.sourceUrl}</strong>{" "}
                  <span>{draft.priceUsd !== undefined ? formatUsd(draft.priceUsd) : "price unknown"}</span>
                  {draft.merchant && <span> · {draft.merchant}</span>}
                  {draft.dimensionsM && (
                    <span>
                      {" "}
                      · {Math.round(draft.dimensionsM[0] * 100)}×{Math.round(draft.dimensionsM[2] * 100)}×
                      {Math.round(draft.dimensionsM[1] * 100)} cm (W×D×H)
                    </span>
                  )}
                  <ul>
                    {reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <a href={draft.sourceUrl} target="_blank" rel="noreferrer">
                    Open store page
                  </a>{" "}
                  <button type="button" onClick={() => onPickResult(draft)}>
                    Use this
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

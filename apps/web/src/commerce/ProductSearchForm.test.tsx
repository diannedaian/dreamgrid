import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProductDraft, ProductSearchResult } from "../lib/commerce/productSourcing";
import { ProductSearchForm } from "./ProductSearchForm";

const cheap: ProductDraft = {
  sourceUrl: "https://example.com/search/fold-down-wall-desk",
  title: "Fold-Down Wall Desk",
  priceUsd: 39,
  merchant: "Demo",
  dimensionsM: [0.8, 0.5, 0.45],
  category: "desk",
  styleTags: ["compact"],
  colorTags: [],
  confidence: 1,
  extractionMethod: "fixture",
  missing: [],
};
const pricey: ProductDraft = { ...cheap, sourceUrl: "https://example.com/x", title: "Wide Oak Work Table", priceUsd: 159 };

describe("ProductSearchForm", () => {
  it("prefills the price limit, sends the query, and ranks results", async () => {
    const search = vi.fn().mockResolvedValue({
      results: [pricey, cheap],
      source: "fixture",
    } satisfies ProductSearchResult);
    const onPickResult = vi.fn();
    render(<ProductSearchForm defaultMaxPriceUsd={43} onPickResult={onPickResult} search={search} />);

    expect(screen.getByLabelText("Max price (USD)")).toHaveValue(43);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "75" } });
    fireEvent.change(screen.getByLabelText("Depth"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Demo results"));
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "desk",
        maxPriceUsd: 43,
        targetDimensionsM: [1.2, 0.75, 0.6],
        region: "us",
      }),
    );
    const items = screen.getAllByRole("listitem").filter((li) => li.querySelector("strong"));
    expect(items[0]).toHaveTextContent("Fold-Down Wall Desk");
    expect(items[1]).toHaveTextContent("$116 over your limit");

    fireEvent.click(screen.getAllByRole("button", { name: "Use this" })[0]);
    expect(onPickResult).toHaveBeenCalledWith(cheap);
  });

  it("sends the selected region", async () => {
    const search = vi.fn().mockResolvedValue({ results: [], source: "fixture" } satisfies ProductSearchResult);
    render(<ProductSearchForm onPickResult={vi.fn()} search={search} />);

    expect(screen.getByLabelText("Shop in")).toHaveValue("us");
    fireEvent.change(screen.getByLabelText("Shop in"), { target: { value: "uk" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ region: "uk" })));
  });

  it("explains an offline search instead of failing", async () => {
    const search = vi.fn().mockResolvedValue({
      results: [],
      source: "offline",
      note: "Search is unavailable (offline).",
    } satisfies ProductSearchResult);
    render(<ProductSearchForm onPickResult={vi.fn()} search={search} />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("unavailable"));
    expect(screen.getByText(/No results/)).toBeInTheDocument();
  });
});

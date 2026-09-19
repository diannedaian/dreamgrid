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
    const onProductCreated = vi.fn();
    const onNeedsDetails = vi.fn();
    const fetchDraft = vi.fn().mockResolvedValue({ ...cheap, missing: [] });
    render(
      <ProductSearchForm
        defaultMaxPriceUsd={43}
        onProductCreated={onProductCreated}
        onNeedsDetails={onNeedsDetails}
        search={search}
        fetchDraft={fetchDraft}
      />,
    );

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

    fireEvent.click(screen.getAllByRole("button", { name: "Add to catalog" })[0]);
    await waitFor(() => expect(onProductCreated).toHaveBeenCalledTimes(1));
    expect(fetchDraft).not.toHaveBeenCalled(); // the fixture listing was already complete
    const product = onProductCreated.mock.calls[0][0];
    expect(product.title).toBe("Fold-Down Wall Desk");
    expect(product.priceUsd).toBe(39);
    expect(product.dimensionsM).toEqual([0.8, 0.5, 0.45]);
    expect(screen.getByRole("button", { name: "Added to catalog" })).toBeDisabled();
    expect(onNeedsDetails).not.toHaveBeenCalled();
  });

  it("reads the link for a listing without dimensions, then adds it", async () => {
    const listing: ProductDraft = {
      ...cheap,
      sourceUrl: "https://www.google.com/search?ibp=oshop&prds=catalogid:1",
      title: "BestOffice Computer Desk",
      priceUsd: 36.99,
      dimensionsM: undefined,
      missing: ["dimensionsM"],
    };
    const search = vi.fn().mockResolvedValue({ results: [listing], source: "live", provider: "serpapi" });
    const fetchDraft = vi.fn().mockResolvedValue({
      ...listing,
      title: "AI title",
      priceUsd: undefined,
      dimensionsM: [1.0, 0.75, 0.5],
      extractionMethod: "llm",
      missing: ["priceUsd", "imageUrl"],
      note: "AI-reported price about $29.00 (unverified).",
    } satisfies ProductDraft);
    const onProductCreated = vi.fn();
    render(
      <ProductSearchForm
        onProductCreated={onProductCreated}
        onNeedsDetails={vi.fn()}
        search={search}
        fetchDraft={fetchDraft}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => screen.getByRole("button", { name: "Add to catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to catalog" }));

    await waitFor(() => expect(onProductCreated).toHaveBeenCalledTimes(1));
    expect(fetchDraft).toHaveBeenCalledWith(listing.sourceUrl, { titleHint: "BestOffice Computer Desk" });
    const product = onProductCreated.mock.calls[0][0];
    expect(product.title).toBe("BestOffice Computer Desk"); // listing wins over the AI title
    expect(product.priceUsd).toBe(36.99); // listing price kept
    expect(product.dimensionsM).toEqual([1.0, 0.75, 0.5]);
  });

  it("hands off to the form when dimensions cannot be found", async () => {
    const listing: ProductDraft = { ...cheap, dimensionsM: undefined, missing: ["dimensionsM"] };
    const search = vi.fn().mockResolvedValue({ results: [listing], source: "live", provider: "serpapi" });
    const fetchDraft = vi.fn().mockResolvedValue({ ...listing, extractionMethod: "manual" });
    const onProductCreated = vi.fn();
    const onNeedsDetails = vi.fn();
    render(
      <ProductSearchForm
        onProductCreated={onProductCreated}
        onNeedsDetails={onNeedsDetails}
        search={search}
        fetchDraft={fetchDraft}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => screen.getByRole("button", { name: "Add to catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to catalog" }));

    await waitFor(() => expect(onNeedsDetails).toHaveBeenCalledTimes(1));
    expect(onProductCreated).not.toHaveBeenCalled();
    expect(screen.getByText(/Still needed: dimensionsM/)).toBeInTheDocument();
  });

  it("sends the selected region", async () => {
    const search = vi.fn().mockResolvedValue({ results: [], source: "fixture" } satisfies ProductSearchResult);
    render(<ProductSearchForm onProductCreated={vi.fn()} onNeedsDetails={vi.fn()} search={search} />);

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
    render(<ProductSearchForm onProductCreated={vi.fn()} onNeedsDetails={vi.fn()} search={search} />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("unavailable"));
    expect(screen.getByText(/No results/)).toBeInTheDocument();
  });
});

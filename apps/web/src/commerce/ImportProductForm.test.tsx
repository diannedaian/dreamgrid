import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProductDraft } from "../lib/commerce/productSourcing";
import { ImportProductForm } from "./ImportProductForm";

const scrapedDraft: ProductDraft = {
  sourceUrl: "https://shop.example/desk",
  title: "Scraped Desk",
  priceUsd: 89,
  merchant: "shop.example",
  dimensionsM: [1.2, 0.75, 0.6],
  category: "desk",
  styleTags: ["minimal"],
  colorTags: ["white"],
  confidence: 0.9,
  extractionMethod: "structured-data",
  missing: [],
};

describe("ImportProductForm", () => {
  it("reads a link, prefills the fields, and creates a product", async () => {
    const onProductCreated = vi.fn();
    const fetchDraft = vi.fn().mockResolvedValue(scrapedDraft);
    render(<ImportProductForm onProductCreated={onProductCreated} fetchDraft={fetchDraft} />);

    fireEvent.change(screen.getByLabelText("Product link"), {
      target: { value: "https://shop.example/desk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read details from link" }));

    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Scraped Desk"));
    expect(fetchDraft).toHaveBeenCalledWith("https://shop.example/desk");
    expect(screen.getByRole("status")).toHaveTextContent("structured product data");
    expect(screen.getByLabelText("Width")).toHaveValue(47.24);

    fireEvent.click(screen.getByRole("button", { name: "Add to catalog" }));

    expect(onProductCreated).toHaveBeenCalledTimes(1);
    const product = onProductCreated.mock.calls[0][0];
    expect(product.title).toBe("Scraped Desk");
    expect(product.priceUsd).toBe(89);
    expect(product.dimensionsM[0]).toBeCloseTo(1.2, 2);
    expect(product.id).toMatch(/^product-import-/);
  });

  it("shows validation errors instead of creating an incomplete product", () => {
    const onProductCreated = vi.fn();
    render(<ImportProductForm onProductCreated={onProductCreated} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to catalog" }));

    expect(screen.getByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByText("Enter a width.")).toBeInTheDocument();
    expect(onProductCreated).not.toHaveBeenCalled();
  });

  it("keeps working by hand when the link cannot be read", async () => {
    const onProductCreated = vi.fn();
    const fetchDraft = vi.fn().mockResolvedValue({
      sourceUrl: "https://www.amazon.com/dp/x",
      merchant: "amazon.com",
      styleTags: [],
      colorTags: [],
      confidence: 0,
      extractionMethod: "manual",
      missing: ["title", "priceUsd", "imageUrl", "dimensionsM", "category"],
      note: "Could not read the page (403). Enter the details by hand.",
    } satisfies ProductDraft);
    render(<ImportProductForm onProductCreated={onProductCreated} fetchDraft={fetchDraft} />);

    fireEvent.change(screen.getByLabelText("Product link"), {
      target: { value: "https://www.amazon.com/dp/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read details from link" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Entered by hand"));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Lamp" } });
    fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Depth"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to catalog" }));

    expect(onProductCreated).toHaveBeenCalledTimes(1);
    expect(onProductCreated.mock.calls[0][0].merchant).toBe("amazon.com");
  });
});

describe("ImportProductForm pasted text", () => {
  it("fills price and dimensions from an Amazon-style paste and creates the product", () => {
    const onProductCreated = vi.fn();
    render(<ImportProductForm onProductCreated={onProductCreated} />);

    fireEvent.change(screen.getByLabelText(/paste the product details/), {
      target: {
        value:
          "SONGMICS Computer Desk, 47.2 Inch Home Office Desk\nList Price: $129.99\nPrice: $89.99\nProduct Dimensions: 23.6\"D x 47.2\"W x 29.5\"H",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read details from text" }));

    expect(screen.getByText(/Read dimensions, priceUsd, title, category/)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("SONGMICS Computer Desk, 47.2 Inch Home Office Desk");
    expect(screen.getByLabelText("Price (USD)")).toHaveValue(89.99);
    expect(screen.getByLabelText("Width")).toHaveValue(47.2);
    expect(screen.getByLabelText("Depth")).toHaveValue(23.6);
    expect(screen.getByLabelText("Height")).toHaveValue(29.5);
    expect(screen.getByLabelText("Category")).toHaveValue("desk");

    fireEvent.click(screen.getByRole("button", { name: "Add to catalog" }));

    expect(onProductCreated).toHaveBeenCalledTimes(1);
    expect(onProductCreated.mock.calls[0][0].dimensionsM).toEqual([1.199, 0.749, 0.599]);
  });

  it("says so when nothing is recognized", () => {
    render(<ImportProductForm onProductCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/paste the product details/), {
      target: { value: "hello there" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read details from text" }));

    expect(screen.getByText(/No title, price, or W x D x H/)).toBeInTheDocument();
  });
});

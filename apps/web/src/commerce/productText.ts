import type { ProductCategory } from "@dreamgrid/contracts";

import type { ProductFormFields } from "./draftToProduct";
import { parseDimensionValues, type LengthUnit } from "./units";

/**
 * Read what a user pasted from a store page (Amazon's "Product information"
 * table, an IKEA spec list, a whole page selection). Runs in the browser, so
 * it works when the store blocks server-side reading.
 */
export type ParsedProductText = Partial<
  Pick<ProductFormFields, "title" | "priceUsd" | "category" | "width" | "height" | "depth" | "unit">
> & { found: ("title" | "priceUsd" | "category" | "dimensions")[] };

const AMOUNT = String.raw`\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)`;
const LABELED_PRICE = new RegExp(String.raw`(list\s+price|was|save|now|price|deal|typical)[^$\n]{0,24}${AMOUNT}`, "gi");
const ANY_PRICE = new RegExp(AMOUNT);

const CATEGORY_KEYWORDS: [ProductCategory, string[]][] = [
  ["bed", ["bed", "mattress", "daybed", "bunk"]],
  ["desk", ["desk", "workstation", "table"]],
  ["chair", ["chair", "stool", "seat", "armchair"]],
  ["shelf", ["shelf", "shelving", "bookcase", "bookshelf", "cart", "storage", "cabinet"]],
  ["lamp", ["lamp", "light", "lighting", "sconce"]],
  ["decor", ["rug", "mirror", "art", "plant", "pillow", "curtain", "decor"]],
];

export function guessCategory(text: string): ProductCategory | undefined {
  const lowered = text.toLowerCase();
  return CATEGORY_KEYWORDS.find(([, words]) => words.some((w) => lowered.includes(w)))?.[0];
}

/** The selling price: a "price"/"now" amount beats "list price"/"was"/"save"; else the first amount. */
export function findPrice(text: string): number | undefined {
  let fallback: number | undefined;
  for (const match of text.matchAll(LABELED_PRICE)) {
    const label = match[1].toLowerCase();
    const amount = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;
    if (label === "price" || label === "now" || label === "deal" || label === "typical") return amount;
    fallback ??= label === "list price" || label === "was" ? amount : undefined;
  }
  if (fallback !== undefined) return fallback;
  const any = ANY_PRICE.exec(text);
  return any ? Number(any[1].replace(/,/g, "")) : undefined;
}

function findTitle(text: string): string | undefined {
  const first = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 6 && line.length <= 160 && !/\$|:/.test(line));
  return first;
}

export function parseProductText(text: string, unit: LengthUnit): ParsedProductText {
  const result: ParsedProductText = { found: [] };
  if (!text.trim()) return result;

  const dims = parseDimensionValues(text, unit);
  if (dims) {
    result.unit = dims.unit;
    result.width = String(dims.width);
    result.height = String(dims.height);
    result.depth = String(dims.depth);
    result.found.push("dimensions");
  }

  const price = findPrice(text);
  if (price !== undefined) {
    result.priceUsd = String(price);
    result.found.push("priceUsd");
  }

  // A first line is only trusted as a title when the paste looks like product data.
  const title = result.found.length > 0 ? findTitle(text) : undefined;
  if (title) {
    result.title = title;
    result.found.push("title");
  }

  const category = guessCategory(title ?? text);
  if (category) {
    result.category = category;
    result.found.push("category");
  }

  return result;
}

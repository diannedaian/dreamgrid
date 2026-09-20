import {
  assertValidContract,
  validateProduct,
  type Product,
  type ProductCategory,
} from "@dreamgrid/contracts";

import { manualDraft, merchantFromUrl, type ProductDraft } from "../lib/commerce/productSourcing";
import { roundUsd } from "./budget";
import { fromMeters, toMeters, type LengthUnit } from "./units";

export const PRODUCT_CATEGORIES: readonly ProductCategory[] = [
  "bed",
  "desk",
  "chair",
  "shelf",
  "lamp",
  "decor",
];

/** Everything the import form edits, as strings so inputs stay controlled. */
export type ProductFormFields = {
  title: string;
  priceUsd: string;
  category: ProductCategory;
  width: string;
  height: string;
  depth: string;
  unit: LengthUnit;
  imageUrl: string;
  sourceUrl: string;
  merchant: string;
  styleTags: string;
  colorTags: string;
};

export const PLACEHOLDER_IMAGE_URL = "/demo-assets/previews/placeholder.webp";

function formatLength(meters: number | undefined, unit: LengthUnit): string {
  return meters === undefined ? "" : String(fromMeters(meters, unit));
}

/** Prefill the form from a draft; missing fields become empty strings. */
export function fieldsFromDraft(
  draft: ProductDraft = manualDraft("", ""),
  unit: LengthUnit = "in",
): ProductFormFields {
  const [w, h, d] = draft.dimensionsM ?? [undefined, undefined, undefined];
  return {
    title: draft.title ?? "",
    priceUsd: draft.priceUsd === undefined ? "" : String(draft.priceUsd),
    category: draft.category ?? "decor",
    width: formatLength(w, unit),
    height: formatLength(h, unit),
    depth: formatLength(d, unit),
    unit,
    imageUrl: draft.imageUrl ?? "",
    sourceUrl: draft.sourceUrl,
    merchant: draft.merchant ?? (draft.sourceUrl ? merchantFromUrl(draft.sourceUrl) : ""),
    styleTags: draft.styleTags.join(", "),
    colorTags: draft.colorTags.join(", "),
  };
}

export type FieldErrors = Partial<Record<keyof ProductFormFields, string>>;

function parseTags(raw: string): string[] {
  // The schema requires unique, non-empty tags.
  const tags = raw.split(/[,\n]/).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  return [...new Set(tags)];
}

/** The schema requires strictly positive dimensions; never let rounding hit 0. */
function lengthToMeters(raw: string, unit: LengthUnit): number {
  return Math.max(0.001, toMeters(Number(raw), unit));
}

function positiveNumber(raw: string): number | undefined {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function validateFields(fields: ProductFormFields): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.title.trim()) errors.title = "Enter a title.";
  const price = Number(fields.priceUsd);
  if (fields.priceUsd.trim() === "" || !Number.isFinite(price) || price < 0) {
    errors.priceUsd = "Enter a price of 0 or more (0 marks it unpriced).";
  }
  if (!positiveNumber(fields.width)) errors.width = "Enter a width.";
  if (!positiveNumber(fields.height)) errors.height = "Enter a height.";
  if (!positiveNumber(fields.depth)) errors.depth = "Enter a depth.";
  for (const key of ["sourceUrl", "imageUrl"] as const) {
    if (!fields[key].trim()) continue;
    try {
      const url = new URL(fields[key]);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) errors[key] = "Use a public http(s) URL.";
    } catch { errors[key] = "Use a public http(s) URL."; }
  }
  return errors;
}

/**
 * Turn confirmed form fields into a contract-valid `Product`. Throws
 * `ContractValidationError` if the result would not pass the shared schema,
 * so a bad product never reaches the catalog or the budget.
 */
export function buildProduct(
  fields: ProductFormFields,
  id: string = `product-import-${crypto.randomUUID()}`,
): Product {
  const errors = validateFields(fields);
  if (Object.keys(errors).length) throw new Error(Object.values(errors).join(" "));
  const candidate = {
    id,
    title: fields.title.trim(),
    category: fields.category,
    priceUsd: roundUsd(Number(fields.priceUsd)),
    merchant: fields.merchant.trim() || (fields.sourceUrl ? merchantFromUrl(fields.sourceUrl) : "Manual entry"),
    sourceUrl: fields.sourceUrl.trim(),
    imageUrl: fields.imageUrl.trim() || PLACEHOLDER_IMAGE_URL,
    dimensionsM: [
      lengthToMeters(fields.width, fields.unit),
      lengthToMeters(fields.height, fields.unit),
      lengthToMeters(fields.depth, fields.unit),
    ],
    styleTags: [...parseTags(fields.styleTags).filter(t => !["price-not-provided", "model-pending"].includes(t)), "model-pending", ...(Number(fields.priceUsd) > 0 ? [] : ["price-not-provided"])],
    colorTags: parseTags(fields.colorTags),
  };
  assertValidContract("Product", validateProduct, candidate);
  return candidate;
}

/** Fill a listing's gaps from a fetched draft; what the listing already states wins. */
export function mergeDrafts(base: ProductDraft, extra: ProductDraft): ProductDraft {
  const merged = {
    title: base.title ?? extra.title,
    priceUsd: base.priceUsd ?? extra.priceUsd,
    merchant: base.merchant ?? extra.merchant,
    imageUrl: base.imageUrl ?? extra.imageUrl,
    dimensionsM: base.dimensionsM ?? extra.dimensionsM,
    category: base.category ?? extra.category,
  };
  const required = ["title", "priceUsd", "imageUrl", "dimensionsM", "category"] as const;
  return {
    ...base,
    ...merged,
    styleTags: base.styleTags.length ? base.styleTags : extra.styleTags,
    colorTags: base.colorTags.length ? base.colorTags : extra.colorTags,
    confidence: Math.max(base.confidence, extra.confidence),
    extractionMethod: base.dimensionsM ? base.extractionMethod : extra.extractionMethod,
    missing: required.filter((key) => merged[key] === undefined),
    note: [base.note, extra.note].filter(Boolean).join(" ") || undefined,
  };
}

/**
 * A draft becomes a Product without user input only when everything the
 * contract needs is present. Returns null when the form is still required.
 */
export function productFromCompleteDraft(draft: ProductDraft, id?: string): Product | null {
  const fields = fieldsFromDraft(draft, "cm");
  if (Object.keys(validateFields(fields)).length > 0) return null;
  try {
    return buildProduct(fields, id);
  } catch {
    return null;
  }
}

import { ContractValidationError, type Product } from "@dreamgrid/contracts";
import { useEffect, useState, type FormEvent } from "react";

import { importProductFromUrl, type ProductDraft } from "../lib/commerce/productSourcing";
import {
  PRODUCT_CATEGORIES,
  buildProduct,
  fieldsFromDraft,
  validateFields,
  type FieldErrors,
  type ProductFormFields,
} from "./draftToProduct";
import { LENGTH_UNITS, type LengthUnit } from "./units";

export type ImportProductFormProps = {
  onProductCreated: (product: Product) => void;
  /** Prefill from a search result or a previous fetch. */
  draft?: ProductDraft;
  /** Injected for tests; defaults to the real API adapter. */
  fetchDraft?: (url: string) => Promise<ProductDraft>;
};

const EXTRACTION_LABEL = {
  "structured-data": "Read from the page's structured product data.",
  "text-pattern": "Read from the page text; please check the numbers.",
  llm: "Extracted by AI from the page text; please check the numbers.",
  fixture: "Demo fixture data.",
  manual: "Entered by hand.",
} as const;

/**
 * Paste a link (optional), fetch what the API can read, confirm or fill the
 * rest, and hand back a contract-valid Product. Unstyled.
 */
export function ImportProductForm({
  onProductCreated,
  draft,
  fetchDraft = importProductFromUrl,
}: ImportProductFormProps) {
  const [url, setUrl] = useState(draft?.sourceUrl ?? "");
  const [fields, setFields] = useState<ProductFormFields>(() => fieldsFromDraft(draft));
  const [source, setSource] = useState<ProductDraft | undefined>(draft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [fetching, setFetching] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  useEffect(() => {
    if (draft) {
      setFields(fieldsFromDraft(draft));
      setSource(draft);
      setUrl(draft.sourceUrl);
    }
  }, [draft]);

  function update<K extends keyof ProductFormFields>(key: K, value: ProductFormFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function handleFetch() {
    if (!url.trim()) return;
    setFetching(true);
    try {
      const next = await fetchDraft(url.trim());
      setSource(next);
      setFields(fieldsFromDraft(next, fields.unit));
      setErrors({});
    } finally {
      setFetching(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateFields(fields);
    setErrors(nextErrors);
    setSubmitError(undefined);
    if (Object.keys(nextErrors).length > 0) return;
    try {
      onProductCreated(buildProduct(fields));
      setFields(fieldsFromDraft(undefined, fields.unit));
      setSource(undefined);
      setUrl("");
    } catch (error) {
      setSubmitError(
        error instanceof ContractValidationError ? error.message : "Could not create the product.",
      );
    }
  }

  return (
    <form className="commerce-import" onSubmit={handleSubmit} aria-labelledby="commerce-import-title">
      <h2 id="commerce-import-title">Add a product</h2>

      <div className="commerce-import__url">
        <label>
          Product link
          <input
            type="url"
            value={url}
            placeholder="https://store.example/product"
            onChange={(event) => {
              setUrl(event.target.value);
              update("sourceUrl", event.target.value);
            }}
          />
        </label>
        <button type="button" onClick={handleFetch} disabled={fetching || !url.trim()}>
          {fetching ? "Reading page…" : "Read details from link"}
        </button>
      </div>

      {source && (
        <p className="commerce-import__disclosure" role="status">
          {EXTRACTION_LABEL[source.extractionMethod]}
          {source.note ? ` ${source.note}` : ""}
          {source.missing.length > 0 && source.extractionMethod !== "manual"
            ? ` Still needed: ${source.missing.join(", ")}.`
            : ""}
        </p>
      )}

      <label>
        Title
        <input value={fields.title} onChange={(e) => update("title", e.target.value)} />
        {errors.title && <span className="commerce-import__error">{errors.title}</span>}
      </label>

      <label>
        Price (USD)
        <input
          type="number"
          min={0}
          step="any"
          value={fields.priceUsd}
          onChange={(e) => update("priceUsd", e.target.value)}
        />
        {errors.priceUsd && <span className="commerce-import__error">{errors.priceUsd}</span>}
      </label>

      <label>
        Category
        <select value={fields.category} onChange={(e) => update("category", e.target.value as ProductFormFields["category"])}>
          {PRODUCT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="commerce-import__dimensions">
        <legend>Dimensions</legend>
        <label>
          Width
          <input type="number" min={0} step="any" value={fields.width} onChange={(e) => update("width", e.target.value)} />
          {errors.width && <span className="commerce-import__error">{errors.width}</span>}
        </label>
        <label>
          Height
          <input type="number" min={0} step="any" value={fields.height} onChange={(e) => update("height", e.target.value)} />
          {errors.height && <span className="commerce-import__error">{errors.height}</span>}
        </label>
        <label>
          Depth
          <input type="number" min={0} step="any" value={fields.depth} onChange={(e) => update("depth", e.target.value)} />
          {errors.depth && <span className="commerce-import__error">{errors.depth}</span>}
        </label>
        <label>
          Unit
          <select value={fields.unit} onChange={(e) => update("unit", e.target.value as LengthUnit)}>
            {LENGTH_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <label>
        Merchant
        <input value={fields.merchant} onChange={(e) => update("merchant", e.target.value)} />
      </label>
      <label>
        Image URL
        <input value={fields.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} />
      </label>
      <label>
        Style tags (comma separated)
        <input value={fields.styleTags} onChange={(e) => update("styleTags", e.target.value)} />
      </label>
      <label>
        Color tags (comma separated)
        <input value={fields.colorTags} onChange={(e) => update("colorTags", e.target.value)} />
      </label>

      {submitError && (
        <p className="commerce-import__error" role="alert">
          {submitError}
        </p>
      )}

      <button type="submit">Add to catalog</button>
    </form>
  );
}

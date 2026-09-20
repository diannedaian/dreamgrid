// "Add your own product": the form under the shop drawer's search bar. Three ways in — read a
// link, paste the listing text (parsed in the browser, so it works when a store blocks the API's
// reader), or type the details — then one contract-valid Product goes to the catalog.
// Vanilla-DOM port of the former React ImportProductForm; the logic lives in draftToProduct.ts.
import { ContractValidationError, type Product } from "@dreamgrid/contracts";

import { importProductFromUrl, type ProductDraft } from "../lib/commerce/productSourcing";
import { productIdFor } from "./catalogAdd";
import { PRODUCT_CATEGORIES, buildProduct, fieldsFromDraft, validateFields, type ProductFormFields } from "./draftToProduct";
import { parseProductText } from "./productText";
import { fromMeters, toMeters, LENGTH_UNITS, type LengthUnit } from "./units";

export type ProductFormOptions = {
  onProductCreated: (product: Product) => void;
  /** Injected for tests; defaults to the real API adapter. */
  fetchDraft?: (url: string, options: { titleHint?: string }) => Promise<ProductDraft>;
  productId?: (sourceUrl: string) => Promise<string>;
};

export type ProductForm = {
  /** Show the form, optionally prefilled from a search hit or a link the API could only partly read. */
  open: (draft?: ProductDraft) => void;
  close: () => void;
  toggle: () => void;
  readonly isOpen: boolean;
};

const EXTRACTION_LABEL = {
  "structured-data": "Read from the page's structured product data.",
  "text-pattern": "Read from the page text; please check the numbers.",
  llm: "Extracted by AI from the page text; please check the numbers.",
  fixture: "Demo fixture data.",
  manual: "Entered by hand.",
} as const;

/** Fill only what is still empty: a lookup can add dimensions without replacing a real price. */
function mergeEmptyFields(current: ProductFormFields, fetched: ProductFormFields): ProductFormFields {
  const merged = { ...current };
  for (const key of Object.keys(fetched) as (keyof ProductFormFields)[]) {
    if (key === "unit" || key === "category") continue;
    if (!String(merged[key]).trim() && String(fetched[key]).trim()) merged[key] = fetched[key];
  }
  if (merged.category === "decor" && fetched.category !== "decor") merged.category = fetched.category;
  return merged;
}

export function mountProductForm(root: HTMLElement, o: ProductFormOptions): ProductForm {
  const fetchDraft = o.fetchDraft ?? importProductFromUrl;
  const productId = o.productId ?? productIdFor;
  root.hidden = true;
  root.innerHTML = `
    <form class="pform" novalidate>
      <h3>Add your own product</h3>
      <p class="sub">Paste a link and read it, paste the listing text, or type the details. It joins the catalog below.</p>
      <div class="link"><input type="url" class="f-url" placeholder="https://store.example/product" autocomplete="off" /><button type="button" class="read-link">Read link</button></div>
      <p class="note" hidden></p>
      <details class="paste">
        <summary>Paste the listing text instead</summary>
        <textarea class="f-paste" rows="4" placeholder="Product Dimensions: 23.6&quot;D x 47.2&quot;W x 29.5&quot;H&#10;Price: $89.99"></textarea>
        <div class="row"><button type="button" class="read-text">Read details from text</button><span class="paste-msg"></span></div>
      </details>
      <label class="field">Title<input class="f-title" data-field="title" /></label>
      <div class="grid2">
        <label class="field">Price (USD, 0 = unknown)<input type="number" min="0" step="any" class="f-price" data-field="priceUsd" /></label>
        <label class="field">Category<select class="f-category">${PRODUCT_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select></label>
      </div>
      <div class="field size">
        <span>Size</span>
        <div class="dims">
          <input type="number" min="0" step="any" class="f-width" placeholder="W" data-field="width" /><i>×</i>
          <input type="number" min="0" step="any" class="f-depth" placeholder="D" data-field="depth" /><i>×</i>
          <input type="number" min="0" step="any" class="f-height" placeholder="H" data-field="height" />
          <select class="f-unit">${LENGTH_UNITS.map((u) => `<option value="${u}">${u}</option>`).join("")}</select>
        </div>
      </div>
      <details class="more">
        <summary>Merchant, image, tags</summary>
        <label class="field">Merchant<input class="f-merchant" /></label>
        <label class="field">Image URL<input class="f-image" /></label>
        <label class="field">Style tags<input class="f-style" placeholder="minimal, cozy" /></label>
        <label class="field">Color tags<input class="f-color" placeholder="white, oak" /></label>
      </details>
      <p class="err" hidden></p>
      <div class="actions"><button type="submit" class="find">Confirm & generate model</button><button type="button" class="ghost cancel">Cancel</button><span class="status"></span></div>
    </form>`;

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const form = q<HTMLFormElement>("form");
  const inputs = {
    url: q<HTMLInputElement>(".f-url"), title: q<HTMLInputElement>(".f-title"), priceUsd: q<HTMLInputElement>(".f-price"),
    category: q<HTMLSelectElement>(".f-category"), width: q<HTMLInputElement>(".f-width"), height: q<HTMLInputElement>(".f-height"),
    depth: q<HTMLInputElement>(".f-depth"), unit: q<HTMLSelectElement>(".f-unit"), merchant: q<HTMLInputElement>(".f-merchant"),
    imageUrl: q<HTMLInputElement>(".f-image"), styleTags: q<HTMLInputElement>(".f-style"), colorTags: q<HTMLInputElement>(".f-color"),
  };
  const note = q(".note"), err = q(".err"), status = q(".status"), pasteMsg = q(".paste-msg");
  const readLink = q<HTMLButtonElement>(".read-link"), readText = q<HTMLButtonElement>(".read-text"), submit = q<HTMLButtonElement>(".find");

  let currentUnit: LengthUnit = "in";
  inputs.unit.addEventListener("change", () => {
    const unit = inputs.unit.value as LengthUnit;
    for (const key of ["width", "height", "depth"] as const) {
      if (inputs[key].value.trim()) inputs[key].value = String(fromMeters(toMeters(Number(inputs[key].value), currentUnit), unit));
    }
    currentUnit = unit;
  });
  const read = (): ProductFormFields => ({
    title: inputs.title.value, priceUsd: inputs.priceUsd.value, category: inputs.category.value as ProductFormFields["category"],
    width: inputs.width.value, height: inputs.height.value, depth: inputs.depth.value, unit: inputs.unit.value as LengthUnit,
    imageUrl: inputs.imageUrl.value, sourceUrl: inputs.url.value, merchant: inputs.merchant.value,
    styleTags: inputs.styleTags.value, colorTags: inputs.colorTags.value,
  });
  const write = (f: ProductFormFields) => {
    currentUnit = f.unit;
    inputs.title.value = f.title; inputs.priceUsd.value = f.priceUsd; inputs.category.value = f.category;
    inputs.width.value = f.width; inputs.height.value = f.height; inputs.depth.value = f.depth; inputs.unit.value = f.unit;
    inputs.imageUrl.value = f.imageUrl; inputs.url.value = f.sourceUrl; inputs.merchant.value = f.merchant;
    inputs.styleTags.value = f.styleTags; inputs.colorTags.value = f.colorTags;
    clearErrors();
  };
  const clearErrors = () => {
    err.hidden = true;
    for (const el of root.querySelectorAll(".bad")) el.classList.remove("bad");
  };
  const showSource = (source: ProductDraft | undefined) => {
    note.hidden = !source;
    if (!source) return;
    const missing = source.missing.length > 0 && source.extractionMethod !== "manual" ? ` Still needed: ${source.missing.join(", ")}.` : "";
    note.textContent = `${EXTRACTION_LABEL[source.extractionMethod]}${source.note ? ` ${source.note}` : ""}${missing}`;
  };

  // Read the link and fill only the fields that are still empty.
  readLink.addEventListener("click", async () => {
    const url = inputs.url.value.trim();
    if (!/^https?:\/\//.test(url)) { inputs.url.focus(); return; }
    readLink.disabled = true; readLink.textContent = "Reading…";
    try {
      const current = read();
      const next = await fetchDraft(url, { titleHint: current.title.trim() || undefined });
      write(mergeEmptyFields(current, fieldsFromDraft(next, current.unit)));
      showSource(next);
    } finally { readLink.disabled = false; readLink.textContent = "Read link"; }
  });

  // Paste path: parsed here in the browser, so it works when the store blocks the API's reader.
  readText.addEventListener("click", () => {
    const text = q<HTMLTextAreaElement>(".f-paste").value;
    const { found, ...values } = parseProductText(text, inputs.unit.value as LengthUnit);
    if (found.length === 0) { pasteMsg.textContent = "No title, price, or W x D x H dimensions were recognized."; return; }
    write({ ...read(), ...values });
    pasteMsg.textContent = `Read ${found.join(", ")}; please check the values.`;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fields = read();
    const errors = validateFields(fields);
    clearErrors();
    if (Object.keys(errors).length > 0) {
      for (const key of Object.keys(errors)) root.querySelector(`[data-field="${key}"]`)?.classList.add("bad");
      err.hidden = false; err.textContent = Object.values(errors).join(" ");
      return;
    }
    submit.disabled = true; status.textContent = "";
    try {
      const product = buildProduct(fields, await productId(fields.sourceUrl));
      o.onProductCreated(product);
      write(fieldsFromDraft(undefined, fields.unit));
      showSource(undefined);
      q<HTMLTextAreaElement>(".f-paste").value = ""; pasteMsg.textContent = "";
      status.textContent = `Added “${product.title}”`;
      setTimeout(() => { if (status.textContent?.startsWith("Added")) close(); }, 900);
    } catch (error) {
      err.hidden = false;
      err.textContent = error instanceof ContractValidationError ? error.message : "Could not create the product.";
    } finally { submit.disabled = false; }
  });
  q(".cancel").addEventListener("click", () => close());

  const open = (draft?: ProductDraft) => {
    root.hidden = false;
    if (draft) { write(fieldsFromDraft(draft, "in")); showSource(draft); }
    status.textContent = "";
    setTimeout(() => (draft?.title ? inputs.width : inputs.url).focus(), 0);
  };
  const close = () => { root.hidden = true; };
  return {
    open, close,
    toggle: () => (root.hidden ? open() : close()),
    get isOpen() { return !root.hidden; },
  };
}

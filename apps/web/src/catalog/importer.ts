// Photo → Sol-authored geometry → quick size check → Blender job → real GLB in the room.
import type { DimensionReview, GenerateRequest, GenerationJob, PreparedImport, Product } from "@contracts";
import { priceKnown } from "../commerce/budget";
import { createGenerationClient, furnitureImageDataUrl, waitForGeneration } from "./generationClient";
import type { GeneratedEntry } from "./generatedCatalog";

const AXES = ["width", "height", "depth"] as const;
const LABELS = { width: "Width", height: "Height", depth: "Depth" };
const SOURCES = { product_text: "Provided specifications", product_url: "Product listing", image_label: "Image label", estimated: "Estimate — not measured", user: "Your measurement" };
const IN = 0.0254;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const estimated = (m: DimensionReview["width"]) => m.source === "estimated" || /\b(estimat\w*|about|approx\w*|roughly)\b/i.test(m.evidence);
const inches = (m: number) => Math.round((m / IN) * 10) / 10;

/**
 * Sizes the user left alone stay exact (estimates stay labeled estimates); a size the user typed
 * is their measurement. Building with untouched estimates is the explicit acceptance.
 */
export function reviewedRequest(prepared: PreparedImport, productId: string, valuesM: number[]): GenerateRequest {
  const values = AXES.map((axis, i) => {
    const n = valuesM[i];
    if (!Number.isFinite(n) || n < .05 || n > 5) throw new Error("Each size must be between 2 and 196 inches.");
    const original = prepared.dimensions[axis].valueM;
    return Math.abs(n - original) < IN / 20 ? original : n; // sub-tenth-inch drift from unit rounding is "unchanged"
  });
  const estimatedAxes = AXES.filter((axis, i) => values[i] === prepared.dimensions[axis].valueM && estimated(prepared.dimensions[axis]));
  return { importId: prepared.importId, productId, dimensions: { widthM: values[0], heightM: values[1], depthM: values[2] }, confirmed: true, acceptEstimated: true, estimatedAxes };
}

export function dimensionDisclosure(review: DimensionReview): string {
  return AXES.map(axis => `${LABELS[axis]}: ${(review[axis].valueM * 100).toFixed(2)} cm (${SOURCES[review[axis].source]}; ${review[axis].evidence})`).join(". ");
}

/** What a search result or catalog entry can hand the panel so the user only has to hit Generate. */
export type ImportSeed = Partial<Product> & { sourceUrl: string };

/** Download a listing photo through the API's safe proxy so it can fill the file input. */
export async function fetchListingPhoto(imageUrl: string, fetcher: typeof fetch = fetch): Promise<File | null> {
  try {
    const response = await fetcher(`/api/v1/products/photo?url=${encodeURIComponent(imageUrl)}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").split(";")[0].trim();
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
    const blob = await response.blob();
    if (!blob.size || blob.size > 5_000_000) return null;
    return new File([blob], `listing.${type.split("/")[1] === "jpeg" ? "jpg" : type.split("/")[1]}`, { type });
  } catch { return null; }
}

export function seedNotes(seed: ImportSeed): string {
  const dims = seed.dimensionsM?.map(m => Math.round((m / IN) * 10) / 10);
  return [seed.title, dims ? `Listed size: width ${dims[0]} in, height ${dims[1]} in, depth ${dims[2]} in.` : ""].filter(Boolean).join(". ");
}

export function generatedProduct(prepared: PreparedImport, asset: GeneratedEntry["asset"], price: number | null, sourceUrl: string, source?: ImportSeed): Product {
  return {
    id: asset.productId, title: source?.title || prepared.title, category: source?.category || prepared.category,
    priceUsd: price ?? 0, merchant: source?.merchant || (sourceUrl ? new URL(sourceUrl).hostname : "Your image"),
    sourceUrl, imageUrl: source?.imageUrl || "", dimensionsM: asset.dimensionsM,
    styleTags: [...(source?.styleTags || []).filter(t => !["price-not-provided", "model-pending"].includes(t)), ...(price === null || price <= 0 ? ["price-not-provided"] : [])],
    colorTags: source?.colorTags || [], modelAssetId: asset.id,
  };
}

/** Same `imp-<sha1(url)[:16]>` id the sourcing pipeline uses, so one listing is one catalog row. */
export async function stableProductId(sourceUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return `generated-${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(sourceUrl.trim()));
  return `imp-${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16)}`;
}

const ANALYZE_NOTES = ["Looking at your photo…", "Counting legs and cushions…", "Guessing the wood grain…", "Measuring twice…", "Sketching the silhouette…"];
const BUILD_NOTES = ["Cutting the pieces…", "Sanding the edges…", "Picking the fabric…", "Tightening the last screw…", "Fluffing the cushions…"];

export function mountImporter(root: HTMLElement, onImported: (r: GeneratedEntry) => Promise<void>, api = createGenerationClient(), photo = fetchListingPhoto): { open: (input?: string | ImportSeed) => void } {
  let busy = false, prepared: PreparedImport | null = null, activeJob: GenerationJob | null = null;
  let productId = "", sourceUrl = "", price: number | null = null, completed = false;
  let started = 0, ticker: number | undefined, photoLoad = 0;
  let sourceProduct: ImportSeed | undefined;
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  // While a build runs the sheet can be tucked away into this pill; the work itself never stops.
  const dock = document.createElement("button");
  dock.type = "button"; dock.id = "import-dock"; dock.hidden = true;
  dock.innerHTML = `<span class="builder mini" aria-hidden="true"><i class="leg a"></i><i class="leg b"></i><i class="seat"></i><i class="back"></i><i class="cushion"></i></span><span class="dock-text"><b></b><small></small></span>`;
  (document.getElementById("chrome") ?? root.parentElement ?? document.body).appendChild(dock);
  let dockTimer: number | undefined;
  const showDock = (title: string, sub: string, kind: "working" | "ready" | "ok" | "err" = "working") => {
    clearTimeout(dockTimer);
    dock.hidden = false; dock.className = kind;
    dock.querySelector("b")!.textContent = title;
    dock.querySelector("small")!.textContent = sub;
    if (kind === "ok") dockTimer = window.setTimeout(() => { dock.hidden = true; }, 5000);
  };
  const dockTitle = () => prepared?.title || sourceProduct?.title || "your furniture";
  const close = () => { // Hide, don't abort paid work or discard progress.
    root.hidden = true;
    if (busy && !completed) showDock(`${prepared ? "Building" : "Studying"} ${dockTitle()}`, q(".progress .clock").textContent || "");
    else if (prepared && !activeJob && !completed) showDock(`${dockTitle()} is ready to build`, "Check the sizes, then build it", "ready");
  };
  dock.addEventListener("click", () => { dock.hidden = true; clearTimeout(dockTimer); root.hidden = false; });
  root.addEventListener("click", e => { if (e.target === root) close(); });
  window.addEventListener("keydown", e => { if (e.key === "Escape" && !root.hidden) close(); });

  const prefill = (input: string | ImportSeed) => {
    const seed = typeof input === "string" ? { sourceUrl: input } : input;
    const changed = q<HTMLInputElement>(".url").value !== seed.sourceUrl || sourceProduct?.id !== seed.id;
    if (changed) clearPhoto();
    sourceProduct = seed;
    q<HTMLInputElement>(".url").value = seed.sourceUrl;
    q<HTMLInputElement>(".price").value = seed.priceUsd && seed.priceUsd > 0 && !seed.styleTags?.includes("price-not-provided") ? String(seed.priceUsd) : "";
    q<HTMLTextAreaElement>(".specs").value = seedNotes(seed);
    if (changed && seed.imageUrl && /^https?:\/\//.test(seed.imageUrl)) void loadPhoto(seed.imageUrl);
  };
  const loadPhoto = async (imageUrl: string) => {
    const token = ++photoLoad;
    const body = q(".drop-body b");
    body.textContent = "Grabbing the listing photo…";
    const file = await photo(imageUrl);
    if (token !== photoLoad || prepared) return;
    if (!file) { body.textContent = "Drop a product photo"; status("Couldn't grab the store's photo — drop or pick one instead.", "hint"); return; }
    const list = new DataTransfer(); list.items.add(file);
    q<HTMLInputElement>(".image").files = list.files;
    showPhoto(file);
    body.textContent = "Listing photo";
  };
  const clearPhoto = () => {
    photoLoad++;
    q<HTMLInputElement>(".image").value = "";
    const preview = q<HTMLImageElement>(".preview");
    preview.hidden = true; preview.removeAttribute("src");
    q(".drop").classList.remove("has-photo");
    q(".drop-body b").textContent = "Drop a product photo";
  };
  const showPhoto = (file: File) => {
    const preview = q<HTMLImageElement>(".preview");
    const url = URL.createObjectURL(file);
    preview.onload = () => URL.revokeObjectURL(url);
    preview.src = url; preview.hidden = false;
    q(".drop").classList.add("has-photo");
  };
  const setStep = (n: number) => root.querySelectorAll(".steps span").forEach((el, i) => { el.classList.toggle("on", i <= n); el.classList.toggle("now", i === n); });
  const status = (text: string, kind = "working") => {
    const el = q(".status"); el.hidden = !text; el.className = `status ${kind}`; el.textContent = text;
  };
  const progress = (phase: "analyze" | "build" | null, note = "") => {
    clearInterval(ticker); ticker = undefined;
    const panel = q(".progress");
    panel.hidden = !phase;
    q("fieldset").hidden = !!phase;
    if (!phase) return;
    const notes = phase === "analyze" ? ANALYZE_NOTES : BUILD_NOTES;
    let i = 0;
    const tick = () => {
      const s = Math.round((performance.now() - started) / 1000);
      q(".progress .note").textContent = note || notes[i % notes.length];
      q(".progress .clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (!dock.hidden && dock.className === "working") dock.querySelector("small")!.textContent = `${q(".progress .clock").textContent} · ${q(".progress .note").textContent}`;
      if (s % 3 === 0) i++;
    };
    q(".progress .headline").textContent = phase === "analyze" ? "Studying your photo" : "Building your model";
    tick(); ticker = window.setInterval(tick, 1000);
  };
  const goBusy = (on: boolean) => {
    busy = on;
    q<HTMLButtonElement>(".go").disabled = on;
    q<HTMLButtonElement>(".go").hidden = on;
    q<HTMLButtonElement>(".restart").hidden = on;
    q<HTMLFieldSetElement>("fieldset").disabled = on;
  };
  const showReview = () => {
    const p = prepared!;
    setStep(1);
    q(".input-stage").hidden = true;
    const review = q(".review-stage"); review.hidden = false;
    review.innerHTML = `<h3>${esc(p.title)}</h3><p class="sub">Quick size check, in inches. Sizes marked <i>~</i> are estimates; type over any you know.</p>
      <div class="dims">${AXES.map(axis => `<label class="${estimated(p.dimensions[axis]) ? "est" : ""}"><span>${LABELS[axis]}</span><input aria-label="${LABELS[axis]} in inches" type="number" min="2" max="196" step="0.1" data-axis="${axis}" value="${inches(p.dimensions[axis].valueM)}" /><i title="${esc(SOURCES[estimated(p.dimensions[axis]) ? "estimated" : p.dimensions[axis].source])}">${estimated(p.dimensions[axis]) ? "~" : "✓"}</i></label>`).join("")}</div>
      ${p.warnings.length ? `<details class="more"><summary>Notes (${p.warnings.length})</summary><ul>${p.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}`;
    q<HTMLButtonElement>(".go").textContent = "Looks right — build it";
  };
  const run = async () => {
    if (busy || completed) return;
    status("");
    goBusy(true);
    try {
      if (!prepared) {
        const file = q<HTMLInputElement>(".image").files?.[0];
        if (!file) throw new Error("Add a product photo first — a link alone can't build a model yet.");
        sourceUrl = q<HTMLInputElement>(".url").value.trim();
        if (sourceUrl) { const u = new URL(sourceUrl); if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new Error("Use a public http(s) product link."); }
        const priceText = q<HTMLInputElement>(".price").value.trim();
        price = priceText ? Number(priceText) : null;
        if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error("Enter a price of 0 or more, or leave it blank.");
        const imageDataUrl = await furnitureImageDataUrl(file);
        started = performance.now();
        progress("analyze");
        prepared = await api.prepare({ imageDataUrl, sourceUrl: sourceUrl || undefined, productText: q<HTMLTextAreaElement>(".specs").value, categoryHint: sourceProduct?.category, mode: "live" });
        progress(null);
        productId = sourceProduct?.id || (sourceUrl ? await stableProductId(sourceUrl) : `generated-${prepared.importId}`);
        showReview();
        // Analysis finished while tucked away: the shopper has to come back and confirm sizes.
        if (root.hidden) showDock(`${prepared.title} is ready to build`, "Check the sizes, then build it", "ready");
        return;
      }
      if (!activeJob || activeJob.status === "failed") {
        const request = reviewedRequest(prepared, productId, AXES.map(axis => Number(q<HTMLInputElement>(`[data-axis="${axis}"]`).value) * IN));
        started = performance.now();
        progress("build", "Sending your sizes to the workshop…");
        activeJob = await api.generate(request);
      } else { started = performance.now(); progress("build"); }
      setStep(2);
      activeJob = await waitForGeneration(activeJob, api, job => {
        activeJob = job;
        if (job.status === "queued") progress("build", "Waiting for a free workbench…");
        else if (job.status === "ready") progress("build", "Carrying it into your room…");
        else if (q(".progress .note").textContent?.startsWith("Waiting") || q(".progress .note").textContent?.startsWith("Sending")) progress("build");
      });
      const asset = { ...activeJob.asset!, disclosure: `${activeJob.asset!.disclosure} ${dimensionDisclosure(activeJob.dimensions)} ${price === null || price <= 0 ? "" : "Price supplied by the user, not checked live."}` };
      await onImported({ asset, product: generatedProduct(prepared, asset, price, sourceUrl, sourceProduct) });
      completed = true;
      progress(null);
      q("fieldset").hidden = true;
      q(".done").hidden = false;
      q(".done b").textContent = prepared.title;
      status(`Added to your room.`, "ok");
      goBusy(false);
      const go = q<HTMLButtonElement>(".go");
      go.textContent = "Done"; go.onclick = close;
      if (root.hidden) showDock(`${prepared.title} is in your room`, "Drag it wherever you like", "ok"); else dock.hidden = true;
    } catch (e) {
      progress(null);
      status((e as Error).message, "err");
      if (root.hidden) showDock(`${dockTitle()} needs a look`, (e as Error).message, "err");
      q<HTMLButtonElement>(".go").textContent = activeJob ? activeJob.status === "failed" ? "Try the build again" : "Check on the build" : prepared ? "Looks right — build it" : "Generate";
    } finally {
      if (!completed) goBusy(false);
      if (activeJob && activeJob.status !== "failed") q<HTMLFieldSetElement>("fieldset").disabled = true;
    }
  };
  const open = (input?: string | ImportSeed) => {
    root.hidden = false;
    if (root.children.length && !completed) {
      if (input && (busy || prepared)) {
        const same = typeof input === "string" ? input === sourceUrl : input.id === sourceProduct?.id;
        if (!same) status("Another item is still in progress. Finish it, or start over.", "err");
      } else if (input) prefill(input);
      return;
    }
    sourceProduct = undefined;
    prepared = null; activeJob = null; completed = false;
    clearInterval(ticker);
    root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Generate furniture">
      <button type="button" class="close" aria-label="Close">✕</button>
      <div class="steps" aria-hidden="true"><span class="on now">Photo</span><span>Size</span><span>Build</span></div>
      <h2><em>Bring it</em> into your room</h2>
      <fieldset><div class="input-stage">
        <label class="drop"><input class="image" type="file" accept="image/png,image/jpeg,image/webp" />
          <img class="preview" alt="" hidden />
          <span class="drop-body"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><path d="M12 4v11"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/></svg><b>Drop a product photo</b><small>or click to browse · PNG, JPEG, WebP</small></span></label>
        <div class="row">
          <input class="url" type="url" placeholder="Product link (optional)" />
          <input class="price" type="number" min="0" step="0.01" placeholder="$ price" />
        </div>
        <details class="more"><summary>Add sizes or notes</summary><textarea class="specs" rows="3" maxlength="6000" placeholder="Width 20 in, height 32 in, depth 22 in…"></textarea></details>
      </div><div class="review-stage" hidden></div></fieldset>
      <div class="progress" hidden>
        <div class="builder" aria-hidden="true"><i class="leg a"></i><i class="leg b"></i><i class="seat"></i><i class="back"></i><i class="cushion"></i><i class="shadow"></i></div>
        <div class="headline"></div><div class="note"></div><div class="clock"></div>
        <button type="button" class="minimize">Hide</button>
      </div>
      <div class="done" hidden><div class="check">✓</div><p><b></b> is in your room. Drag it wherever you like.</p></div>
      <div class="status" role="status" aria-live="polite" hidden></div>
      <div class="actions"><button type="button" class="primary go">Generate</button><button type="button" class="restart">Start over</button></div>
      <p class="foot">Your photo is sent to OpenAI for analysis.</p>
    </div>`;
    const image = q<HTMLInputElement>(".image"), drop = q(".drop");
    image.addEventListener("change", () => { photoLoad++; if (image.files?.[0]) { showPhoto(image.files[0]); q(".drop-body b").textContent = "Your photo"; } else clearPhoto(); });
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", e => {
      e.preventDefault(); drop.classList.remove("over");
      const file = e.dataTransfer?.files[0];
      if (!file || busy || prepared) return;
      photoLoad++;
      const list = new DataTransfer(); list.items.add(file); image.files = list.files; showPhoto(file);
      q(".drop-body b").textContent = "Your photo";
    });
    if (input) prefill(input);
    q(".close").addEventListener("click", close);
    q(".minimize").addEventListener("click", close);
    q(".restart").addEventListener("click", () => { if (!busy) { completed = true; open(); } });
    q(".go").addEventListener("click", run);
  };
  return { open };
}

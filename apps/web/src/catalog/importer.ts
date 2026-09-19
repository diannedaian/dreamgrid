// Image → Sol-authored geometry → size review → Blender job → real GLB in the room.
import type { DimensionReview, GenerateRequest, GenerationJob, PreparedImport } from "@contracts";
import { createGenerationClient, furnitureImageDataUrl, waitForGeneration } from "./generationClient";
import type { GeneratedEntry } from "./generatedCatalog";

const AXES = ["width", "height", "depth"] as const;
const LABELS = { width: "Width", height: "Height", depth: "Depth" };
const SOURCES = { product_text: "Provided specifications", product_url: "Product listing", image_label: "Image label", estimated: "Estimate — not measured", user: "Your measurement" };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const estimated = (m: DimensionReview["width"]) => m.source === "estimated" || /\b(estimat\w*|about|approx\w*|roughly)\b/i.test(m.evidence);

/** Keep unchanged dimensions exact; editing a guess does not make it measured. */
export function reviewedRequest(prepared: PreparedImport, productId: string, valuesCm: number[], measured: boolean[], acceptEstimated: boolean): GenerateRequest {
  const values = AXES.map((axis, i) => {
    const n = valuesCm[i] / 100;
    if (!Number.isFinite(n) || n < .05 || n > 5) throw new Error("Each dimension must be between 5 and 500 cm.");
    const original = prepared.dimensions[axis].valueM;
    return Math.abs(n - original) < .000001 ? original : n;
  });
  const estimatedAxes = AXES.filter((axis, i) => {
    const changed = values[i] !== prepared.dimensions[axis].valueM;
    return changed ? !measured[i] : estimated(prepared.dimensions[axis]);
  });
  if (estimatedAxes.length && !acceptEstimated) throw new Error("Please accept the estimated dimensions, or enter verified measurements.");
  return { importId: prepared.importId, productId, dimensions: { widthM: values[0], heightM: values[1], depthM: values[2] }, confirmed: true, acceptEstimated, estimatedAxes };
}

export function dimensionDisclosure(review: DimensionReview): string {
  return AXES.map(axis => `${LABELS[axis]}: ${(review[axis].valueM * 100).toFixed(2)} cm (${SOURCES[review[axis].source]}; ${review[axis].evidence})`).join(". ");
}

export function mountImporter(root: HTMLElement, onImported: (r: GeneratedEntry) => Promise<void>, api = createGenerationClient()): { open: (url?: string) => void } {
  let busy = false, prepared: PreparedImport | null = null, activeJob: GenerationJob | null = null;
  let productId = "", sourceUrl = "", price: number | null = null, completed = false;
  let started = 0;
  const close = () => { root.hidden = true; }; // Hide, don't abort paid work or discard progress.
  root.addEventListener("click", e => { if (e.target === root) close(); });
  window.addEventListener("keydown", e => { if (e.key === "Escape" && !root.hidden) close(); });
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const status = (text: string, kind = "working") => {
    const el = q(".status"); el.hidden = false; el.className = `status ${kind}`; el.textContent = text;
  };
  const goBusy = (on: boolean) => {
    busy = on;
    q<HTMLButtonElement>(".go").disabled = on;
    q<HTMLButtonElement>(".restart").disabled = on;
    q<HTMLFieldSetElement>("fieldset").disabled = on;
  };
  const showReview = () => {
    const p = prepared!;
    q(".input-stage").hidden = true;
    const review = q(".review-stage"); review.hidden = false;
    review.innerHTML = `<h3>${esc(p.title)}</h3><p class="sub">Review the outer size before building. All dimensions below are in centimeters.</p>
      ${AXES.map(axis => `<div class="dimension"><label>${LABELS[axis]} (cm)<input aria-label="${LABELS[axis]} in centimeters" type="number" min="5" max="500" step="any" data-axis="${axis}" value="${Number((p.dimensions[axis].valueM * 100).toFixed(5))}" /></label>
      <small>${esc(SOURCES[estimated(p.dimensions[axis]) ? "estimated" : p.dimensions[axis].source])}: ${esc(p.dimensions[axis].evidence)}</small>
      <label class="check"><input type="checkbox" data-measured="${axis}" /> My edited value is a verified measurement</label></div>`).join("")}
      <ul class="warnings">${p.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      <label class="check"><input type="checkbox" class="accept" /> I accept any estimated dimensions (not a fit guarantee).</label>`;
    q<HTMLButtonElement>(".go").textContent = "Generate & add to room";
  };
  const run = async () => {
    if (busy || completed) return;
    goBusy(true);
    let ticker: number | undefined;
    try {
      if (!prepared) {
        const file = q<HTMLInputElement>(".image").files?.[0];
        if (!file) throw new Error("Upload a product image first. A URL alone cannot generate a model yet.");
        sourceUrl = q<HTMLInputElement>(".url").value.trim();
        if (sourceUrl) { const u = new URL(sourceUrl); if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new Error("Use a public http(s) product link."); }
        const priceText = q<HTMLInputElement>(".price").value.trim();
        price = priceText ? Number(priceText) : null;
        if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error("Enter a non-negative price, or leave it blank.");
        const imageDataUrl = await furnitureImageDataUrl(file);
        started = performance.now();
        const analysisProgress = () => status(`Sol is analyzing the image and dimensions… ${Math.round((performance.now() - started) / 1000)}s elapsed. Usually about 1–2 minutes; you can close this panel and reopen it.`);
        analysisProgress(); ticker = window.setInterval(analysisProgress, 1000);
        prepared = await api.prepare({ imageDataUrl, sourceUrl: sourceUrl || undefined, productText: q<HTMLTextAreaElement>(".specs").value, mode: "live" });
        clearInterval(ticker); ticker = undefined;
        productId = `generated-${prepared.importId}`;
        showReview();
        status(`Analysis ready in ${Math.round((performance.now() - started) / 1000)}s${prepared.usage.cached ? " (cached)" : ""}. Confirm the size to continue.`, "ok");
        return;
      }
      if (!activeJob || activeJob.status === "failed") {
        const request = reviewedRequest(prepared, productId,
          AXES.map(axis => Number(q<HTMLInputElement>(`[data-axis="${axis}"]`).value)),
          AXES.map(axis => q<HTMLInputElement>(`[data-measured="${axis}"]`).checked), q<HTMLInputElement>(".accept").checked);
        status("Submitting the confirmed dimensions to Blender…");
        activeJob = await api.generate(request);
      }
      activeJob = await waitForGeneration(activeJob, api, job => {
        activeJob = job;
        status(job.status === "queued" ? "Waiting for the laptop's Blender worker…" : job.status === "generating" ? "Blender is building, coloring and validating your model…" : "Loading the finished GLB into your room…");
      });
      const asset = { ...activeJob.asset!, disclosure: `${activeJob.asset!.disclosure} ${dimensionDisclosure(activeJob.dimensions)} ${price === null ? "Price not provided; excluded from the subtotal." : "Price supplied by the user, not checked live."}` };
      await onImported({ asset, product: {
        id: productId, title: prepared.title, category: prepared.category, priceUsd: price ?? 0,
        merchant: sourceUrl ? new URL(sourceUrl).hostname : "Your image", sourceUrl, imageUrl: "",
        dimensionsM: asset.dimensionsM, styleTags: price === null ? ["price-not-provided"] : [], colorTags: [], modelAssetId: asset.id,
      } });
      completed = true;
      status(`Added “${prepared.title}” to the room. Drag or rotate it into place.`, "ok");
      q<HTMLButtonElement>(".go").hidden = true;
      q<HTMLButtonElement>(".cancel").textContent = "Done";
    } catch (e) {
      status((e as Error).message, "err");
      q<HTMLButtonElement>(".go").textContent = activeJob ? activeJob.status === "failed" ? "Retry Blender build" : "Resume / load model" : prepared ? "Generate & add to room" : "Analyze image";
    } finally {
      clearInterval(ticker); goBusy(false);
      if (activeJob && activeJob.status !== "failed") q<HTMLFieldSetElement>("fieldset").disabled = true;
    }
  };
  const open = (url?: string) => {
    root.hidden = false;
    if (root.children.length && !completed) {
      if (!busy && !prepared && url) q<HTMLInputElement>(".url").value = url;
      return;
    }
    prepared = null; activeJob = null; completed = false;
    root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Generate furniture">
      <button type="button" class="close" aria-label="Close">✕</button>
      <h2>Bring your furniture to life</h2>
      <p class="sub">Your image → Sol → Blender → a model in your room. No furniture templates.</p>
      <fieldset><div class="input-stage">
        <label>Product image<input class="image" type="file" accept="image/png,image/jpeg,image/webp" /></label>
        <p class="sub">PNG, JPEG or WebP, under 5 MB. This image is sent to OpenAI for analysis.</p>
        <label>Product link (optional)<input class="url" type="url" placeholder="https://…" value="${esc(url || "")}" /></label>
        <p class="sub">The link helps check dimensions. If a store blocks access, paste the specifications below.</p>
        <label>Specifications (optional)<textarea class="specs" rows="3" maxlength="6000" placeholder="Width 20 inches, height 32 inches, depth 22 inches…"></textarea></label>
        <label>Price in USD (optional)<input class="price" type="number" min="0" step="0.01" placeholder="Not provided" /></label>
      </div><div class="review-stage" hidden></div></fieldset>
      <div class="status" role="status" aria-live="polite" hidden></div>
      <div class="actions"><button type="button" class="primary go">Analyze image</button><button type="button" class="ghost cancel">Close</button><button type="button" class="ghost restart">Start over</button></div>
      <p class="sub footer">One paid analysis; no automatic retries. Closing this panel does not cancel backend work. Generated items are saved in this browser; the laptop backend must stay running to load them.</p>
    </div>`;
    q(".close").addEventListener("click", close); q(".cancel").addEventListener("click", close);
    q(".restart").addEventListener("click", () => { if (!busy) { completed = true; open(); } });
    q(".go").addEventListener("click", run);
  };
  return { open };
}

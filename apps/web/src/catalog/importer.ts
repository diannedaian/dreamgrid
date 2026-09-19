// "Add furniture": paste a product link; the dev server scrapes it, asks OpenAI for a FurnitureSpec,
// and returns a catalog entry. Progress and errors show inline.
import type { ModelAsset, Product } from "@contracts";

export type ImportResult = { product: Product; asset: ModelAsset; cost?: number; cached?: boolean; page?: { title: string; images: string[]; dimensionsText: string } };

/** POST a product link to the dev server; resolves with the new catalog entry (throws with a readable message). */
export async function importProductUrl(url: string): Promise<ImportResult> {
  const res = await fetch("/api/import-product", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  const json = (await res.json()) as ImportResult & { error?: string };
  if (!res.ok || json.error) throw new Error(json.error || `Import failed (${res.status})`);
  return json;
}

export function mountImporter(root: HTMLElement, onImported: (r: ImportResult) => void): { open: () => void } {
  const close = () => { root.hidden = true; };
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden) close(); });

  const open = () => {
    root.hidden = false;
    root.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Add furniture">
        <button type="button" class="close" aria-label="Close">✕</button>
        <h2>Add furniture from a link</h2>
        <p class="sub">Paste a product page. The agent reads its photos and listed dimensions, builds a simple 3D model, and adds it to the catalog.</p>
        <input type="url" class="url" placeholder="https://www.example.com/products/desk-lamp" autocomplete="off" />
        <div class="status" hidden></div>
        <div class="actions"><button type="button" class="primary go">Add</button><button type="button" class="ghost cancel">Cancel</button></div>
      </div>`;
    const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    const input = q<HTMLInputElement>(".url"), status = q(".status"), go = q<HTMLButtonElement>(".go");
    setTimeout(() => input.focus(), 0);
    q(".close").addEventListener("click", close);
    q(".cancel").addEventListener("click", close);
    const run = async () => {
      const url = input.value.trim();
      if (!/^https?:\/\//.test(url)) { status.hidden = false; status.textContent = "Paste a full link starting with http(s)://"; return; }
      go.disabled = true; input.disabled = true;
      status.hidden = false; status.className = "status working";
      const steps = ["Reading the page…", "Looking at the photos and dimensions…", "Building the model…"];
      let i = 0; status.textContent = steps[0];
      const tick = window.setInterval(() => { i = Math.min(steps.length - 1, i + 1); status.textContent = steps[i]; }, 4000);
      try {
        const json = await importProductUrl(url);
        status.className = "status ok";
        status.textContent = `Added "${json.product.title}"${json.cached ? " (from cache)" : json.cost != null ? ` · cost $${json.cost.toFixed(3)}` : ""}`;
        onImported(json);
        setTimeout(close, 900);
      } catch (e) {
        status.className = "status err";
        status.textContent = (e as Error).message;
        go.disabled = false; input.disabled = false;
      } finally { clearInterval(tick); }
    };
    go.addEventListener("click", run);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  };
  return { open };
}

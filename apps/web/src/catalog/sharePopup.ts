// Share popup: copies the view link, explains how friends use it, and links to the shopping list page.
import { copyText } from "../interactions/share";

export type SharePopupOptions = {
  /** Read-only room link to copy. */
  link: () => string;
  /** Shopping-list page for the current plan. */
  listUrl: () => string;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function mountSharePopup(root: HTMLElement, o: SharePopupOptions): { open: () => Promise<void> } {
  const close = () => { root.hidden = true; };
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden) close(); });

  const open = async () => {
    const link = o.link(), list = o.listUrl();
    const copied = await copyText(link);
    root.hidden = false;
    root.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Share your room">
        <button type="button" class="close" aria-label="Close">✕</button>
        <h2>Share your room</h2>
        <p class="status ${copied ? "ok" : "warn"}">${copied ? "✓ Link copied to your clipboard" : "Copy the link below"}</p>
        <code class="link">${esc(link)}</code>
        <div class="actions"><button type="button" class="primary copy">${copied ? "Copy again" : "Copy link"}</button></div>
        <h3>Shopping list</h3>
        <p class="sub">Everything in the room with real store links, prices and product photos. Its link is shareable too.</p>
        <div class="actions"><a class="primary list" href="${esc(list)}" target="_blank" rel="noopener">Open shopping list ↗</a><button type="button" class="ghost copy-list">Copy list link</button></div>
      </div>`;
    const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    q(".close").addEventListener("click", close);
    q(".copy").addEventListener("click", async () => { const ok = await copyText(link); q(".status").textContent = ok ? "✓ Link copied to your clipboard" : "Copy failed — select the link and copy it"; });
    q(".copy-list").addEventListener("click", async () => { const ok = await copyText(list); q(".copy-list").textContent = ok ? "Copied ✓" : "Copy failed"; setTimeout(() => (q(".copy-list").textContent = "Copy list link"), 1800); });
  };
  return { open };
}

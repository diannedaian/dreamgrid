// Collapsible right drawer for the budget: what the placed furniture costs against a budget the
// user types, cheaper same-category swaps from the catalog, and a per-store shopping plan to
// approve and copy. Everything is derived from the placed items + catalog on every change; the
// only state here is the budget number, the swaps applied so far, and the plan being reviewed.
// Vanilla-DOM port of the former React BudgetPanel / AlternativesList / ApprovalScreen.
import type { Product, RoomSpec, RoomState, SceneItem } from "@dreamgrid/contracts";

import type { Catalog } from "../catalog/catalog";
import { activeSwaps, applySwap, fitToBudget, rankAlternatives, revertSwaps, type Alternative } from "./alternatives";
import { roundUsd, summarizeBudget, type BudgetSummary } from "./budget";
import { formatSignedUsd, formatUsd } from "./format";
import { approvePlan, buildShoppingPlan, planToText, type ShoppingPlan } from "./shoppingPlan";

export type BudgetBarOptions = {
  room: RoomSpec;
  catalog: Catalog;
  /** The placed furniture right now (Cindy's placement controller owns it). */
  items: () => SceneItem[];
  budgetUsd: number;
  onBudgetChange: (budgetUsd: number) => void;
  /** Replace a placed item's product in the room, keeping its id, position and rotation. */
  swap: (sceneItemId: string, product: Product) => Promise<void>;
  copyText: (text: string) => Promise<boolean>;
  /** Called when this drawer opens, so the shop drawer can close (they share the right edge). */
  onOpen?: () => void;
};

export type BudgetBar = {
  /** Re-derive totals and alternatives (call after any room or catalog change). */
  refresh: () => void;
  setOpen: (on: boolean) => void;
  readonly budgetUsd: number;
  readonly summary: BudgetSummary;
};

const STATUS_LABEL = { under: "Under budget", "at-limit": "Right at budget", over: "Over budget" } as const;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const IN = 0.0254;

export function mountBudgetBar(bar: HTMLElement, chip: HTMLButtonElement, o: BudgetBarOptions): BudgetBar {
  let budgetUsd = Number.isFinite(o.budgetUsd) ? Math.max(0, roundUsd(o.budgetUsd)) : 0;
  let swapsApplied: Alternative[] = [];
  let fitMessage = "";
  let plan: ShoppingPlan | undefined;
  let busy = false;

  bar.hidden = false;
  chip.hidden = false;
  const setOpen = (on: boolean) => {
    if (on) o.onOpen?.();
    document.body.classList.toggle("budgetbar-open", on);
    if (on) setTimeout(() => bar.querySelector<HTMLInputElement>(".amount")?.focus(), 250);
  };
  chip.addEventListener("click", () => setOpen(!document.body.classList.contains("budgetbar-open")));

  bar.innerHTML = `
    <div class="head"><button type="button" class="collapse" title="Close">›</button><h2>Budget</h2></div>
    <div class="pane budget"></div>`;
  const pane = bar.querySelector<HTMLElement>(".pane")!;
  bar.querySelector(".collapse")!.addEventListener("click", () => setOpen(false));

  const products = (): Product[] => o.catalog.allProducts();
  const canReplace = (p: Product) => o.catalog.entries().some(e => e.product.id === p.id && e.asset?.status === "ready");
  const state = (): RoomState => ({ room: o.room, budgetUsd, items: o.items() });
  const summarize = () => summarizeBudget(state(), products());

  /** Move the room to `next` by swapping every item whose product changed (one at a time; models load). */
  const applyState = async (next: RoomState, additions: Alternative[] = [], undo = false) => {
    if (busy) return;
    const before = new Map(state().items.map((i) => [i.id, i.productId]));
    const catalog = new Map(products().map((p) => [p.id, p]));
    busy = true; fitMessage = ""; render();
    try {
      for (const item of next.items) {
        if (before.get(item.id) === item.productId) continue;
        const product = catalog.get(item.productId);
        if (!product) throw new Error("The replacement is no longer in the catalog.");
        await o.swap(item.id, product);
        if (undo) swapsApplied = swapsApplied.filter(s => s.sceneItemId !== item.id);
        else swapsApplied.push(...additions.filter(s => s.sceneItemId === item.id));
      }
      const summary = summarize();
      fitMessage = `${formatSignedUsd(summary.remainingUsd)} remaining on known prices.${summary.unpricedItemIds.length ? " Some prices are unknown; the budget is incomplete." : ""}`;
    } catch (error) {
      fitMessage = `Swap stopped: ${(error as Error).message} Completed swaps can still be undone.`;
    } finally { busy = false; render(); }
  };

  const chipLabel = (s: BudgetSummary) => {
    const label = chip.querySelector(".lbl") ?? chip; // the toolbar button keeps its icon; tests may mount a bare button
    chip.classList.remove("over", "under");
    if (budgetUsd <= 0) { label.textContent = "Budget"; return; }
    chip.classList.add(s.status === "over" ? "over" : "under");
    label.textContent = s.unpricedItemIds.length ? `Budget · ${s.unpricedItemIds.length} unpriced` : s.status === "over" ? `Budget · ${formatUsd(-s.remainingUsd)} over` : `Budget · ${formatUsd(s.remainingUsd)} left`;
  };

  // ── main pane ──────────────────────────────────────────────────────────────
  const renderBudget = () => {
    if (!busy) swapsApplied = activeSwaps(state(), swapsApplied);
    const s = summarize();
    const alts = rankAlternatives(state(), products(), canReplace);
    const pct = budgetUsd > 0 ? Math.min(100, (s.subtotalUsd / budgetUsd) * 100) : 0;
    const tone = budgetUsd > 0 ? s.status : "";
    const saved = swapsApplied.reduce((sum, x) => sum + x.savingsUsd, 0);
    pane.innerHTML = `
      <label class="amount-row"><span>My budget</span><span class="cur">$</span><input class="amount" type="number" min="0" step="0.01" value="${budgetUsd || ""}" placeholder="0" /></label>
      <div class="totals">
        <div><span>Known-price total</span><b class="subtotal">${formatUsd(s.subtotalUsd)}</b></div>
        <div><span>Remaining</span><b class="remaining ${tone}">${budgetUsd > 0 ? formatSignedUsd(s.remainingUsd) : "—"}</b></div>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Budget used"><div class="fill ${tone}" style="width:${pct}%"></div></div>
      <p class="status ${tone}">${s.unpricedItemIds.length ? "Incomplete budget: some prices are unknown." : budgetUsd > 0 ? STATUS_LABEL[s.status] : "Type a budget to see how this room measures up."}</p>
      ${s.unpricedItemIds.length ? `<p class="unpriced">${s.unpricedItemIds.length === 1 ? "1 item without a price is not counted." : `${s.unpricedItemIds.length} items without a price are not counted.`}</p>` : ""}
      ${s.lines.length ? `<ul class="lines">${s.lines.map((l) => `<li><span>${esc(l.product.title)}</span><span class="dots"></span><b>${formatUsd(l.product.priceUsd)}</b></li>`).join("")}</ul>` : `<p class="empty">No priced items placed yet. Drag furniture in from the catalog to include it here.</p>`}

      <h3>Cheaper alternatives</h3>
      <div class="agent-actions"><button type="button" class="find fit" ${s.status !== "over" || alts.length === 0 || busy ? "disabled" : ""}>Make this room fit my budget</button></div>
      ${fitMessage ? `<p class="fit-msg">${esc(fitMessage)}</p>` : ""}
      ${swapsApplied.length ? `<div class="applied"><p>${swapsApplied.length === 1 ? "1 swap applied" : `${swapsApplied.length} swaps applied`}, saving ${formatUsd(saved)}:</p><ul>${swapsApplied.map((x) => `<li>${esc(x.from.title)} → ${esc(x.to.title)} (${formatUsd(x.savingsUsd)})</li>`).join("")}</ul><button type="button" class="undo textlink" ${busy ? "disabled" : ""}>Swap everything back</button></div>` : ""}
      ${alts.length === 0 ? `<p class="empty">${s.lines.length ? "No cheaper options in the catalog for the items in this room. Search the shop (⌕) to add some." : "Place something first."}</p>` : `<div class="alts">${alts.slice(0, 12).map(alternativeCard).join("")}</div>`}

      <h3>Shopping plan</h3>
      <p class="sub">One list per store with links. Nothing is bought through DreamGrid.</p>
      <div class="agent-actions"><button type="button" class="find review" ${s.lines.length === 0 || busy ? "disabled" : ""}>Review shopping plan</button></div>`;

    const amount = pane.querySelector<HTMLInputElement>(".amount")!;
    amount.addEventListener("change", () => {
      budgetUsd = Number.isFinite(Number(amount.value)) ? Math.max(0, roundUsd(Number(amount.value))) : 0;
      fitMessage = "";
      o.onBudgetChange(budgetUsd);
      render();
    });
    amount.addEventListener("keydown", (e) => { if (e.key === "Enter") amount.blur(); });
    pane.querySelector(".fit")?.addEventListener("click", async () => {
      const r = fitToBudget(state(), products(), canReplace);
      await applyState(r.state, r.swaps);
    });
    pane.querySelector(".undo")?.addEventListener("click", async () => {
      const next = revertSwaps(state(), swapsApplied);
      await applyState(next, [], true);
    });
    pane.querySelectorAll<HTMLButtonElement>(".apply").forEach((btn) => btn.addEventListener("click", async () => {
      const a = alts[Number(btn.dataset.i)];
      if (!a) return;
      await applyState(applySwap(state(), a), [a]);
    }));
    pane.querySelector(".review")?.addEventListener("click", () => { plan = buildShoppingPlan(state(), products(), swapsApplied); render(); });
  };

  const alternativeCard = (a: Alternative, i: number) => {
    const [w, h, d] = a.to.dimensionsM.map((m) => Math.round(m / IN));
    return `
      <div class="alt">
        <div class="swap-line"><span class="from">${esc(a.from.title)}</span><span class="arrow">→</span><span class="to">${esc(a.to.title)}</span></div>
        <div class="meta"><span class="price">${formatUsd(a.from.priceUsd)} → <b>${formatUsd(a.to.priceUsd)}</b></span><span class="dims">${w}″ × ${d}″ × ${h}″</span></div>
        <div class="why">${a.reasons.filter((r) => !r.startsWith("Same category")).map(esc).join(" · ")}</div>
        <div class="actions"><button type="button" class="apply add" data-i="${i}" ${busy ? "disabled" : ""}>Swap in (save ${formatUsd(a.savingsUsd)})</button></div>
      </div>`;
  };

  // ── plan review / approval ─────────────────────────────────────────────────
  const renderPlan = (p: ShoppingPlan) => {
    const approved = p.status === "approved";
    pane.innerHTML = `
      <h3>${approved ? "Plan approved" : "Review your shopping plan"}</h3>
      <div class="totals">
        <div><span>Total</span><b>${formatUsd(p.totalUsd)}</b></div>
        <div><span>Budget</span><b>${p.budgetUsd > 0 ? formatUsd(p.budgetUsd) : "—"}</b></div>
        <div><span>Remaining</span><b class="${p.budgetStatus}">${p.budgetUsd > 0 ? formatSignedUsd(p.remainingUsd) : "—"}</b></div>
        ${p.savedUsd > 0 ? `<div><span>Saved by swaps</span><b class="under">${formatUsd(p.savedUsd)}</b></div>` : ""}
      </div>
      ${p.groups.map((g) => `
        <div class="merchant">
          <h4>${esc(g.merchant)}<span>${formatUsd(g.subtotalUsd)}</span></h4>
          <ul>${g.lines.map((l) => `<li>${l.product.sourceUrl && /^https?:/.test(l.product.sourceUrl) ? `<a href="${esc(l.product.sourceUrl)}" target="_blank" rel="noopener">${esc(l.product.title)}</a>` : `<span>${esc(l.product.title)}</span>`}${l.quantity > 1 ? ` <em>×${l.quantity}</em>` : ""}<span class="dots"></span><b>${formatUsd(l.lineTotalUsd)}</b></li>`).join("")}</ul>
        </div>`).join("")}
      ${p.unpricedItemCount > 0 ? `<p class="unpriced">${p.unpricedItemCount} item(s) without a price are not included.</p>` : ""}
      ${approved
        ? `<p class="sub">Your plan is approved for this session. Open each store link above to buy the items yourself; DreamGrid does not place orders.</p>
           <div class="agent-actions"><button type="button" class="find copy">Copy plan as text</button><button type="button" class="ghost back">Back to budget</button></div>`
        : `<p class="sub">Approving freezes this list with links to each store. Nothing is purchased through DreamGrid and no payment details are collected.</p>
           <div class="agent-actions"><button type="button" class="find approve">Approve plan</button><button type="button" class="ghost back">Back</button></div>`}`;
    pane.querySelector(".approve")?.addEventListener("click", () => { plan = approvePlan(p); render(); });
    pane.querySelector(".back")?.addEventListener("click", () => { plan = undefined; render(); });
    pane.querySelector<HTMLButtonElement>(".copy")?.addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.textContent = (await o.copyText(planToText(p))) ? "Copied" : "Copy failed";
      setTimeout(() => (b.textContent = "Copy plan as text"), 1800);
    });
  };

  const render = () => {
    chipLabel(summarize());
    if (plan) renderPlan(plan); else renderBudget();
  };
  render();

  return {
    refresh: () => {
      // A room edit while reviewing: the plan is stale, go back to the live numbers.
      if (plan) plan = undefined;
      render();
    },
    setOpen,
    get budgetUsd() { return budgetUsd; },
    get summary() { return summarize(); },
  };
}

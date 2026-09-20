// Checkout sheet: pick a card, approve with a passkey, watch the payment go through, get a receipt.
// Same footprint as the Generate panel. The network is a test network (Visa Acceptance's test host,
// or DreamGrid's local sandbox); no money moves — but every step here is a real call.
import type { ShoppingPlan } from "./shoppingPlan";
import { formatUsd } from "./format";
import { localhostUrl, paymentPlanFrom, planIdempotencyKey, providerLabel, type PaymentIntent, type PaymentsClient, type WalletCard } from "./payments";

export type CheckoutOptions = {
  payments: PaymentsClient;
  copyText: (text: string) => Promise<boolean>;
};

export type Checkout = {
  /** Start a purchase for this plan. */
  open: (plan: ShoppingPlan) => void;
  /** Reopen the sheet on the receipt of an existing intent. */
  showReceipt: (plan: ShoppingPlan, intent: PaymentIntent) => void;
  close: () => void;
  /** Subscribe to intent changes (authorized, captured, refunded, declined, cleared) with the plan they belong to. */
  onIntent: (listener: (intent: PaymentIntent | undefined, plan: ShoppingPlan | undefined) => void) => void;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const FALLBACK_WALLET: WalletCard[] = [
  { id: "visa-1111", brand: "Visa", label: "DreamGrid Visa", last4: "1111", holder: "DIANNE D", expires: "12/31" },
  { id: "visa-3705", brand: "Visa", label: "Visa Signature", last4: "3705", holder: "DIANNE D", expires: "12/31" },
];

type Step = { key: string; label: string; state: "todo" | "doing" | "done" | "failed" };

export function mountCheckout(root: HTMLElement, o: CheckoutOptions): Checkout {
  let plan: ShoppingPlan | undefined;
  let intent: PaymentIntent | undefined;
  let wallet: WalletCard[] = FALLBACK_WALLET;
  let cardId = wallet[0].id;
  let capUsd = 0;
  let error = "";
  let busy = false;
  let steps: Step[] = [];
  const listeners = new Set<(intent: PaymentIntent | undefined, plan: ShoppingPlan | undefined) => void>();
  const emit = (next: PaymentIntent | undefined) => { intent = next; for (const l of listeners) l(next, plan); };
  void o.payments.wallet().then((cards) => { if (cards.length) { wallet = cards; if (!wallet.some((c) => c.id === cardId)) cardId = wallet[0].id; render(); } }).catch(() => {});

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const close = () => { if (!busy) root.hidden = true; };
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden) close(); });

  const itemCount = (p: ShoppingPlan) => p.groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + l.quantity, 0), 0);
  const cardEl = (c: WalletCard, selected: boolean, compact = false) => `
    <div class="wcard ${selected ? "on" : ""} ${compact ? "compact" : ""} ${c.id}" data-card="${esc(c.id)}" role="radio" aria-checked="${selected}" tabindex="0">
      <span class="chip"></span><span class="brand">${esc(c.brand.toUpperCase())}</span>
      <span class="num">•••• •••• •••• ${esc(c.last4)}</span>
      <span class="holder">${esc(c.holder)}</span><span class="exp">${esc(c.expires)}</span>
      <span class="wlabel">${esc(c.label)}</span>
    </div>`;

  // ── step 1: pay ─────────────────────────────────────────────────────────────
  const renderPay = (p: ShoppingPlan) => {
    if (capUsd < p.totalUsd) capUsd = Math.ceil(p.totalUsd / 10) * 10 || p.totalUsd;
    const support = o.payments.passkeySupport();
    const passkey = support === "available";
    const stores = [...new Set(p.groups.map((g) => g.merchant || "Unknown store"))];
    root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Checkout">
      <button type="button" class="close" aria-label="Close">✕</button>
      <div class="steps" aria-hidden="true"><span class="on now">Pay</span><span>Confirm</span><span>Done</span></div>
      <h2><em>Check out</em></h2>
      <div class="order">
        <div><b>${formatUsd(p.totalUsd)}</b><span>${itemCount(p)} ${itemCount(p) === 1 ? "item" : "items"} · ${stores.length === 1 ? esc(stores[0]) : `${stores.length} stores`}</span></div>
        <details><summary>Items</summary><ul>${p.groups.flatMap((g) => g.lines.map((l) => `<li><span>${esc(l.product.title)}${l.quantity > 1 ? ` ×${l.quantity}` : ""}</span><b>${formatUsd(l.lineTotalUsd)}</b></li>`)).join("")}</ul></details>
      </div>
      <h3>Pay with</h3>
      <div class="wallet" role="radiogroup">${wallet.map((c) => cardEl(c, c.id === cardId)).join("")}</div>
      <div class="cap-row"><span>Agent may spend up to</span><label><span class="cur">$</span><input class="cap" type="number" min="${p.totalUsd}" step="1" value="${capUsd}" /></label></div>
      ${error ? `<p class="pay-error">${esc(error)}</p>` : ""}
      ${support === "ip-host" ? `<p class="hint">Passkeys need a hostname. <a href="${esc(localhostUrl())}">Open at localhost</a> for Touch ID, or pay without one.</p>` : ""}
      <div class="actions">
        ${passkey ? `<button type="button" class="primary pay passkey"><svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="4" y="11" width="16" height="10" rx="2"/></svg>Pay ${formatUsd(p.totalUsd)} with passkey</button>` : `<button type="button" class="primary pay confirm">Pay ${formatUsd(p.totalUsd)}</button>`}
        ${passkey ? `<button type="button" class="textlink pay confirm">Pay without passkey</button>` : ""}
      </div>
      <p class="foot">Test network · ${esc(wallet.find((c) => c.id === cardId)?.brand ?? "Visa")} •••• ${esc(wallet.find((c) => c.id === cardId)?.last4 ?? "")} · no money moves</p>
    </div>`;
    root.querySelectorAll<HTMLElement>(".wcard").forEach((el) => {
      const pick = () => { cardId = el.dataset.card!; renderPay(p); };
      el.addEventListener("click", pick);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
    q<HTMLInputElement>(".cap").addEventListener("change", (e) => {
      const v = Number((e.currentTarget as HTMLInputElement).value);
      capUsd = Number.isFinite(v) ? Math.max(p.totalUsd, Math.round(v * 100) / 100) : p.totalUsd;
      (e.currentTarget as HTMLInputElement).value = String(capUsd);
    });
    q(".close").addEventListener("click", close);
    q(".pay.passkey")?.addEventListener("click", () => void pay(p, "passkey"));
    q(".pay.confirm")?.addEventListener("click", () => void pay(p, "confirm"));
  };

  // ── step 2: processing ──────────────────────────────────────────────────────
  const renderProcessing = (p: ShoppingPlan, headline: string) => {
    const card = wallet.find((c) => c.id === cardId) ?? wallet[0];
    root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Paying">
      <div class="steps" aria-hidden="true"><span class="on">Pay</span><span class="on now">Confirm</span><span>Done</span></div>
      <div class="processing">
        <div class="tap">${cardEl(card, true, true)}<span class="ring"></span><span class="ring r2"></span></div>
        <div class="headline">${esc(headline)}</div>
        <div class="amount">${formatUsd(p.totalUsd)}</div>
        <ol class="checks">${steps.map((s) => `<li class="${s.state}"><i></i>${esc(s.label)}</li>`).join("")}</ol>
      </div>
    </div>`;
  };
  const setStep = (key: string, state: Step["state"]) => { steps = steps.map((s) => (s.key === key ? { ...s, state } : s)); const li = root.querySelector(`.checks li:nth-child(${steps.findIndex((s) => s.key === key) + 1})`); if (li) li.className = state; };

  const pay = async (p: ShoppingPlan, method: "passkey" | "confirm") => {
    if (busy) return;
    busy = true; error = "";
    steps = [
      { key: "consent", label: method === "passkey" ? "Approved with your passkey" : "Plan approved", state: "doing" },
      { key: "mandate", label: "Spending mandate checked", state: "todo" },
      { key: "auth", label: "Authorized on the network", state: "todo" },
      { key: "capture", label: "Payment captured", state: "todo" },
    ];
    renderProcessing(p, method === "passkey" ? "Confirm with Touch ID…" : "Confirming…");
    try {
      const request = paymentPlanFrom(p, capUsd, cardId);
      const consent = method === "passkey" ? await o.payments.approveWithPasskey(request) : await o.payments.approveWithConfirm(request);
      setStep("consent", "done"); setStep("mandate", "doing");
      q(".headline").textContent = "Talking to the network…";
      await pause(350);
      const result = await o.payments.createIntent(request, consent, await planIdempotencyKey(request, p.createdAt));
      if (result.status === "declined") {
        setStep("mandate", result.declineCode === "NETWORK_DECLINED" ? "done" : "failed");
        if (result.declineCode === "NETWORK_DECLINED") setStep("auth", "failed");
        await pause(500);
        emit(result);
        renderDone(p, result);
        return;
      }
      setStep("mandate", "done"); setStep("auth", "done"); setStep("capture", "doing");
      q(".headline").textContent = result.provider === "visa-acceptance-sandbox" ? "Visa authorized · capturing…" : "Authorized · capturing…";
      await pause(450);
      const captured = await o.payments.capture(result.intentId);
      setStep("capture", "done");
      await pause(400);
      emit(captured);
      renderDone(p, captured);
    } catch (e) {
      error = (e as Error).message;
      renderPay(p);
    } finally { busy = false; }
  };

  // ── step 3: done / receipt ──────────────────────────────────────────────────
  const renderDone = (p: ShoppingPlan, i: PaymentIntent) => {
    const declined = i.status === "declined";
    const refunded = i.status === "reversed";
    const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const card = wallet.find((c) => c.id === i.cardId) ?? { brand: i.cardBrand ?? "Visa", last4: i.cardLast4 ?? "" };
    root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Receipt">
      <button type="button" class="close" aria-label="Close">✕</button>
      <div class="steps" aria-hidden="true"><span class="on">Pay</span><span class="on">Confirm</span><span class="on now">Done</span></div>
      <div class="result ${i.status}">
        <div class="mark">${declined ? "✕" : refunded ? "↩" : "✓"}</div>
        <div class="big">${declined ? "Declined" : refunded ? "Refunded" : i.status === "authorized" ? "Authorized" : "Paid"}</div>
        <div class="amt">${formatUsd(Number(i.amountUsd))}</div>
        <div class="via">${declined ? esc(i.declineReason || i.declineCode || "") : `${esc(card.brand)} •••• ${esc(card.last4)} · ${esc(providerLabel(i))}${i.approvalCode ? ` · approval ${esc(i.approvalCode)}` : ""}`}</div>
      </div>
      ${declined ? "" : `<ul class="mini">${receiptLines(p, i).map((l) => `<li><span>${esc(l.title)}${l.quantity > 1 ? ` ×${l.quantity}` : ""}</span><em>${esc(l.merchant)}</em><b>${formatUsd(l.totalUsd)}</b></li>`).join("")}</ul>`}
      <details class="more"><summary>Receipt details</summary>
        <dl>
          <dt>Intent</dt><dd><code>${esc(i.intentId)}</code></dd>
          ${i.networkReference ? `<dt>Visa transaction</dt><dd><code>${esc(i.networkReference)}</code></dd>` : ""}
          <dt>Approved by</dt><dd>${i.consentMethod === "passkey" ? `Passkey${i.userVerified ? " · verified" : ""}` : "Confirmation"}</dd>
          <dt>Mandate</dt><dd>up to ${formatUsd(Number(i.mandateMaxUsd))} · ${i.merchants.map(esc).join(", ")} · until ${when(i.mandateExpiresAt)}</dd>
          <dt>Network</dt><dd>${esc(providerLabel(i))} <span class="tag">test</span>${i.fallbackReason ? " · Visa test host unreachable, local sandbox stood in" : ""}</dd>
          ${i.token ? `<dt>Token</dt><dd><code title="${esc(i.token)}">${esc(i.token.slice(0, 16))}…${esc(i.token.slice(-6))}</code> <button type="button" class="textlink copy-token">Copy</button></dd>` : ""}
          <dt>Timeline</dt><dd>${i.history.map((h) => `${esc(h.status)} · ${when(h.at)}`).join("<br>")}</dd>
        </dl>
      </details>
      ${error ? `<p class="pay-error">${esc(error)}</p>` : ""}
      <div class="actions">
        <button type="button" class="primary done">${declined ? "Fix the plan" : "Done"}</button>
        ${i.status === "captured" || i.status === "authorized" ? `<button type="button" class="textlink refund">${i.status === "captured" ? "Refund" : "Release hold"}</button>` : ""}
      </div>
      <p class="foot">Test network · no money moved</p>
    </div>`;
    q(".close").addEventListener("click", close);
    q(".done").addEventListener("click", () => { if (declined) emit(undefined); root.hidden = true; });
    q(".refund")?.addEventListener("click", async () => {
      if (busy) return; busy = true; error = "";
      try { const next = await o.payments.reverse(i.intentId); emit(next); renderDone(p, next); }
      catch (e) { error = (e as Error).message; renderDone(p, i); }
      finally { busy = false; }
    });
    q(".copy-token")?.addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.textContent = (await o.copyText(i.token || "")) ? "Copied" : "Copy failed";
      setTimeout(() => (b.textContent = "Copy"), 1600);
    });
  };

  const render = () => { if (root.hidden || !plan) return; if (intent) renderDone(plan, intent); else renderPay(plan); };

  return {
    open: (p) => { plan = p; intent = undefined; error = ""; capUsd = 0; root.hidden = false; renderPay(p); },
    showReceipt: (p, i) => { plan = p; intent = i; error = ""; root.hidden = false; renderDone(p, i); },
    close,
    onIntent: (listener) => { listeners.add(listener); },
  };
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A receipt lists what was actually paid for (the intent's lines), never the room as it is now. */
function receiptLines(plan: ShoppingPlan, intent: PaymentIntent): Array<{ title: string; merchant: string; quantity: number; totalUsd: number }> {
  if (intent.lines?.length) return intent.lines.map((l) => ({ title: l.title, merchant: l.merchant, quantity: l.quantity, totalUsd: Number(l.totalUsd ?? Number(l.unitPriceUsd) * l.quantity) }));
  return plan.groups.flatMap((g) => g.lines.map((l) => ({ title: l.product.title, merchant: g.merchant, quantity: l.quantity, totalUsd: l.lineTotalUsd })));
}

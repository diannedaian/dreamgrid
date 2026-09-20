import { describe, expect, it, vi } from "vitest";
import { createPaymentsClient, paymentPlanFrom, planIdempotencyKey, type PaymentIntent } from "./payments";
import { buildShoppingPlan } from "./shoppingPlan";
import { testProduct } from "./testFixtures";

const room = { widthM: 4, depthM: 4, heightM: 3, gridSizeM: .0254, lightingMode: "day" as const };
const desk = testProduct("desk", { title: "College desk", merchant: "Wayfair", priceUsd: 159 });
const chair = testProduct("chair", { title: "College chair", merchant: "Wayfair", priceUsd: 89 });
const lamp = testProduct("lamp", { title: "Arc lamp", merchant: "Target", priceUsd: 45.5 });
const unpriced = testProduct("bed", { title: "Chenille bed", merchant: "BB&B", priceUsd: 0, styleTags: ["price-not-provided"] });
const items = [desk, desk, chair, lamp, unpriced].map((p, i) => ({ id: `i${i}`, productId: p.id, modelAssetId: "", positionM: [0, 0, 0] as [number, number, number], rotationYDeg: 0 as const }));

describe("payment plan from a shopping plan", () => {
  it("lists only priced lines with quantities, derives merchants, and carries the room budget", () => {
    const plan = buildShoppingPlan({ room, budgetUsd: 500, items }, [desk, chair, lamp, unpriced]);
    const request = paymentPlanFrom(plan, 460);
    expect(request.lines).toEqual([
      { productId: "desk", title: "College desk", merchant: "Wayfair", unitPriceUsd: "159.00", quantity: 2 },
      { productId: "chair", title: "College chair", merchant: "Wayfair", unitPriceUsd: "89.00", quantity: 1 },
      { productId: "lamp", title: "Arc lamp", merchant: "Target", unitPriceUsd: "45.50", quantity: 1 },
    ]);
    expect(request.mandate).toEqual({ maxAmountUsd: "460.00", merchants: ["Wayfair", "Target"], validForMinutes: 1440, budgetUsd: "500.00" });
  });

  it("omits the budget when none was set and keys idempotency on plan + time", async () => {
    const plan = buildShoppingPlan({ room, budgetUsd: 0, items: items.slice(0, 1) }, [desk]);
    const request = paymentPlanFrom(plan, 159);
    expect(request.mandate.budgetUsd).toBeUndefined();
    const a = await planIdempotencyKey(request, "2026-09-20T00:00:00Z");
    expect(a).toBe(await planIdempotencyKey(request, "2026-09-20T00:00:00Z"));
    expect(a).not.toBe(await planIdempotencyKey(request, "2026-09-20T00:00:01Z"));
    expect(a).not.toBe(await planIdempotencyKey(paymentPlanFrom(plan, 200), "2026-09-20T00:00:00Z"));
  });
});

describe("payments client", () => {
  const intent: PaymentIntent = {
    intentId: "pi_1", status: "authorized", amountUsd: "248.00", currency: "USD", lines: [], merchants: ["Wayfair"],
    mandateMaxUsd: "250.00", mandateExpiresAt: "2026-09-21T00:00:00Z", consentMethod: "confirm", credentialId: null, userVerified: false,
    provider: "dreamgrid-sandbox", isSandbox: true, createdAt: "2026-09-20T00:00:00Z", token: "a.b.c", declineCode: null, declineReason: null, history: [],
  };
  const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

  it("gets a single-use challenge for a plain confirm and posts the intent, capture and reverse", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ challenge: "ch", planDigest: "d", rpId: "localhost", expiresAt: "x" }))
      .mockResolvedValueOnce(json(intent, 201))
      .mockResolvedValueOnce(json({ ...intent, status: "captured" }))
      .mockResolvedValueOnce(json({ ...intent, status: "reversed" }));
    const client = createPaymentsClient(fetcher, null);
    const plan = { lines: [], mandate: { maxAmountUsd: "1.00", merchants: ["x"], validForMinutes: 5 } };
    const consent = await client.approveWithConfirm(plan);
    expect(consent).toEqual({ challenge: "ch" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ plan, purpose: "approve" });
    expect((await client.createIntent(plan, consent, "key-12345678")).status).toBe("authorized");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ plan, consent, idempotencyKey: "key-12345678" });
    expect((await client.capture("pi_1")).status).toBe("captured");
    expect((await client.reverse("pi_1")).status).toBe("reversed");
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["/api/v1/payments/passkeys/challenge", "/api/v1/payments/intents", "/api/v1/payments/intents/pi_1/capture", "/api/v1/payments/intents/pi_1/reverse"]);
  });

  it("surfaces the API's decline detail and a clear message when the sandbox is down", async () => {
    const down = createPaymentsClient(vi.fn().mockRejectedValue(new TypeError("fetch failed")), null);
    await expect(down.ledger()).rejects.toThrow("payment sandbox is unreachable");
    const rejecting = createPaymentsClient(vi.fn().mockResolvedValue(json({ detail: "The plan changed after the challenge was issued." }, 400)), null);
    await expect(rejecting.createIntent({ lines: [], mandate: { maxAmountUsd: "1", merchants: ["x"], validForMinutes: 1 } }, { challenge: "c" }, "key-12345678")).rejects.toThrow("plan changed");
  });

  it("reports passkey support and remembers the enrolled credential per browser", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const client = createPaymentsClient(vi.fn(), storage);
    expect(client.passkeySupport()).toBe("unsupported"); // no WebAuthn in node
    expect(client.hasPasskey()).toBe(false);
    store.set("dreamgrid.passkey", "cred");
    expect(client.hasPasskey()).toBe(true);
    client.forgetPasskey();
    expect(client.hasPasskey()).toBe(false);
  });
});

// Agent payments (sandbox): turn an approved shopping plan into a spending mandate, prove consent
// with a platform passkey, and get back a signed sandbox payment intent from the API. No card data
// ever exists in the browser; the network moves no money and says so on every response.
import type { ShoppingPlan } from "./shoppingPlan";

export type PaymentLine = { productId: string; title: string; merchant: string; unitPriceUsd: string; quantity: number };
export type PaymentMandate = { maxAmountUsd: string; merchants: string[]; validForMinutes: number; budgetUsd?: string };
export type PaymentPlan = { lines: PaymentLine[]; mandate: PaymentMandate };

export type PaymentIntent = {
  intentId: string;
  status: "authorized" | "captured" | "reversed" | "declined";
  amountUsd: string;
  currency: string;
  lines: Array<PaymentLine & { totalUsd: string }>;
  merchants: string[];
  mandateMaxUsd: string;
  mandateExpiresAt: string;
  consentMethod: "passkey" | "confirm";
  credentialId: string | null;
  userVerified: boolean;
  provider: string;
  isSandbox: boolean;
  createdAt: string;
  token: string | null;
  declineCode: string | null;
  declineReason: string | null;
  history: Array<{ at: string; status: string }>;
  /** Present when a real network (Visa Acceptance test host) authorized the intent. */
  networkReference?: string | null;
  approvalCode?: string | null;
  /** Present when the external network was unreachable and the local sandbox stood in. */
  fallbackReason?: string | null;
};

/** Human label for the network that answered. */
export function providerLabel(intent: Pick<PaymentIntent, "provider">): string {
  return intent.provider === "visa-acceptance-sandbox" ? "Visa Acceptance" : "DreamGrid sandbox";
}

const usd = (n: number) => n.toFixed(2);

/** The exact plan the shopper approves: priced lines only, merchants derived from them. */
export function paymentPlanFrom(plan: ShoppingPlan, maxAmountUsd: number, validForMinutes = 24 * 60): PaymentPlan {
  const lines = plan.groups.flatMap((g) => g.lines.map((l) => ({
    productId: l.product.id, title: l.product.title, merchant: g.merchant || "Unknown store",
    unitPriceUsd: usd(l.product.priceUsd), quantity: l.quantity,
  })));
  const merchants = [...new Set(lines.map((l) => l.merchant))];
  return { lines, mandate: { maxAmountUsd: usd(maxAmountUsd), merchants, validForMinutes, ...(plan.budgetUsd > 0 ? { budgetUsd: usd(plan.budgetUsd) } : {}) } };
}

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

const CRED_KEY = "dreamgrid.passkey";

export type PasskeySupport = "available" | "ip-host" | "unsupported";

/** WebAuthn needs a real hostname as the relying-party ID: browsers reject IP literals like 127.0.0.1. */
export function passkeySupport(hostname = typeof location === "undefined" ? "" : location.hostname): PasskeySupport {
  if (typeof PublicKeyCredential === "undefined" || !navigator.credentials?.create) return "unsupported";
  return /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i.test(hostname) && hostname !== "localhost" ? "ip-host" : "available";
}

/** The same page served from `localhost`, where a passkey is allowed. */
export function localhostUrl(href = location.href): string {
  const u = new URL(href);
  u.hostname = "localhost";
  return u.toString();
}

export function createPaymentsClient(fetcher: typeof fetch = fetch, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof localStorage === "undefined" ? null : localStorage) {
  async function request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`/api/v1/payments${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("The payment sandbox is unreachable. Start the API on port 8000 and try again.");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.detail;
      throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((e: { msg: string }) => e.msg).join("; ") : "The payment sandbox rejected the request.");
    }
    return data as T;
  }

  const enrolledCredential = () => storage?.getItem(CRED_KEY) || null;

  /** Create a platform passkey once per browser and enrol its public key with the API. */
  async function enrollPasskey(): Promise<string> {
    const { challenge, rpId } = await request<{ challenge: string; rpId: string }>("/passkeys/challenge", { plan: { lines: [], mandate: { maxAmountUsd: "0", merchants: ["-"], validForMinutes: 1 } }, purpose: "register" });
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: unb64(challenge),
        rp: { id: rpId, name: "DreamGrid" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "shopper", displayName: "DreamGrid shopper" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
        timeout: 60_000,
      },
    }) as PublicKeyCredential | null;
    if (!credential) throw new Error("No passkey was created.");
    const att = credential.response as AuthenticatorAttestationResponse;
    const authenticatorData = att.getAuthenticatorData ? att.getAuthenticatorData() : authenticatorDataFromAttestation(att.attestationObject);
    const { credentialId } = await request<{ credentialId: string }>("/passkeys", {
      challenge, clientDataJson: b64(att.clientDataJSON), authenticatorData: b64(authenticatorData),
    });
    storage?.setItem(CRED_KEY, credentialId);
    return credentialId;
  }

  /** Sign a server challenge for this exact plan; enrols first if this browser has no passkey yet. */
  async function approveWithPasskey(plan: PaymentPlan): Promise<{ challenge: string; passkey: { credentialId: string; clientDataJson: string; authenticatorData: string; signature: string } }> {
    let credentialId = enrolledCredential();
    if (!credentialId) credentialId = await enrollPasskey();
    // The sandbox keeps enrolments in memory: after an API restart the browser may hold a passkey the
    // server no longer knows. Check first and enrol a fresh one instead of failing at approval time.
    if (!(await request<{ enrolled: boolean }>(`/passkeys/${encodeURIComponent(credentialId)}`)).enrolled) {
      storage?.removeItem(CRED_KEY);
      credentialId = await enrollPasskey();
    }
    const { challenge, rpId } = await request<{ challenge: string; rpId: string }>("/passkeys/challenge", { plan, purpose: "approve" });
    const assertion = await navigator.credentials.get({
      publicKey: { challenge: unb64(challenge), rpId, allowCredentials: [{ type: "public-key", id: unb64(credentialId) }], userVerification: "required", timeout: 60_000 },
    }) as PublicKeyCredential | null;
    if (!assertion) throw new Error("The passkey prompt was dismissed.");
    const res = assertion.response as AuthenticatorAssertionResponse;
    return { challenge, passkey: { credentialId: b64(assertion.rawId), clientDataJson: b64(res.clientDataJSON), authenticatorData: b64(res.authenticatorData), signature: b64(res.signature) } };
  }

  /** Plain confirm: still a server-issued, single-use challenge bound to the plan, just no biometrics. */
  async function approveWithConfirm(plan: PaymentPlan): Promise<{ challenge: string }> {
    const { challenge } = await request<{ challenge: string }>("/passkeys/challenge", { plan, purpose: "approve" });
    return { challenge };
  }

  return {
    passkeySupport,
    hasPasskey: () => !!enrolledCredential(),
    forgetPasskey: () => storage?.removeItem(CRED_KEY),
    approveWithPasskey,
    approveWithConfirm,
    createIntent: (plan: PaymentPlan, consent: { challenge: string; passkey?: unknown }, idempotencyKey: string) =>
      request<PaymentIntent>("/intents", { plan, consent, idempotencyKey }),
    capture: (intentId: string) => request<PaymentIntent>(`/intents/${encodeURIComponent(intentId)}/capture`, {}),
    reverse: (intentId: string) => request<PaymentIntent>(`/intents/${encodeURIComponent(intentId)}/reverse`, {}),
    get: (intentId: string) => request<PaymentIntent>(`/intents/${encodeURIComponent(intentId)}`),
    ledger: () => request<PaymentIntent[]>("/intents"),
    verifyToken: (token: string) => request<{ valid: boolean; payload: Record<string, unknown> | null }>("/tokens/verify", { token }),
  };
}

export type PaymentsClient = ReturnType<typeof createPaymentsClient>;

/** Fallback for browsers without getAuthenticatorData(): read authData out of the CBOR attestation object. */
function authenticatorDataFromAttestation(attestation: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(attestation);
  let pos = 0;
  const head = () => { const b = bytes[pos++]; const major = b >> 5, info = b & 0x1f; let arg = info; if (info === 24) arg = bytes[pos++]; else if (info === 25) { arg = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; } else if (info === 26) { arg = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; pos += 4; } return { major, arg }; };
  const skip = (): void => { const { major, arg } = head(); if (major === 2 || major === 3) pos += arg; else if (major === 4) for (let i = 0; i < arg; i++) skip(); else if (major === 5) for (let i = 0; i < arg; i++) { skip(); skip(); } };
  const top = head();
  if (top.major !== 5) throw new Error("Unexpected attestation object.");
  for (let i = 0; i < top.arg; i++) {
    const key = head();
    const name = new TextDecoder().decode(bytes.subarray(pos, pos + key.arg)); pos += key.arg;
    if (name === "authData") { const v = head(); return bytes.slice(pos, pos + v.arg).buffer; }
    skip();
  }
  throw new Error("Attestation object has no authData.");
}

/** Stable idempotency key for one approval of one plan (same plan twice in a row = same intent). */
export async function planIdempotencyKey(plan: PaymentPlan, createdAt: string): Promise<string> {
  const text = JSON.stringify(plan) + createdAt;
  if (!globalThis.crypto?.subtle) return `plan-${text.length}-${createdAt}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `plan-${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

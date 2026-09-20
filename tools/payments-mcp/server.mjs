#!/usr/bin/env node
// DreamGrid Payments MCP server (sandbox stub).
//
// A local Model Context Protocol server that gives an AI agent the same shape of payment
// tools Visa's MCP exposes (payment instruction → authorization → capture/reverse → ledger),
// backed by DreamGrid's own sandbox network at /api/v1/payments. No card network is called and
// no money moves; every result says `isSandbox: true`.
//
// Transport: stdio, newline-delimited JSON-RPC 2.0 (MCP 2024-11-05). Dependency-free.
//
//   DREAMGRID_API=http://127.0.0.1:8000 node tools/payments-mcp/server.mjs
//
// Claude Desktop / Claude Code / any MCP client: register this command as a stdio server.

import { createInterface } from "node:readline";

const API = (process.env.DREAMGRID_API || "http://127.0.0.1:8000").replace(/\/$/, "");
const PROTOCOL_VERSION = "2024-11-05";

// ── tools ────────────────────────────────────────────────────────────────────

const money = { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$", description: "USD amount as a decimal string, e.g. \"149.00\"" };

const planSchema = {
  type: "object",
  required: ["lines", "mandate"],
  properties: {
    lines: {
      type: "array",
      description: "Exactly what the shopper is buying. Only lines with a known positive price.",
      items: {
        type: "object",
        required: ["productId", "title", "merchant", "unitPriceUsd", "quantity"],
        properties: {
          productId: { type: "string" }, title: { type: "string" }, merchant: { type: "string" },
          unitPriceUsd: money, quantity: { type: "integer", minimum: 1 },
        },
      },
    },
    mandate: {
      type: "object",
      required: ["maxAmountUsd", "merchants"],
      description: "The shopper's spending mandate: cap, allowed stores, validity, optional room budget.",
      properties: {
        maxAmountUsd: money,
        merchants: { type: "array", items: { type: "string" } },
        validForMinutes: { type: "integer", minimum: 1, maximum: 10080, default: 1440 },
        budgetUsd: money,
      },
    },
  },
};

const TOOLS = [
  {
    name: "request_payment_instruction",
    description:
      "Step 1 of a purchase. Register the exact plan the shopper must approve and get a one-time approval challenge bound to it. " +
      "Show the shopper the plan and mandate; they approve in the DreamGrid UI (passkey) or, in the sandbox, by confirming. " +
      "Returns { challenge, planDigest, expiresAt }.",
    inputSchema: planSchema,
  },
  {
    name: "authorize_payment",
    description:
      "Step 2. Submit the approved plan with its challenge to the sandbox network. Checks the mandate (cap, merchants, expiry, room budget) " +
      "and returns a payment intent: status 'authorized' with a signed sandbox token, or 'declined' with a declineCode and reason. Idempotent per idempotencyKey.",
    inputSchema: {
      type: "object",
      required: ["plan", "challenge", "idempotencyKey"],
      properties: {
        plan: planSchema,
        challenge: { type: "string", description: "From request_payment_instruction" },
        idempotencyKey: { type: "string", minLength: 8, description: "Stable key for this approval; repeating it returns the same intent." },
        passkey: {
          type: "object",
          description: "Optional WebAuthn assertion when the shopper approved with a passkey (the DreamGrid UI supplies this).",
          properties: { credentialId: { type: "string" }, clientDataJson: { type: "string" }, authenticatorData: { type: "string" }, signature: { type: "string" } },
        },
      },
    },
  },
  {
    name: "capture_payment",
    description: "Step 3. Complete an authorized intent (the merchants get paid in the sandbox ledger).",
    inputSchema: { type: "object", required: ["intentId"], properties: { intentId: { type: "string" } } },
  },
  {
    name: "reverse_payment",
    description: "Release an authorized hold, or refund a captured intent. Nothing is charged afterwards.",
    inputSchema: { type: "object", required: ["intentId"], properties: { intentId: { type: "string" } } },
  },
  {
    name: "get_payment_intent",
    description: "Look up one payment intent and its status history.",
    inputSchema: { type: "object", required: ["intentId"], properties: { intentId: { type: "string" } } },
  },
  {
    name: "list_payment_ledger",
    description: "Every sandbox intent this network has issued, oldest first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "verify_payment_token",
    description: "Merchant-side check: is this token a genuine, unexpired DreamGrid sandbox payment token? Returns its payload if so.",
    inputSchema: { type: "object", required: ["token"], properties: { token: { type: "string" } } },
  },
];

async function api(path, body) {
  const response = await fetch(`${API}/api/v1/payments${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((e) => e.msg).join("; ") : `HTTP ${response.status}`);
  }
  return data;
}

const HANDLERS = {
  request_payment_instruction: (a) => api("/passkeys/challenge", { plan: a, purpose: "approve" }),
  authorize_payment: (a) => api("/intents", { plan: a.plan, consent: { challenge: a.challenge, ...(a.passkey ? { passkey: a.passkey } : {}) }, idempotencyKey: a.idempotencyKey }),
  capture_payment: (a) => api(`/intents/${encodeURIComponent(a.intentId)}/capture`, {}),
  reverse_payment: (a) => api(`/intents/${encodeURIComponent(a.intentId)}/reverse`, {}),
  get_payment_intent: (a) => api(`/intents/${encodeURIComponent(a.intentId)}`),
  list_payment_ledger: () => api("/intents"),
  verify_payment_token: (a) => api("/tokens/verify", { token: a.token }),
};

/** Human-readable first line so a chat agent can narrate, plus the full JSON for tool chaining. */
function summarize(name, result) {
  if (name === "authorize_payment" || name === "capture_payment" || name === "reverse_payment" || name === "get_payment_intent") {
    const r = result;
    return r.status === "declined"
      ? `DECLINED (${r.declineCode}): ${r.declineReason} — sandbox, nothing charged.`
      : `${r.status.toUpperCase()} $${r.amountUsd} across ${r.merchants.join(", ")} · intent ${r.intentId} · ${r.provider}${r.networkReference ? ` (Visa txn ${r.networkReference}, approval ${r.approvalCode ?? "n/a"})` : ""} · test network, no money moved.`;
  }
  if (name === "request_payment_instruction") return `Challenge issued for plan ${result.planDigest.slice(0, 12)}…; ask the shopper to approve.`;
  if (name === "list_payment_ledger") return `${result.length} sandbox intent(s).`;
  if (name === "verify_payment_token") return result.valid ? "Token is a valid DreamGrid sandbox payment token." : "Token is NOT valid.";
  return "";
}

// ── JSON-RPC over stdio ──────────────────────────────────────────────────────

export async function handle(message) {
  const { id, method, params } = message;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, msg) => ({ jsonrpc: "2.0", id, error: { code, message: msg } });
  switch (method) {
    case "initialize":
      return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "dreamgrid-payments-sandbox", version: "0.1.0" } });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const handler = HANDLERS[params?.name];
      if (!handler) return fail(-32602, `Unknown tool ${params?.name}`);
      try {
        const result = await handler(params.arguments ?? {});
        return reply({ content: [{ type: "text", text: `${summarize(params.name, result)}\n${JSON.stringify(result, null, 2)}` }], structuredContent: result, isError: false });
      } catch (error) {
        return reply({ content: [{ type: "text", text: `Payment sandbox error: ${error.message}` }], isError: true });
      }
    }
    default:
      return id === undefined ? null : fail(-32601, `Method not found: ${method}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`); return; }
    const response = await handle(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  process.stderr.write(`dreamgrid-payments-sandbox MCP server → ${API} (stdio)\n`);
}

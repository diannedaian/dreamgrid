// Drives the payments MCP server over stdio against a running API. Exits non-zero on any failure.
//   DREAMGRID_API=http://127.0.0.1:8000 node tools/payments-mcp/smoke.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const server = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
const pending = new Map();
let seq = 0;
createInterface({ input: server.stdout }).on("line", (line) => { const msg = JSON.parse(line); pending.get(msg.id)?.(msg); pending.delete(msg.id); });
const call = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); });
const tool = async (name, args) => { const r = await call("tools/call", { name, arguments: args }); assert(!r.error, JSON.stringify(r.error)); return r.result; };

try {
  const init = await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  assert.equal(init.result.serverInfo.name, "dreamgrid-payments-sandbox");
  const tools = (await call("tools/list")).result.tools.map((t) => t.name);
  assert.deepEqual(tools, ["request_payment_instruction", "authorize_payment", "capture_payment", "reverse_payment", "get_payment_intent", "list_payment_ledger", "verify_payment_token"]);

  const plan = {
    lines: [{ productId: "college-desk", title: "College desk", merchant: "DreamGrid Demo Catalog", unitPriceUsd: "159.00", quantity: 1 },
            { productId: "college-chair", title: "College chair", merchant: "DreamGrid Demo Catalog", unitPriceUsd: "89.00", quantity: 1 }],
    mandate: { maxAmountUsd: "250.00", merchants: ["DreamGrid Demo Catalog"], validForMinutes: 60, budgetUsd: "500.00" },
  };
  const key = `mcp-smoke-${Date.now()}`;
  const challenge = (await tool("request_payment_instruction", plan)).structuredContent.challenge;
  const auth = (await tool("authorize_payment", { plan, challenge, idempotencyKey: key })).structuredContent;
  assert.equal(auth.status, "authorized"); assert.equal(auth.amountUsd, "248.00"); assert.equal(auth.isSandbox, true);
  const again = (await tool("authorize_payment", { plan, challenge: (await tool("request_payment_instruction", plan)).structuredContent.challenge, idempotencyKey: key })).structuredContent;
  assert.equal(again.intentId, auth.intentId, "idempotency key returns the same intent");
  assert.equal((await tool("verify_payment_token", { token: auth.token })).structuredContent.valid, true);
  assert.equal((await tool("verify_payment_token", { token: `${auth.token}x` })).structuredContent.valid, false);
  assert.equal((await tool("capture_payment", { intentId: auth.intentId })).structuredContent.status, "captured");
  const reversed = await tool("reverse_payment", { intentId: auth.intentId });
  assert.equal(reversed.structuredContent.status, "reversed");
  assert.match(reversed.content[0].text, /REVERSED .*no money moved/);
  assert((await tool("list_payment_ledger", {})).structuredContent.some((i) => i.intentId === auth.intentId));

  const tight = { ...plan, mandate: { ...plan.mandate, maxAmountUsd: "200.00" } };
  const declined = (await tool("authorize_payment", { plan: tight, challenge: (await tool("request_payment_instruction", tight)).structuredContent.challenge, idempotencyKey: `${key}-tight` })).structuredContent;
  assert.equal(declined.status, "declined"); assert.equal(declined.declineCode, "MANDATE_EXCEEDED"); assert.equal(declined.token, null);

  // A challenge issued for one plan cannot authorize a different one.
  const stale = await tool("authorize_payment", { plan: tight, challenge, idempotencyKey: `${key}-stale` });
  assert.equal(stale.isError, true); assert.match(stale.content[0].text, /Unknown or already-used|changed/);

  const unknown = await call("tools/call", { name: "nope", arguments: {} });
  assert.equal(unknown.error.code, -32602);
  console.log(`PASS: MCP stdio → challenge → authorize (${auth.intentId}) → verify → capture → reverse → ledger → MANDATE_EXCEEDED decline → stale challenge rejected. Sandbox only, no money moved.`);
} finally {
  server.kill();
}

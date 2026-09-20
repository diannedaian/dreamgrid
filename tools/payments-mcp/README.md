# DreamGrid Payments MCP server (sandbox)

A local, dependency-free [Model Context Protocol](https://modelcontextprotocol.io) server that
lets an AI agent run the DreamGrid purchase flow with tools shaped like Visa Intelligent
Commerce's (payment instruction → authorization → capture / reverse → ledger). It is a thin
wrapper over `services/api` `/api/v1/payments`, which is an in-process **sandbox**: no card
network is contacted and no money moves. Every result carries `provider: "dreamgrid-sandbox"`
and `isSandbox: true`.

## Run

```bash
pnpm dev:api                                   # FastAPI on :8000
DREAMGRID_API=http://127.0.0.1:8000 node tools/payments-mcp/server.mjs
```

Register it as a stdio server in any MCP client, e.g. Claude Desktop:

```json
{ "mcpServers": { "dreamgrid-payments": { "command": "node", "args": ["/abs/path/DreamGrid/tools/payments-mcp/server.mjs"], "env": { "DREAMGRID_API": "http://127.0.0.1:8000" } } } }
```

## Tools

| Tool | What it does |
| --- | --- |
| `request_payment_instruction` | Registers the exact plan + mandate, returns a one-time challenge bound to the plan digest |
| `authorize_payment` | Submits plan + challenge (+ optional passkey assertion); returns `authorized` with a signed token or `declined` with a code |
| `capture_payment` | Completes an authorized intent |
| `reverse_payment` | Releases a hold / refunds a capture |
| `get_payment_intent` / `list_payment_ledger` | Read the ledger |
| `verify_payment_token` | Merchant-side check that a token is genuine and unexpired |

Decline codes: `MANDATE_EXCEEDED`, `BUDGET_EXCEEDED`, `MANDATE_EXPIRED`, `MERCHANT_NOT_ALLOWED`,
`CONSENT_INVALID`, `EMPTY_PLAN`, `UNPRICED_LINE`. A challenge is single-use and rejected if the
plan changed after it was issued, so an agent cannot swap items between approval and payment.

## Smoke test

`node tools/payments-mcp/smoke.mjs` drives the server over stdio against a running API:
list tools → challenge → authorize → verify token → capture → reverse → a deliberate
over-mandate decline.

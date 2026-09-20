# Commerce ownership: Linda

Budget, sourcing, cheaper alternatives, undo and shopping-plan approval consume
shared product and placed-room state. The current client is vanilla TypeScript.
Do not implement 3D manipulation or model generation here.

## Integrated flow

The existing Shopping agent and Shopping list tabs remain in the right drawer.
**Source products** adds Linda's region/budget/size-aware search and URL reader.
Each result card has one button, **+ Add furniture**, which reads the listing once
(no AI spend) and opens the shared Generate panel seeded with the listing photo
(pulled through `GET /api/v1/products/photo`), link, known price, category and
"Listed size" notes. The user just hits Generate; there is no intermediate form or
catalog entry. If the store blocks its photo, the dropzone asks for one instead.
Generated products reuse the sourcing ID `imp-<sha1(url)[:16]>`; adding the same
listing again opens its existing catalog card rather than paying for a new model.
Sourcing never calls `/api/import-product` or substitutes a box for a failed model.
`productForm.ts` and `catalogAdd.ts` remain as tested, currently unmounted modules.
Live search fills missing photos from the listing's JSON-LD/OpenGraph metadata
without extra AI calls. Relative image URLs are resolved against the listing;
blocked pages or failed image downloads show “Photo unavailable,” not an empty card.

`catalogAdd.ts` preserves a ready model and its reviewed dimensions when the same
source is added again. Generated metadata uses `dreamgrid.generated-catalog.v1`;
sourced product details use `dreamgrid.products`. Both are browser-local. The GLB
still lives on the laptop API. Cross-browser sharing of generated products remains
unfinished; curated room and shopping-list links still work.

## Budget and swaps

The Budget action opens the budget drawer. Budget is saved as optional `Plan.b`
in USD cents precision. Totals derive from all catalog products and placed items,
including hidden cards and duplicate quantities. Missing products, non-positive
prices and `price-not-provided` tags are unpriced, not free. They are excluded from
known totals and recommendations, with an incomplete-budget warning.

Alternatives use price, category, style/color and footprint. The UI only offers
visible entries with ready models. `PlacementController.replace` loads a replacement
before changing the scene; failures preserve the old item. Swaps retain item IDs,
rotation and overlap overrides, with normal room clamping. Undo restores products
at their current placement. Only completed, still-applicable swaps count as savings.
Approval confirms a shopping plan for the current session, not a payment or Visa
integration. Room/catalog changes invalidate the reviewed plan. Nothing is purchased.

## Agent payments (Visa Acceptance test host + local sandbox)

"Approve plan" is a real authorization flow through `services/api` `/api/v1/payments`
(Linda's boundary `boundaries/payments.py`). Mandate, consent and token rules run locally;
with merchant credentials present (`VISA_ACCEPTANCE_MERCHANT_ID` / `_KEY_ID` /
`_SHARED_SECRET` in the ignored `.env`) the authorization is then placed on **Visa
Acceptance's test host** (`apitest.visaacceptance.com`, HTTP-Signature auth, Visa's published
test card, `capture: false`), and capture / reversal / refund follow the same transaction
(`adapters/commerce/visa_acceptance.py`). The receipt shows the Visa transaction id and
approval code (`provider: "visa-acceptance-sandbox"`). Without credentials, or if Visa is
unreachable, the local network answers instead (`provider: "dreamgrid-sandbox"`, with a
`fallbackReason`). Only test hosts are ever contacted; no money moves either way, and
`isSandbox` is always `true`. A Visa decline surfaces as `NETWORK_DECLINED` with the token
voided.

1. **Spending mandate.** The review sheet shows the exact priced lines and a mandate: a cap
   the shopper can raise (never below the total), the stores involved, 24-hour validity, and
   the room budget if one is set.
2. **Consent.** The browser asks the API for a one-time challenge bound to a SHA-256 digest of
   the plan, then signs it with a **platform passkey** (WebAuthn `navigator.credentials`,
   Touch ID / Face ID / Windows Hello; enrolled once per browser). The API verifies origin,
   RP ID hash, user-present/verified flags, the challenge, and the **ES256 signature**
   (`cryptography`). "Approve without passkey" still uses a single-use plan-bound challenge.
   A challenge cannot authorize a different plan; nothing can swap items after approval.
3. **Intent.** `POST /intents` checks the mandate (`MANDATE_EXCEEDED`, `BUDGET_EXCEEDED`,
   `MANDATE_EXPIRED`, `MERCHANT_NOT_ALLOWED`, `CONSENT_INVALID`, `EMPTY_PLAN`, `UNPRICED_LINE`)
   and returns `authorized` with an HMAC-signed sandbox token, or `declined` with a code and
   reason (HTTP 201 either way; declines are ledger entries, not errors). Idempotent per key.
4. **Receipt.** Intent id, network, how it was approved, mandate, token, and a status timeline.
   **Complete purchase** captures; **Release hold** / **Refund** reverses. The receipt is kept
   in `localStorage` (`dreamgrid.paymentIntent`) so it survives a reload; the API's ledger is
   in-memory for the process.
5. **Agents.** `tools/payments-mcp/server.mjs` is a dependency-free stdio MCP server exposing
   the same flow as tools (`request_payment_instruction`, `authorize_payment`,
   `capture_payment`, `reverse_payment`, `get_payment_intent`, `list_payment_ledger`,
   `verify_payment_token`). `node tools/payments-mcp/smoke.mjs` exercises it end to end.

Frontend: `payments.ts` (client + WebAuthn ceremony), `budgetBar.ts` (mandate → receipt).
Backend: `adapters/commerce/mock_payment_network.py`, `adapters/commerce/passkeys.py`,
`api/v1/routes/payments.py`. Tests: `payments.test.ts`, `tests/test_payments.py` (includes a
software ES256 authenticator so forged signatures are provably rejected).

## API and configuration

`POST /api/v1/products/import { url, titleHint? }` returns a partial `ProductDraft`.
`GET /api/v1/products/photo?url=` proxies one public JPEG/PNG/WebP listing photo
(<=5 MB, no redirects, same private-network rules) so the browser can seed the
Generate panel despite store CORS; failures return 502 with a plain message.
`POST /api/v1/products/search` accepts category, keywords, dimensions in meters
`[width,height,depth]`, max USD price, style tags, region and limit. All missing
fields stay unknown; AI-reported prices are not accepted as known prices.

Settings are read from the existing API environment, not copied between `.env`
files. `DREAMGRID_PRODUCT_SEARCH=auto` chooses SerpAPI when `SERPAPI_API_KEY` is set,
then OpenAI when configured, else disclosed fixtures. Force `fixture` for offline
search. `DREAMGRID_PRODUCT_SOURCING=fixture` disables AI extraction/lookup (explicit
URL reads still use the page reader). `DREAMGRID_COMMERCE_OPENAI_MODEL` defaults to
`gpt-4.1-mini`; generation retains `DREAMGRID_OPENAI_MODEL=gpt-5.6-sol` and high
reasoning. Non-US SerpAPI prices are disclosed in local currency and require a USD
price from the user. No exchange rate is invented.

Vite's existing `DREAMGRID_API_TARGET` proxy remains active in dev and preview,
including long generation timeouts. Run both services on the laptop; do not expose
the unauthenticated API publicly. The page reader rejects private-network URLs,
credentialed links and redirects. Blocked listings can always be pasted or entered.

## Verification

`pnpm check` runs contracts, frontend and backend checks. `tools/commerce-smoke.mjs`
runs the browser golden path against a local Vite server (default port 5175) with
mocked sourcing/analysis/jobs and a real cached GLB. It never makes paid calls.
Provide an installed Playwright module via `DREAMGRID_PLAYWRIGHT` if it is not on
Node's module path; Chrome is the default browser channel. Override the origin with
`DREAMGRID_SMOKE_URL`. This verifies integration, not live provider availability.

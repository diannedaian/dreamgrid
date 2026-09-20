import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.DREAMGRID_PLAYWRIGHT || "playwright");
const base = process.env.DREAMGRID_SMOKE_URL || "http://127.0.0.1:5175";
const browser = await chromium.launch({ headless: true, channel: process.env.DREAMGRID_BROWSER || "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [], calls = [];
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const catalog = await (await context.request.get(`${base}/demo-assets/catalog.json`)).json();
const chair = catalog.products.find(p => p.id === "college-chair");
const chairAsset = catalog.assets.find(a => a.id === chair.modelAssetId);
const glb = await (await context.request.get(`${base}${chairAsset.glbUrl}`)).body();
const draft = { sourceUrl: "https://store.example/smoke-chair", title: "Smoke test sourced chair", priceUsd: 999, merchant: "Test listing", imageUrl: `${base}/__smoke-photo.png`, dimensionsM: chair.dimensionsM, category: "chair", styleTags: ["study"], colorTags: ["blue"], confidence: 1, extractionMethod: "fixture", missing: [] };
const dimensions = Object.fromEntries(["width", "height", "depth"].map((axis, i) => [axis, { valueM: chair.dimensionsM[i], source: "estimated", evidence: "Smoke test estimate" }]));
const prepared = { importId: "a".repeat(32), expiresAt: "2026-09-20T23:59:00Z", title: draft.title, category: "chair", template: "custom", dimensions, warnings: ["Mock analysis for offline smoke test"], analysisMethod: "gpt", usage: { cached: false, inputTokens: 0, outputTokens: 0 } };
let generatedId = "", jobPolls = 0, generateRequest = "";
const asset = () => ({ ...chairAsset, id: "asset-smoke", productId: generatedId, glbUrl: `/api/v1/models/assets/${"b".repeat(64)}.glb`, generationMethod: "gpt-blender", disclosure: "Offline smoke test: cached chair GLB, not a live generated model." });
const job = status => ({ jobId: "c".repeat(32), status, dimensions, asset: status === "ready" ? asset() : null, error: null, cached: false });
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) return route.abort();
  if (url.pathname === "/__smoke-photo.png") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=", "base64") });
  if (url.pathname === "/__smoke-broken.png") return route.fulfill({ status: 404, body: "Not found" });
  if (!url.pathname.startsWith("/api/")) return route.continue();
  calls.push(url.pathname);
  const json = body => route.fulfill({ json: body });
  if (url.pathname === "/api/v1/products/search") {
    assert.equal(route.request().postDataJSON().maxPriceUsd, 100);
    return json({ source: "fixture", provider: "fixture", results: [draft,
      { ...draft, title: "Missing photo chair", priceUsd: 1099, sourceUrl: "https://store.example/missing", imageUrl: "" },
      { ...draft, title: "Broken photo chair", priceUsd: 1199, sourceUrl: "https://store.example/broken", imageUrl: `${base}/__smoke-broken.png` },
    ] });
  }
  if (url.pathname === "/api/v1/products/import") return json(draft);
  if (url.pathname === "/api/v1/products/photo") {
    assert.equal(url.searchParams.get("url"), draft.imageUrl);
    return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT9sAAAAASUVORK5CYII=", "base64") });
  }
  if (url.pathname === "/api/v1/models/prepare") {
    const request = route.request().postDataJSON();
    assert.match(request.imageDataUrl, /^data:image\/png;base64,/);
    assert.equal(request.sourceUrl, draft.sourceUrl);
    assert.match(request.productText, /Listed size/);
    assert.equal(request.categoryHint, "chair");
    return json(prepared);
  }
  if (url.pathname === "/api/v1/models/generate") {
    const request = route.request().postDataJSON();
    generateRequest = JSON.stringify(request);
    assert.equal(request.confirmed, true);
    generatedId = request.productId;
    return json(job("queued"));
  }
  if (url.pathname.startsWith("/api/v1/models/jobs/")) return json(job(++jobPolls > 1 ? "ready" : "generating"));
  if (url.pathname.startsWith("/api/v1/models/assets/")) return route.fulfill({ contentType: "model/gltf-binary", body: glb });
  throw new Error(`Unexpected API request: ${url.pathname}`);
});
try {
  await page.goto(`${base}/?w=144&d=120&h=96`);
  await page.waitForFunction(() => !!window.__dg?.placement);
  await page.locator("#budget").click();
  await page.locator("#budgetbar .amount").fill("100");
  await page.locator("#budgetbar .amount").press("Enter");
  await page.locator("#shop-toggle").click();
  await page.locator('[data-tab="source"]').click();
  await page.locator(".source .address input").fill("study chair");
  await page.locator(".source .address button").click();
  await page.waitForFunction(() => {
    const image = document.querySelector(".source .hit .pic img");
    return image?.complete && image.naturalWidth > 0;
  });
  await page.locator(".source .hit").filter({ hasText: "Missing photo chair" }).getByText("Photo unavailable").waitFor();
  await page.locator(".source .hit").filter({ hasText: "Broken photo chair" }).getByText("Photo unavailable").waitFor();
  assert.equal(await page.locator(".source .pform").count(), 0); // no intermediate form
  await page.locator(".source .hit .add").first().click();
  await page.locator("#import-popup").waitFor({ state: "visible" });
  assert.equal(await page.locator("#import-popup .price").inputValue(), "999");
  assert.equal(await page.locator("#import-popup .url").inputValue(), draft.sourceUrl);
  assert.match(await page.locator("#import-popup .specs").inputValue(), /Smoke test sourced chair.*Listed size/s);
  await page.locator("#import-popup .drop.has-photo").waitFor(); // listing photo pulled through the API proxy
  assert(calls.includes("/api/v1/products/photo"));
  assert(!calls.includes("/api/v1/models/prepare"));
  await page.locator("#import-popup .go").click();
  await page.locator("#import-popup .review-stage").waitFor({ state: "visible" });
  assert.equal(await page.locator("#import-popup input[type=checkbox]").count(), 0);
  assert.equal(await page.locator("#import-popup .dims label.est").count(), 3);
  await page.locator("#import-popup .go").click();
  await page.locator("#import-popup .progress .builder").waitFor({ state: "visible" });
  await page.locator("#import-popup .done").waitFor({ state: "visible" });
  const generateBody = JSON.parse(generateRequest);
  assert.equal(generateBody.acceptEstimated, true);
  assert.deepEqual(generateBody.estimatedAxes, ["width", "height", "depth"]);
  assert(Math.abs(generateBody.dimensions.widthM - chair.dimensionsM[0]) < 1e-9);
  await page.locator("#import-popup .go").filter({ hasText: "Done" }).click();
  const placed = await page.evaluate(() => structuredClone(window.__dg.placement.items));
  assert.equal(placed.length, 1);
  assert.equal(placed[0].productId, generatedId);
  await page.evaluate(() => { const p = window.__dg.placement; p.moveTo(p.items[0].id, .4, .4); p.rotate(p.items[0].id); });
  const beforeSwap = await page.evaluate(() => structuredClone(window.__dg.placement.items[0]));
  await page.locator("#budget").click();
  assert.match(await page.locator("#budgetbar .subtotal").innerText(), /999/);
  await page.locator("#budgetbar .apply").first().click();
  await page.waitForFunction(id => window.__dg.placement.items[0].productId !== id, generatedId);
  const swapped = await page.evaluate(() => structuredClone(window.__dg.placement.items[0]));
  assert.equal(swapped.id, beforeSwap.id);
  assert.equal(swapped.rotationYDeg, beforeSwap.rotationYDeg);
  assert.deepEqual(swapped.positionM, beforeSwap.positionM);
  await page.locator("#budgetbar .undo").click();
  await page.waitForFunction(id => window.__dg.placement.items[0].productId === id, generatedId);
  assert.match(await page.locator("#budgetbar .subtotal").innerText(), /999/);
  await page.locator("#budgetbar .review").click();
  await page.locator("#budgetbar .approve").click();
  assert.match(await page.locator("#budgetbar .pane").innerText(), /Plan approved/);
  await page.locator("#shop-toggle").click();
  await page.locator('[data-tab="list"]').click();
  assert.match(await page.locator(".list-body").innerText(), /Smoke test sourced chair/);
  const listUrl = await page.locator("#rightbar .page").getAttribute("href");
  const listPage = await context.newPage();
  await listPage.goto(listUrl);
  assert.match(await listPage.locator("body").innerText(), /Smoke test sourced chair/);
  const plan = JSON.parse(Buffer.from(new URL(listUrl).searchParams.get("plan"), "base64url").toString());
  assert.equal(plan.b, 100);
  await listPage.close();
  await page.reload();
  await page.waitForFunction(() => window.__dg?.placement?.items.length === 1);
  await page.locator("#budget").click();
  assert.match(await page.locator("#budgetbar .subtotal").innerText(), /999/);
  await page.evaluate(async () => { const p = window.__dg.placement; const entry = p.catalog.get("campus-drawer-chest"); await p.add(entry.product, entry.asset, [-1, 0, -1]); });
  assert.match(await page.locator("#budgetbar .unpriced").innerText(), /1 item without a price/);
  assert.match(await page.locator("#budgetbar .status").innerText(), /Incomplete budget/);
  assert(!calls.includes("/api/import-product"));
  assert.equal(calls.filter(c => c === "/api/v1/models/prepare").length, 1);
  assert.deepEqual(errors, []);
  await page.waitForFunction(() => document.body.classList.contains("budgetbar-open") && document.getElementById("budgetbar").getBoundingClientRect().right <= innerWidth + 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (process.env.DREAMGRID_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.DREAMGRID_SMOKE_SCREENSHOT });
  console.log("PASS: source → confirm → image required → estimate acceptance → queued/generating/ready → real cached GLB → place/rotate → budget → swap → undo → approval → shopping list/share → reload → unknown-price drawer. No paid calls.");
} finally {
  await browser.close();
}

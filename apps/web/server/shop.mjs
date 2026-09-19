// Shop browser + shopping agent (dev-server side).
//   webSearch(q)   → DuckDuckGo HTML results; no API key, no cost (DDG rate-limits after a burst, then
//                    returns an "anomaly" page → empty; the endpoint falls back to aiSearch).
//   aiSearch(q)    → OpenAI Responses API with the web_search tool → product-page hits. ≈ $0.012 per call.
//   preview(url)   → scraped title / price / image / dimensions for a product page; no cost.
//   createShopAgent(...).find({ prompt, fitsIn }) → ONE web-search model call that finds real product
//                    pages and judges fit, then a free scrape of each pick for image/price. ≈ $0.015 per run.
// Bing/Brave/Mojeek were tried and dropped: cookie-less requests get first-word-only or blocked results.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scrape, createUsage, estimateCost } from "./import-product.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const BLOCKED = /(^|\.)(pinterest|youtube|reddit|wikipedia|quora|facebook|instagram|tiktok|duckduckgo|bing|google|yelp|twitter|x)\.(com|org|net)$/i;
const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };

async function ddg(q) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const html = await res.text();
  const out = [];
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi)) {
    let url = decode(m[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (!/^https?:/.test(url)) continue;
    out.push({ url, title: decode(m[2]), snippet: decode(m[3] || ""), host: hostOf(url) });
  }
  return out;
}

/** Free web search (DuckDuckGo HTML). Empty when DDG is rate-limiting. Drops social/video/reference sites. */
export async function webSearch(q, n = 10) {
  let hits = [];
  try { hits = await ddg(q); } catch { /* ignore */ }
  const seen = new Set();
  return hits.filter((h) => h.host && !BLOCKED.test(h.host) && !seen.has(h.url) && seen.add(h.url)).slice(0, n);
}

const SEARCH_CALL_USD = 0.01; // web_search tool call, gpt-4.1 family ($10 / 1k calls)

/** One Responses-API call with the web_search tool and a strict JSON reply. Returns { data, cost, searches }. */
async function searchJson({ apiKey, model, instructions, input, schema, name, maxTokens = 900 }) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set in apps/web/.env");
  const body = {
    model, instructions, input, max_output_tokens: maxTokens,
    tools: [{ type: "web_search_preview", search_context_size: "low" }],
    text: { format: { type: "json_schema", name, strict: true, schema } },
  };
  const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI: ${json.error?.message ?? res.status}`);
  const searches = (json.output ?? []).filter((o) => o.type === "web_search_call").length;
  const msg = (json.output ?? []).find((o) => o.type === "message");
  const text = msg?.content?.find((c) => c.type === "output_text")?.text ?? "{}";
  const usage = { prompt_tokens: json.usage?.input_tokens ?? 0, completion_tokens: json.usage?.output_tokens ?? 0 };
  const cost = estimateCost(model, usage) + searches * SEARCH_CALL_USD;
  let data;
  try { data = JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : {}; }
  return { data, cost, searches, usage };
}

const HITS_SCHEMA = { type: "object", additionalProperties: false, required: ["hits"], properties: { hits: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["url", "title", "snippet"], properties: { url: { type: "string" }, title: { type: "string" }, snippet: { type: "string" } } } } } };
const HITS_INSTRUCTIONS = `Search the web for the shopper's query and return up to 8 individual PRODUCT pages at online furniture/home retailers (one item per page, purchasable), not category, search, blog or listicle pages. Prefer a mix of retailers. snippet: one short line with price and key facts if known. Return JSON only.`;

export function createAiSearch({ root, apiKey, model = "gpt-4.1-mini", budgetUsd = 5 }) {
  const cacheDir = join(root, ".cache", "search");
  mkdirSync(cacheDir, { recursive: true });
  const usage = createUsage(root, budgetUsd);
  return async function aiSearch(q) {
    const key = createHash("sha1").update(q.toLowerCase()).digest("hex").slice(0, 16);
    const cachePath = join(cacheDir, `${key}.json`);
    if (existsSync(cachePath)) return { ...JSON.parse(readFileSync(cachePath, "utf8")), cached: true };
    usage.assertBudget();
    const r = await searchJson({ apiKey, model, instructions: HITS_INSTRUCTIONS, input: `Query: ${q}`, schema: HITS_SCHEMA, name: "shop_hits", maxTokens: 700 });
    const total = usage.add(r.cost);
    console.log(`[shop-search] "${q}" → ${r.data.hits?.length ?? 0} hits, ${r.searches} search call(s) → $${r.cost.toFixed(4)} (session $${total.usd.toFixed(3)} of $${budgetUsd})`);
    const hits = (r.data.hits ?? []).filter((h) => /^https?:/.test(h.url)).map((h) => ({ ...h, host: hostOf(h.url) })).filter((h) => h.host && !BLOCKED.test(h.host));
    const out = { hits, cost: r.cost, source: "openai" };
    writeFileSync(cachePath, JSON.stringify(out));
    return out;
  };
}

const previews = new Map();
/** Lightweight product preview (scrape only, cached in memory). */
export async function preview(url) {
  if (previews.has(url)) return previews.get(url);
  const p = await scrape(url);
  const out = { url, host: p.host, title: p.title, price: p.price, image: p.images[0] ?? "", dimensionsText: p.dimensionsText.slice(0, 240), description: p.description.slice(0, 240) };
  previews.set(url, out);
  return out;
}

const PICKS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "picks"],
  properties: {
    summary: { type: "string" },
    picks: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["url", "title", "priceUsd", "dimensionsIn", "fit", "why"], properties: {
      url: { type: "string" }, title: { type: "string" },
      priceUsd: { type: ["number", "null"] },
      dimensionsIn: { type: ["array", "null"], items: { type: "number" }, minItems: 3, maxItems: 3, description: "[width, depth, height] in inches from the listing, or null if not listed" },
      fit: { type: "string", enum: ["fits", "unsure", "too big"] },
      why: { type: "string" },
    } } },
  },
};
const PICKS_INSTRUCTIONS = `You are a dorm-room furniture shopping assistant. Search the web and return up to 5 real, purchasable PRODUCT pages (one item each, at online retailers — never category, search, blog or listicle pages) that best match the request, best first. Prefer different retailers over several pages from one store; never repeat a URL.
- Read the listing for price and dimensions. If size limits are given, compare them to the listed dimensions (convert cm to inches). fit = "fits" only when every listed dimension is within its limit (width/depth may be swapped if the item can be rotated), "too big" when any exceeds, "unsure" when dimensions aren't listed. A missing limit means that axis is unconstrained.
- why: one short sentence a shopper would find useful (price, size, style, caveats).
- summary: one or two sentences about what you found; say plainly if nothing good turned up.
Return JSON only.`;

export function createShopAgent({ root, apiKey, model = "gpt-4.1-mini", budgetUsd = 5 }) {
  const cacheDir = join(root, ".cache", "shop");
  mkdirSync(cacheDir, { recursive: true });
  const usage = createUsage(root, budgetUsd);

  async function find({ prompt, fitsIn }) {
    const ask = String(prompt || "").trim().slice(0, 500);
    if (!ask) throw new Error("Tell the agent what to look for");
    const lim = ["w", "d", "h"].map((k) => (Number(fitsIn?.[k]) > 0 ? Math.round(Number(fitsIn[k])) : null));
    const key = createHash("sha1").update(JSON.stringify({ ask, lim })).digest("hex").slice(0, 16);
    const cachePath = join(cacheDir, `${key}.json`);
    if (existsSync(cachePath)) return { ...JSON.parse(readFileSync(cachePath, "utf8")), cached: true };
    usage.assertBudget();

    const limText = lim.some((x) => x) ? `Must fit within (inches): width ≤ ${lim[0] ?? "any"}, depth ≤ ${lim[1] ?? "any"}, height ≤ ${lim[2] ?? "any"}.` : "No size limit given.";
    const r = await searchJson({ apiKey, model, instructions: PICKS_INSTRUCTIONS, input: `Request: ${ask}\n${limText}`, schema: PICKS_SCHEMA, name: "shop_picks", maxTokens: 1200 });
    const total = usage.add(r.cost);
    const seenUrl = new Set();
    const raw = (r.data.picks ?? []).filter((p) => /^https?:/.test(p.url) && !seenUrl.has(p.url) && seenUrl.add(p.url));
    console.log(`[shop-agent] "${ask}" → ${raw.length} picks, ${r.searches} search call(s) → $${r.cost.toFixed(4)} (session $${total.usd.toFixed(3)} of $${budgetUsd})`);

    // Free enrichment: scrape each pick for a photo / listed price (keeps the model's data when a site blocks us).
    const picks = await Promise.all(raw.map(async (p) => {
      const base = { url: p.url, host: hostOf(p.url), title: p.title, price: p.priceUsd ?? 0, image: "", dimensionsText: "", fit: p.fit, why: p.why, dimensionsIn: p.dimensionsIn };
      try { const s = await preview(p.url); return { ...base, title: s.title || base.title, price: s.price || base.price, image: s.image, dimensionsText: s.dimensionsText }; }
      catch { return base; }
    }));
    const out = { summary: r.data.summary ?? "", picks, cost: r.cost };
    writeFileSync(cachePath, JSON.stringify(out));
    return out;
  }

  return { find };
}

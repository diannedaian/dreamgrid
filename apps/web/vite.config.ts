import { defineConfig, loadEnv, type Plugin } from "vite";
import { createImporter } from "./server/import-product.mjs";
import { createShopAgent, preview } from "./server/shop.mjs";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";

/**
 * Tiny in-memory relay for phone measurements (dev/preview only).
 *   POST /api/measurement  { w, d, h }  whole inches   → stored
 *   GET  /api/measurement?since=<ts>                   → latest if newer than `since`, else 204
 */
function measureRelay(): Plugin {
  let latest: { w: number; d: number; h: number; at: number } | null = null;
  let phoneLink: () => { url: string; https: boolean } = () => ({ url: "", https: false });

  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/m") { req.url = "/measure.html"; return next(); } // short alias for the phone
    if (url.pathname === "/api/phone-link") {
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(phoneLink()));
    }
    if (url.pathname !== "/api/measurement") return next();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const j = JSON.parse(body);
          const [w, d, h] = [j.w, j.d, j.h].map((v) => Math.round(Number(v)));
          if (![w, d, h].every((v) => Number.isFinite(v) && v > 0)) throw new Error("bad dims");
          latest = { w, d, h, at: Date.now() };
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(latest));
        } catch {
          res.writeHead(400).end("expected { w, d, h } in positive inches");
        }
      });
      return;
    }
    if (req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      if (!latest || latest.at <= since) return res.writeHead(204).end();
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(latest));
    }
    next();
  };

  /** The URL to type on the phone: https://<lan-ip>:<port>/m */
  const linkFor = (https: boolean, port: number) => () => {
    const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n!.address);
    const ip = ips.find((a) => a.startsWith("192.168.") || a.startsWith("10.")) ?? ips[0] ?? "localhost";
    return { url: `${https ? "https" : "http"}://${ip}:${port}/m`, https };
  };

  return {
    name: "dreamgrid-measure-relay",
    configureServer: (s) => {
      s.middlewares.use(handle);
      s.httpServer?.once("listening", () => {
        const a = s.httpServer!.address();
        phoneLink = linkFor(!!s.config.server.https, typeof a === "object" && a ? a.port : 5173);
      });
    },
    configurePreviewServer: (s) => {
      s.middlewares.use(handle);
      s.httpServer.once("listening", () => {
        const a = s.httpServer.address();
        phoneLink = linkFor(!!s.config.preview.https, typeof a === "object" && a ? a.port : 4173);
      });
    },
  };
}

/** Legacy spec importer is kept for old cached assets; the UI uses /api/v1/models. */
/**
 * Shopping endpoints (dev/preview only):
 *   POST /api/import-product   { url }                  → catalog entry + FurnitureSpec (OpenAI, vision)
 *   GET  /api/search-products?q=                        → agent picks for a plain query (OpenAI web search)
 *   GET  /api/preview-product?url=                      → scraped title/price/image/dims (no API cost)
 *   POST /api/shop-agent       { prompt, fitsIn }       → ranked picks (OpenAI, text only)
 */
function shopApi(env: Record<string, string>): Plugin {
  const cfg = { root: process.cwd(), apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || "gpt-4o-mini", budgetUsd: Number(env.OPENAI_SESSION_BUDGET_USD || 5) };
  const importer = createImporter(cfg);
  const searchCfg = { ...cfg, model: env.OPENAI_SEARCH_MODEL || "gpt-4.1-mini" }; // web_search tool needs the 4.1/5 family
  const agent = createShopAgent(searchCfg);
  const send = (res: ServerResponse, status: number, obj: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
  const readBody = (req: IncomingMessage) => new Promise<Record<string, unknown>>((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } }); });
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/api/")) return next();
    try {
      if (url.pathname === "/api/import-product" && req.method === "POST") {
        const { url: target } = await readBody(req);
        if (!/^https?:\/\//.test(String(target))) throw new Error("Paste a full http(s) link");
        return send(res, 200, await importer.importProduct(String(target)));
      }
      if (url.pathname === "/api/search-products" && req.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
        if (!q) throw new Error("Empty search");
        return send(res, 200, await agent.find({ prompt: q })); // same agent as ★, no size limits
      }
      if (url.pathname === "/api/preview-product" && req.method === "GET") {
        const target = url.searchParams.get("url") || "";
        if (!/^https?:\/\//.test(target)) throw new Error("Bad url");
        return send(res, 200, await preview(target));
      }
      if (url.pathname === "/api/shop-agent" && req.method === "POST") {
        const { prompt, fitsIn } = await readBody(req);
        return send(res, 200, await agent.find({ prompt, fitsIn: fitsIn as { w?: number; d?: number; h?: number } | undefined }));
      }
      return next();
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  };
  return { name: "dreamgrid-shop-api", configureServer: (s) => void s.middlewares.use(handle), configurePreviewServer: (s) => void s.middlewares.use(handle) };
}

export default defineConfig(({ mode }) => ({
  ...baseConfig(loadEnv(mode, process.cwd(), "")),
}));

function baseConfig(env: Record<string, string>) { return ({
  // https by default (self-signed): iOS Safari only allows the camera and motion sensors used by
  // /measure.html over https. Accept the certificate warning once per device. DREAMGRID_HTTP=1 disables.
  plugins: [measureRelay(), shopApi(env), ...(process.env.DREAMGRID_HTTP ? [] : [basicSsl()])],
  // Browser talks to this origin; only versioned API paths reach FastAPI.
  // Sol analysis can take several minutes. This does not proxy shopping/phone routes.
  server: { host: true, fs: { allow: ["../.."] }, proxy: { "/api/v1": { target: env.DREAMGRID_API_TARGET || "http://127.0.0.1:8000", timeout: 690_000, proxyTimeout: 690_000 } } },
  preview: { proxy: { "/api/v1": { target: env.DREAMGRID_API_TARGET || "http://127.0.0.1:8000", timeout: 690_000, proxyTimeout: 690_000 } } },
  resolve: {
    alias: {
      "@contracts": fileURLToPath(new URL("../../packages/contracts/index.ts", import.meta.url)),
    },
  },
  build: { rollupOptions: { input: { main: "index.html", measure: "measure.html" } } },
}); }

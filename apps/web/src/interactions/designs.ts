// Saved designs: named plans kept in the browser (localStorage). Cindy owns this (interactions).
import type { Plan } from "./share";

export type SavedDesign = {
  id: string;
  name: string;
  plan: Plan;
  /** Small JPEG data URL captured from the canvas, if available. */
  thumb?: string;
  savedAt: number;
  /** Shipped with the app (public/demo-assets/starter-layouts.json): shown to everyone, can't be deleted. */
  builtIn?: boolean;
};

const KEY = "dreamgrid.designs.v1";

export type DesignStore = {
  list(): SavedDesign[];
  get(id: string): SavedDesign | undefined;
  save(d: Omit<SavedDesign, "id" | "savedAt"> & { id?: string }): SavedDesign;
  remove(id: string): void;
};

/** Built-in layouts shipped with the app. Missing file or bad JSON → none. */
export async function loadBuiltinDesigns(url = "/demo-assets/starter-layouts.json"): Promise<SavedDesign[]> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const arr = (await r.json()) as SavedDesign[];
    return Array.isArray(arr) ? arr.filter((d) => d && typeof d.id === "string" && d.plan).map((d) => ({ ...d, savedAt: 0, builtIn: true })) : [];
  } catch { return []; }
}

/**
 * Store backed by any Storage-like object (localStorage in the app, a Map in tests).
 * Built-ins are listed after the user's own layouts; saving over a built-in id keeps a local copy instead.
 */
export function createDesignStore(storage: Pick<Storage, "getItem" | "setItem"> = safeLocalStorage(), builtins: SavedDesign[] = []): DesignStore {
  const read = (): SavedDesign[] => {
    try {
      const raw = storage.getItem(KEY);
      const arr = raw ? (JSON.parse(raw) as SavedDesign[]) : [];
      return Array.isArray(arr) ? arr.filter((d) => d && typeof d.id === "string" && d.plan) : [];
    } catch { return []; }
  };
  const write = (arr: SavedDesign[]) => { try { storage.setItem(KEY, JSON.stringify(arr)); } catch { /* quota or private mode */ } };
  const all = () => { const local = read(); const ids = new Set(local.map((d) => d.id)); return [...local, ...builtins.filter((b) => !ids.has(b.id))]; };
  return {
    list: () => all().sort((a, b) => b.savedAt - a.savedAt),
    get: (id) => all().find((d) => d.id === id),
    save: (d) => {
      const arr = read();
      const id = d.id ?? `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      const latest = arr.reduce((m, x) => Math.max(m, x.savedAt || 0), 0);
      const next: SavedDesign = { id, name: d.name.trim() || "Untitled layout", plan: d.plan, thumb: d.thumb, savedAt: Math.max(Date.now(), latest + 1) };
      const i = arr.findIndex((x) => x.id === id);
      if (i >= 0) arr[i] = next; else arr.push(next);
      write(arr);
      return next;
    },
    remove: (id) => write(read().filter((d) => d.id !== id)),
  };
}

function safeLocalStorage(): Pick<Storage, "getItem" | "setItem"> {
  try { return window.localStorage; } catch { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; }
}

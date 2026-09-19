import { describe, expect, it } from "vitest";
import { createDesignStore } from "./designs";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const plan = { v: 1 as const, w: 144, d: 120, h: 96, win: [], items: [] };

describe("design store", () => {
  it("saves, lists newest first, updates in place, and removes", () => {
    const s = createDesignStore(mem());
    const a = s.save({ name: "Dorm A", plan });
    const b = s.save({ name: "  ", plan: { ...plan, w: 100 } });
    expect(b.name).toBe("Untitled design");
    expect(s.list().map((d) => d.id)).toEqual([b.id, a.id]);
    const a2 = s.save({ id: a.id, name: "Dorm A v2", plan });
    expect(a2.id).toBe(a.id);
    expect(s.list().find((d) => d.id === a.id)?.name).toBe("Dorm A v2");
    s.remove(b.id);
    expect(s.list()).toHaveLength(1);
  });

  it("survives corrupt storage", () => {
    const st = mem(); st.setItem("dreamgrid.designs.v1", "{not json");
    expect(createDesignStore(st).list()).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppConfig } from "../config";
import { checkApiHealth } from "./checkApiHealth";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkApiHealth", () => {
  it("calls the configured health endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", service: "dreamgrid-api" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkApiHealth(
        undefined,
        createAppConfig({ VITE_API_BASE_URL: "/backend" }),
      ),
    ).resolves.toEqual({ status: "ok", service: "dreamgrid-api" });
    expect(fetchMock).toHaveBeenCalledWith("/backend/api/v1/health", {
      headers: { Accept: "application/json" },
      signal: undefined,
    });
  });

  it("rejects malformed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ready: true }),
      } as Response),
    );

    await expect(checkApiHealth()).rejects.toThrow(
      "Health check returned an invalid response.",
    );
  });
});

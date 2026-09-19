import { describe, expect, it } from "vitest";
import { createAppConfig } from "./config";

describe("createAppConfig", () => {
  it("uses the local API by default", () => {
    const config = createAppConfig({});

    expect(config.apiBaseUrl).toBe("http://localhost:8000");
    expect(config.apiUrl("api/v1/health")).toBe(
      "http://localhost:8000/api/v1/health",
    );
  });

  it("normalizes configured origins and paths", () => {
    const config = createAppConfig({
      VITE_API_BASE_URL: "https://api.dreamgrid.example/",
    });

    expect(config.apiBaseUrl).toBe("https://api.dreamgrid.example");
    expect(config.apiUrl("/api/v1/health")).toBe(
      "https://api.dreamgrid.example/api/v1/health",
    );
  });

  it("rejects unsafe protocols", () => {
    expect(() =>
      createAppConfig({ VITE_API_BASE_URL: "javascript:alert(1)" }),
    ).toThrow("VITE_API_BASE_URL must use http or https.");
  });
});

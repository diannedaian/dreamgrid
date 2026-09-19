import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("../scene/SceneCanvas", () => ({
  SceneCanvas: () => <div data-testid="scene-canvas" />,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the ownership handoff and reports a reachable API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok", service: "dreamgrid-api" }),
      } as Response),
    );

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "The foundation is ready." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Dianne")).toBeInTheDocument();
    expect(screen.getByText("Cindy")).toBeInTheDocument();
    expect(screen.getByText("Linda")).toBeInTheDocument();
    expect(await screen.findByText("API connected")).toBeInTheDocument();
  });

  it("keeps the shell available when the API is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<App />);

    expect(await screen.findByText("API unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("scene-canvas")).toBeInTheDocument();
  });
});

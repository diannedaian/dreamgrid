import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BudgetPanel } from "./BudgetPanel";
import { summarizeBudget } from "./budget";
import { demoProducts, demoRoomState } from "./demoData";

describe("BudgetPanel", () => {
  it("shows the fixture totals and an under-budget status", () => {
    render(<BudgetPanel summary={summarizeBudget(demoRoomState, demoProducts)} />);

    expect(screen.getByTestId("budget-subtotal")).toHaveTextContent("$407");
    expect(screen.getByTestId("budget-remaining")).toHaveTextContent("$43");
    expect(screen.getByRole("status")).toHaveTextContent("Under budget");
  });

  it("shows over budget with a negative remaining amount", () => {
    const summary = summarizeBudget({ ...demoRoomState, budgetUsd: 400 }, demoProducts);
    render(<BudgetPanel summary={summary} />);

    expect(screen.getByTestId("budget-remaining")).toHaveTextContent("-$7");
    expect(screen.getByRole("status")).toHaveTextContent("Over budget");
  });

  it("flags unpriced items", () => {
    const state = {
      ...demoRoomState,
      items: [
        ...demoRoomState.items,
        { id: "x", productId: "missing", modelAssetId: "a", positionM: [0, 0, 0] as [number, number, number], rotationYDeg: 0 as const },
      ],
    };
    render(<BudgetPanel summary={summarizeBudget(state, demoProducts)} />);

    expect(screen.getByText("1 item without a price is not counted.")).toBeInTheDocument();
  });

  it("reports budget edits as a number", () => {
    const onBudgetChange = vi.fn();
    render(
      <BudgetPanel summary={summarizeBudget(demoRoomState, demoProducts)} onBudgetChange={onBudgetChange} />,
    );

    fireEvent.change(screen.getByLabelText("Budget (USD)"), { target: { value: "600" } });

    expect(onBudgetChange).toHaveBeenCalledWith(600);
  });
});

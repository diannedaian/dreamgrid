import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommerceDemo } from "./CommerceDemo";

describe("CommerceDemo", () => {
  it("walks the golden path: add, go over budget, fit, review, approve", () => {
    render(<CommerceDemo />);

    expect(screen.getByTestId("budget-subtotal")).toHaveTextContent("$407");
    expect(screen.getByRole("status")).toHaveTextContent("Under budget");

    fireEvent.click(screen.getByRole("button", { name: "Add Slim Arc Floor Lamp" }));
    expect(screen.getByTestId("budget-subtotal")).toHaveTextContent("$469");
    expect(screen.getByText("Over budget")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Make this room fit my budget" }));
    expect(screen.getByText("Under budget")).toBeInTheDocument();
    expect(screen.getByText(/Applied \d+ swap/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review shopping plan" }));
    expect(screen.getByRole("heading", { name: "Review your shopping plan" })).toBeInTheDocument();
    expect(screen.getByTestId("plan-saved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(screen.getByRole("heading", { name: "Plan approved" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy plan as text" })).toBeInTheDocument();
  });

  it("updates the subtotal when an item is removed", () => {
    render(<CommerceDemo />);

    fireEvent.click(screen.getByRole("button", { name: "Remove scene-shelf-1" }));

    expect(screen.getByTestId("budget-subtotal")).toHaveTextContent("$328");
  });

  it("lets the user apply one swap at a time", () => {
    render(<CommerceDemo />);

    fireEvent.click(screen.getByRole("button", { name: /^Apply \(save \$40\)/ }));

    expect(screen.getByTestId("budget-subtotal")).toHaveTextContent("$367");
  });
});

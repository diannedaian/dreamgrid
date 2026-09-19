import { useState } from "react";

import { PlanSummary } from "./PlanSummary";
import { planToText, type ShoppingPlan } from "./shoppingPlan";

export type ApprovalScreenProps = {
  plan: ShoppingPlan;
  onApprove: () => void;
  onBack: () => void;
};

/**
 * Consent + approval. Approving freezes the plan; it does not buy anything.
 * The success state offers the plan as text so the user can shop with it.
 */
export function ApprovalScreen({ plan, onApprove, onBack }: ApprovalScreenProps) {
  const [copied, setCopied] = useState(false);
  const approved = plan.status === "approved";

  async function copyPlan() {
    const text = planToText(plan);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="commerce-approval" aria-labelledby="commerce-approval-title">
      <h2 id="commerce-approval-title">{approved ? "Plan approved" : "Review your shopping plan"}</h2>

      <PlanSummary plan={plan} />

      {approved ? (
        <div className="commerce-approval__done" role="status">
          <p>
            Your plan is saved. Open each store link above to buy the items yourself; DreamGrid
            does not place orders.
          </p>
          <button type="button" onClick={copyPlan}>
            {copied ? "Copied" : "Copy plan as text"}
          </button>
        </div>
      ) : (
        <div className="commerce-approval__consent">
          <p>
            Approving creates a shopping plan with links to each store. Nothing is purchased
            through DreamGrid and no payment details are collected.
          </p>
          <button type="button" onClick={onApprove}>
            Approve plan
          </button>
          <button type="button" onClick={onBack}>
            Back to room
          </button>
        </div>
      )}
    </section>
  );
}

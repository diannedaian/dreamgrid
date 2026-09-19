import { formatSignedUsd, formatUsd } from "./format";
import type { ShoppingPlan } from "./shoppingPlan";

export type PlanSummaryProps = {
  plan: ShoppingPlan;
};

/** Read-only view of a shopping plan: one group per store, links per line. */
export function PlanSummary({ plan }: PlanSummaryProps) {
  return (
    <div className="commerce-plan">
      <dl className="commerce-plan__totals">
        <dt>Total</dt>
        <dd data-testid="plan-total">{formatUsd(plan.totalUsd)}</dd>
        <dt>Budget</dt>
        <dd>{formatUsd(plan.budgetUsd)}</dd>
        <dt>Remaining</dt>
        <dd>{formatSignedUsd(plan.remainingUsd)}</dd>
        {plan.savedUsd > 0 && (
          <>
            <dt>Saved by swaps</dt>
            <dd data-testid="plan-saved">{formatUsd(plan.savedUsd)}</dd>
          </>
        )}
      </dl>

      {plan.groups.map((group) => (
        <section key={group.merchant} className="commerce-plan__merchant">
          <h3>
            {group.merchant} <span>{formatUsd(group.subtotalUsd)}</span>
          </h3>
          <ul>
            {group.lines.map((line) => (
              <li key={line.product.id}>
                <a href={line.product.sourceUrl} target="_blank" rel="noreferrer">
                  {line.product.title}
                </a>
                {line.quantity > 1 && <span> ×{line.quantity}</span>}
                <span> {formatUsd(line.lineTotalUsd)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {plan.unpricedItemCount > 0 && (
        <p className="commerce-plan__unpriced">
          {plan.unpricedItemCount} item(s) without a price are not included.
        </p>
      )}
    </div>
  );
}

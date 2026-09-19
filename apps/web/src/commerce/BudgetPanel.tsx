import type { BudgetSummary } from "./budget";
import { formatSignedUsd, formatUsd } from "./format";

export type BudgetPanelProps = {
  summary: BudgetSummary;
  onBudgetChange?: (budgetUsd: number) => void;
};

const STATUS_LABEL = {
  under: "Under budget",
  "at-limit": "Right at budget",
  over: "Over budget",
} as const;

/** Budget input plus derived totals. Unstyled; hooks are the class names. */
export function BudgetPanel({ summary, onBudgetChange }: BudgetPanelProps) {
  const percentUsed =
    summary.budgetUsd > 0 ? Math.min(100, (summary.subtotalUsd / summary.budgetUsd) * 100) : 100;

  return (
    <section className="commerce-budget" aria-labelledby="commerce-budget-title">
      <h2 id="commerce-budget-title">Budget</h2>

      <label className="commerce-budget__input">
        Budget (USD)
        <input
          type="number"
          min={0}
          step={1}
          value={summary.budgetUsd}
          readOnly={!onBudgetChange}
          onChange={(event) => onBudgetChange?.(Math.max(0, Number(event.target.value) || 0))}
        />
      </label>

      <dl className="commerce-budget__totals">
        <dt>Subtotal</dt>
        <dd data-testid="budget-subtotal">{formatUsd(summary.subtotalUsd)}</dd>
        <dt>Remaining</dt>
        <dd data-testid="budget-remaining">{formatSignedUsd(summary.remainingUsd)}</dd>
      </dl>

      <div
        className="commerce-budget__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentUsed)}
        aria-label="Budget used"
      >
        <div className="commerce-budget__bar-fill" style={{ width: `${percentUsed}%` }} />
      </div>

      <p className={`commerce-budget__status commerce-budget__status--${summary.status}`} role="status">
        {STATUS_LABEL[summary.status]}
      </p>

      {summary.unpricedItemIds.length > 0 && (
        <p className="commerce-budget__unpriced">
          {summary.unpricedItemIds.length === 1
            ? "1 item without a price is not counted."
            : `${summary.unpricedItemIds.length} items without a price are not counted.`}
        </p>
      )}

      <ul className="commerce-budget__lines">
        {summary.lines.map((line) => (
          <li key={line.sceneItemId}>
            <span>{line.product.title}</span> <span>{formatUsd(line.product.priceUsd)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

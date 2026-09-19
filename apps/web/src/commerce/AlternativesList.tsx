import type { Alternative } from "./alternatives";
import { formatUsd } from "./format";

export type AlternativesListProps = {
  alternatives: Alternative[];
  isOverBudget: boolean;
  onApplySwap: (alternative: Alternative) => void;
  onFitToBudget: () => void;
  /** Message from the last "fit to budget" attempt, if any. */
  fitMessage?: string;
  /** Swaps already applied this session, oldest first. */
  appliedSwaps?: Alternative[];
  onUndoSwaps?: () => void;
};

/** Preview cheaper swaps; nothing changes until the user clicks Apply. */
export function AlternativesList({
  alternatives,
  isOverBudget,
  onApplySwap,
  onFitToBudget,
  fitMessage,
  appliedSwaps = [],
  onUndoSwaps,
}: AlternativesListProps) {
  const savedUsd = appliedSwaps.reduce((sum, swap) => sum + swap.savingsUsd, 0);

  return (
    <section className="commerce-alternatives" aria-labelledby="commerce-alternatives-title">
      <h2 id="commerce-alternatives-title">Cheaper alternatives</h2>

      <button
        type="button"
        className="commerce-alternatives__fit"
        onClick={onFitToBudget}
        disabled={!isOverBudget || alternatives.length === 0}
      >
        Make this room fit my budget
      </button>
      {fitMessage && (
        <p className="commerce-alternatives__fit-message" role="status">
          {fitMessage}
        </p>
      )}

      {appliedSwaps.length > 0 && (
        <div className="commerce-alternatives__applied">
          <p>
            {appliedSwaps.length === 1 ? "1 swap applied" : `${appliedSwaps.length} swaps applied`}, saving{" "}
            {formatUsd(savedUsd)}:
          </p>
          <ul>
            {appliedSwaps.map((swap) => (
              <li key={`${swap.sceneItemId}:${swap.to.id}`}>
                {swap.from.title} → {swap.to.title} ({formatUsd(swap.savingsUsd)})
              </li>
            ))}
          </ul>
          {onUndoSwaps && (
            <button type="button" onClick={onUndoSwaps}>
              Swap everything back
            </button>
          )}
        </div>
      )}

      {alternatives.length === 0 ? (
        <p className="commerce-alternatives__empty">
          No cheaper options in the catalog for the items in this room.
        </p>
      ) : (
        <ul className="commerce-alternatives__list">
          {alternatives.map((alternative) => (
            <li key={`${alternative.sceneItemId}:${alternative.to.id}`}>
              <p>
                <strong>{alternative.from.title}</strong> → <strong>{alternative.to.title}</strong>{" "}
                <span>
                  ({formatUsd(alternative.from.priceUsd)} → {formatUsd(alternative.to.priceUsd)})
                </span>
              </p>
              <ul className="commerce-alternatives__reasons">
                {alternative.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <button type="button" onClick={() => onApplySwap(alternative)}>
                Apply (save {formatUsd(alternative.savingsUsd)})
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

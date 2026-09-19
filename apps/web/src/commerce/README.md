# Commerce ownership: Linda

Budget, subtotal, cheaper-alternative, and shopping-plan approval logic and
UI live here. Everything consumes the shared `RoomState` and `Product[]`;
nothing in this directory keeps its own cart.

Do not implement 3D manipulation or model generation here. The step-by-step
plan is in `docs/LINDA_COMMERCE_PLAN.md`.

## Inputs the app shell must supply

| Input | Type | Source |
|---|---|---|
| `roomState` | `RoomState` from `@dreamgrid/contracts` | The one shared state Cindy's placement layer edits |
| `products` | `Product[]` | Catalog (fixture `fixtures/products.json` until live) |

Wire it once in the compositor and totals follow every scene change:

```ts
import { summarizeBudget } from "../commerce/budget";

const summary = useMemo(() => summarizeBudget(roomState, products), [roomState, products]);
```

## `budget.ts` (pure, tested against fixtures)

- `summarizeBudget(state, products): BudgetSummary`
  - One `BudgetLine` per scene item; two placements of one product count twice.
  - A scene item whose `productId` is not in `products` is counted as $0 and
    listed in `unpricedItemIds`. It never throws.
  - `status` is `"under"`, `"at-limit"` (remaining exactly 0), or `"over"`.
  - Model asset status is irrelevant: an item in the room is priced whether
    its GLB is `generating` or `ready`.
- `roundUsd(n)` rounds to cents; use it for any derived money value.
- `budgetStatus(remainingUsd)` maps a remaining amount to a status.

Fixture check: `fixtures/room-state.json` + `fixtures/products.json` gives
subtotal 407, remaining 43, `under`.

## Approval

Approval produces a shopping plan (per-merchant lines with `sourceUrl` links
and savings). No payment provider is called and nothing is purchased through
DreamGrid.

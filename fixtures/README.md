# Shared Fixtures

These files let each owner work without waiting for another subsystem:

- `products.json`: Cindy's catalog input and Linda's price lookup. It contains
  eight products across all six MVP categories.
- `model-assets.json`: Dianne's normalized asset output and Cindy's loader
  input. Paths are stable placeholders; the GLBs and previews must be supplied
  under `apps/web/public/demo-assets/` by the owning asset work.
- `empty-room-state.json`: a clean starting point for room and interaction work.
- `room-state.json`: a grid-aligned placed-room state for Cindy and Linda.
- `furniture-spec.json`: an example of safe structured output for Dianne's
  trusted Blender interpreter.
- `search-results.json`: Linda's placeholder product-search results, served by
  the API when no search provider key is configured. Ten items across all six
  categories; `example.com` links, not live listings.

Fixtures describe the integration contract; they do not claim that placeholder
assets exist. Update the disclosure and asset credits before submission.

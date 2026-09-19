# DreamGrid GitHub Workflow

Status: Required collaboration process for the HackMIT 2026 build  
Team: Dianne, Cindy, Linda  
Goal: Keep `main` demoable throughout the 24-hour hackathon

## 1. Repository Decision

Create one repository named `dreamgrid`.

- Use a single monorepo for the web app, model-generation service, commerce service, shared contracts, and demo assets.
- A personal repository owned by one teammate is the fastest setup for a three-person hackathon team. Add the other two teammates as collaborators with write access.
- A GitHub organization is optional. It is useful only if the team wants shared long-term ownership after the hackathon.
- Keep the repository private during setup if desired, then make it public before submission if HackMIT or a sponsor requires a public code link.
- Never commit API keys, sponsor credentials, tokens, or `.env` files.
- Do not reuse or nest the project inside an unrelated Git repository.

Recommended initial structure:

```text
dreamgrid/
  .github/
    pull_request_template.md
    CODEOWNERS
    workflows/check.yml
  apps/web/
  services/api/
  packages/contracts/
  apps/web/public/demo-assets/
  docs/
    PROJECT_MANIFESTO.md
    GITHUB_WORKFLOW.md
  apps/web/.env.example
  services/api/.env.example
  .gitignore
  README.md
```

## 2. Branch Model

Use one permanent branch: `main`.

Do not create a permanent `develop` branch. Twenty-four hours is too short for two integration branches.

Every task uses a short-lived branch created from the latest `main`:

```text
dianne/room-shell
dianne/model-pipeline
cindy/drag-snap-rotate
cindy/catalog-ui
linda/budget-engine
linda/visa-sandbox
fix/model-scale
fix/demo-checkout
```

Branch rules:

1. One branch represents one independently testable change.
2. Prefer branches that live for one to three hours, not the whole hackathon.
3. Pull the latest `main` before opening or updating a pull request.
4. Never rewrite or force-push another teammate's branch.
5. Delete branches after they are merged.

## 3. Main-Branch Protection

If the GitHub plan supports it, add a ruleset for `main` with:

- Require a pull request before merging.
- Block force pushes.
- Block branch deletion.
- Require the fast automated check after it exists.
- Require conversations to be resolved.
- Allow zero required approvals during the hackathon so an unavailable teammate cannot block the demo.

Team rule, even if GitHub cannot enforce it:

- The author does not merge a risky shared-contract or app-shell change without another teammate looking at it.
- A tiny isolated fix may be self-merged after the author runs the relevant check and posts the result in the pull request.
- Nobody pushes directly to `main` except for a true submission emergency agreed to by the team.

Enable **Squash merging** and disable ordinary merge commits. Each pull request should become one understandable commit on `main`.

## 4. Ownership and Reviews

```text
/apps/web/src/room/             Dianne
/services/api/src/dreamgrid_api/adapters/model_generation/ Dianne
/apps/web/src/interactions/     Cindy
/apps/web/src/catalog/          Cindy
/apps/web/src/commerce/         Linda
/services/api/src/dreamgrid_api/adapters/commerce/         Linda
/packages/contracts/            All three
/apps/web/public/demo-assets/    Dianne, reviewed by Cindy
```

Review by the person who consumes the change:

- Cindy reviews Dianne's room/model interface changes.
- Dianne reviews Cindy's model-loading and transform assumptions.
- Linda reviews changes that affect prices, cart state, or approval state.
- Cindy reviews Linda's events as they enter or leave the 3D scene UI.
- All three approve changes to `packages/contracts` in chat, even if GitHub records only one review.

One teammate should be the integration captain at a time. The captain watches `main`, resolves cross-system ownership questions, and leads the scheduled integration checks. This is coordination duty, not permission to rewrite another owner's subsystem.

## 5. Pull Request Size and Template

Open a draft pull request as soon as the branch has its interface or skeleton. This makes work visible before it is finished.

Aim for pull requests that:

- Implement one capability.
- Change fewer than roughly 300 hand-written lines when practical.
- Include a screenshot, short recording, or sample output for visible behavior.
- State which fixture or real service was used.
- Do not mix refactors with a new feature.

Use this checklist:

```md
## What changed

## Contract or UI impact

## How I tested it

## Demo/fallback impact

- [ ] I started from current `main`.
- [ ] No secrets or generated dependency folders are committed.
- [ ] The happy path works.
- [ ] Failure or fallback behavior still works.
- [ ] Another subsystem can consume this without undocumented assumptions.
```

## 6. When to Merge

Merge continuously. Do not wait until all three subsystems are complete.

### Before Hacking Starts

Merge only planning and infrastructure:

- README and manifesto.
- Shared folder structure.
- Package manager lockfile.
- `.gitignore` and `.env.example`.
- Formatting, type-checking, and a minimal CI check.
- Empty contracts or fixtures agreed to by the team.

Do not prebuild judged product functionality if HackMIT requires the project to be built during the event.

### T+0 to T+1: Foundation Merge

Merge the app shell, canonical contracts, and one fixture first. After this point, field names and coordinate conventions are treated as stable.

### T+1 to T+4: First Capability Merges

Each owner merges one thin vertical slice:

- Dianne: dimension-based room and one normalized GLB.
- Cindy: select, drag, and snap one hard-coded GLB.
- Linda: calculate totals from fixture scene state.

### T+4: First Integration Check

Stop feature work for 20 to 30 minutes. Update from `main`, run the app together, and fix interface mismatches immediately.

### T+4 to T+8: Integrate Real Boundaries

Merge Dianne's actual asset into Cindy's scene, then connect Cindy's scene events to Linda's totals. By T+8, `main` must demonstrate one complete cross-owner flow.

### T+8 to T+14: Small PRs Every One to Three Hours

Merge only working increments. Run a joint smoke test at least every three hours. Never allow a personal branch to drift from `main` for more than roughly three hours.

### T+14: Feature Freeze

Stop adding core features. Create a tag such as `mvp-v1`. From here onward, merge only integration fixes, fallbacks, and essential polish.

### T+20: Demo Freeze

Create a tag such as `demo-v1`. Only merge a change if it fixes a rehearsed demo failure or improves submission material without risking the app.

### T+23: Submission Freeze

Create `submission-v1`. Do not merge again unless the submitted build or link is broken.

## 7. Conflict Prevention

- Do not have multiple people edit the same large component.
- Put shared schemas in `packages/contracts`; do not duplicate their types.
- Use fixtures while another subsystem is unfinished.
- Keep generated GLB files out of feature-code branches when possible; add curated demo assets in a dedicated asset pull request.
- Avoid formatting the entire repository during the hackathon.
- Announce before changing the app shell, routing, package dependencies, contracts, or deployment configuration.
- If a conflict involves another owner's logic, ask that owner to resolve it or pair for five minutes.

## 8. Commit and Merge Conventions

Use short, descriptive commit messages:

```text
feat(room): generate room from dimensions
feat(scene): add grid-snapped dragging
feat(budget): calculate subtotal from scene items
fix(models): normalize GLB pivot and scale
chore(ci): add typecheck workflow
docs(demo): document fallback path
```

Prefer squash merging. Use the pull request title as the final commit message.

## 9. Minimal Automated Checks

Start with checks that finish in a few minutes:

- Install dependencies from the lockfile.
- Type-check.
- Lint.
- Run small unit tests for coordinate conversion, scene totals, and contract validation.
- Build the web app.

Do not create an elaborate test or deployment system. A slow or flaky check is worse than a small reliable one during a 24-hour event.

## 10. Secrets and Large Assets

- Commit `.env.example`, never `.env`.
- Store real keys in the deployment provider and each teammate's local environment.
- Revoke a key immediately if it appears in Git history; deleting the line in a later commit is not sufficient.
- Keep only the few compressed GLB files required for the guaranteed demo.
- Do not commit Blender caches, render outputs, dependency directories, or large raw generation experiments.
- If the repo approaches GitHub's practical file limits, use object storage for generated files. Do not introduce Git LFS during the hackathon unless the team has already tested it.

## 11. Recovery Rule

Before every risky merge or deployment, tag or record the last known-good commit. If `main` breaks near judging, revert the offending squash commit instead of debugging multiple features at once.

The operating principle is simple: `main` should always be closer to the final demo than any teammate's private branch.

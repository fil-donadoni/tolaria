// The `label` values that address the `check:ui` Limited/Draft fixtures
// (issue #2822). Seeded by `convex/limitedFixtures.ts`; navigated to by the
// lane's walks in `scripts/ui-gate/surfaces.ts`. One definition, so renaming
// a label cannot leave the lane addressing a row that no longer exists.
//
// DELIBERATELY ITS OWN MODULE, and deliberately dependency-free — the same
// reason `./scorerVersion.ts` is: it has a consumer on the other side of the
// `convex/` boundary. `limitedFixtures.ts` is a REGISTERED CONVEX FUNCTION
// MODULE (`internalMutation`, `./_generated/server`), and `convex/_generated`
// is gitignored, so importing these three strings from there drags the whole
// generated API into every `scripts/` process that touches the lane. The
// chain that made this concrete: `scripts/land.ts` → `verify-receipt.ts` →
// `surfaces.ts`. With the constants living in the function module, a fresh
// worktree that had not yet run `bun run worktree:init` could not run
// `bun run land` AT ALL — `Cannot find module './_generated/server'` — for
// any PR, UI-touching or not. Missing/stale `_generated` is a recurring
// merge-train failure mode (CLAUDE.md, "Fresh worktrees need
// `bun run worktree:init`"); the merge command must not be one of its
// victims.
//
// SO: nothing may be added to this file that imports anything, and every
// consumer — the seeding mutation included — imports from HERE rather than
// from the function module.

/** Every fixture label starts with this. The lane's list walks navigate to
 *  `/limited?label=ui-gate/`, which the page filters by PREFIX — so the two
 *  list surfaces measure exactly the fixture rows and nothing else. */
export const UI_GATE_LABEL_PREFIX = "ui-gate/";

/** Seating still open, viewer at seat 0, no pools. The one event state whose
 *  detail page neither redirects into the Draft Room
 *  (`useDraftRoomRedirect` needs a pending pick) nor auto-opens the deck
 *  builder (`useAutoOpenLimitedBuilder` needs a final pool) — which is what
 *  makes `limited-antechamber` land on the antechamber every single time
 *  instead of once per tab. */
export const UI_GATE_OPEN_LABEL = "ui-gate/open";

/** Mid-draft: viewer at seat 0 with a live pack AND a non-empty pool, so one
 *  fixture serves `draft-pick`, `draft-pool-stop`, `draft-pool-peek` and
 *  (via `/limited/<id>/build`, which needs only a dealt pool) `limited-build`. */
export const UI_GATE_DRAFT_LABEL = "ui-gate/draft";

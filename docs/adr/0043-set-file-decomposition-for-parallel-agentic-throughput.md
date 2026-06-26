# Set-file decomposition by colour for parallel agentic throughput

## Status

accepted

## Context

Card sets have so far been organized as a **single monolithic module per set**:
`convex/cards/sets/ice.ts` (11,588 lines / 520 KB), `lea.ts` (8,460), `leg.ts`
(6,876), and so on. Every card in a set — and every issue-cluster that adds
cards to it — appends to the same file.

We process card work with the `process-gh-issues` agentic loop: issues are
clustered (by colour free-tranche or by shared engine mechanic), and a fresh
subagent implements each cluster in an isolated git worktree. Profiling a full
day of ICE (Ice Age) implementation surfaced where the wall-clock actually
goes:

- **Reasoning dominates.** Cluster cadence was 20–100+ minutes each; the
  pre-merge quality gate is ~150 s and the rest of the plumbing (worktree
  create, warm `bun install` ~2 s, `gh` round-trips, instant squash-merge — no
  branch protection on a free private repo) is seconds. **~85–95 % of each
  cluster is the agent reasoning and writing code; <15 % is workflow.**
- **The cost therefore parallelizes** — independent clusters could run
  concurrently and collapse the day.
- **But conflicts block naive parallelism.** Every cluster edits the _same_
  `ice.ts`, so two subagents on two clusters produce merge conflicts on that
  file. (This is the recurring conflict pain when a second agent or a manual
  edit touches the set concurrently.)

**Scope correction — file layout is not the parallelism unlock.** Profiling the
actual conflict surface showed that issue clusters split **by mechanic**, not by
colour: only the "free tranche" (vanilla/keyword cards) divides cleanly by
colour. The slow _mechanic_ clusters — the 85–95 % — converge on shared
**append-registries** regardless of colour: `cards/types.ts` (new primitive),
`gre/state.ts` (new field), `gre/serialize.ts` (`PERSISTED_OPTIONAL_KEYS`),
`game.ts`, and `debug-panel.tsx` (`PRESET_SCENARIOS`, mandated per feature).
Colour file-split does **nothing** for those. So this ADR's decomposition is the
right move for the **free-tranche conflict surface plus the file-size costs
below** — not the mechanism that parallelizes mechanic work. Safe parallel
_implement_ + serial _integrate_ of mechanic clusters is a separate concern (a
merge-train: lock + rebase + re-gate), and decentralizing the worst shared
registries (notably `PRESET_SCENARIOS`) is its own decision — see the
debug-scenario ADR.

Secondary costs also trace to file size: a 520 KB module inflates the Vitest
cold-start (the suite's import/transform step is ~55 s of its ~120 s) and bloats
every subagent's context when it loads the file to add one card.

The registry consumes sets via namespace import — `import * as ice from
"./sets/ice"` — collecting every exported `CardDefinition` const.

## Decision

**Each set is a directory, not a file, split along the colour axis.**
`convex/cards/sets/ice.ts` becomes `convex/cards/sets/ice/` containing:

- `white.ts`, `blue.ts`, `black.ts`, `red.ts`, `green.ts` — mono-colour cards
- `multicolor.ts` — gold / multi-colour cards
- `colorless.ts` — artifacts **and lands** (colourless is the catch-all for
  everything with no colour identity)
- `index.ts` — re-exports every module (`export * from "./white"`, …)

The registry import is **unchanged**: `import * as ice from "./sets/ice"`
resolves to `ice/index.ts`, which re-exports the same flat set of consts. No
churn in `convex/cards/index.ts`.

Test files mirror the split: `sets/ice/__tests__/white.test.ts`, etc., replacing
the single parallel `__tests__/ice.test.ts`. A card's `describe` block lives in
the test file matching its colour module.

**This is the standard layout for every set, retroactively and going forward.**
All existing monolithic set files (`lea`, `leb`, `arn`, `atq`, `leg`, `drk`,
`fem`, `ice`, `2ed`, `3ed`) are decomposed the same way. New sets are scaffolded
as a directory from the start (the `/new-set` and import pipeline emit into
`sets/<code>/<colour>.ts`, never a single file).

**Decomposition removes one conflict class — the free-tranche one.** With
_free-tranche_ clusters landing in disjoint colour files, those (and only those)
can fan out conflict-free. The general parallel loop for _mechanic_ clusters is
not delivered here: it needs a merge-train (serial integrate with rebase +
re-gate) plus decentralizing the shared append-registries those clusters
converge on. Decomposition is a _contributing_ enabler (it removes the per-card
file conflict and shrinks the gate), not the whole mechanism.

**The colour axis is chosen over the mechanic-cluster axis** as the file
boundary because colour is stable and total (every card has exactly one colour
home, decided at import time before any mechanic is known), whereas mechanic
clusters are discovered late, overlap, and shift. A card never needs to move
files because its mechanic was reclassified. Mechanic clusters remain the _issue_
unit; colour remains the _file_ unit — the two axes are deliberately decoupled.

## Consequences

- **Conflict-free parallelism for free-tranche card work only.** Two
  free-tranche clusters touching different colours never conflict. This does
  _not_ extend to mechanic clusters, which also edit shared engine registries
  (`types.ts`, `state.ts`, `serialize.ts`, `debug-panel.tsx`) and conflict there
  regardless of colour — those need the merge-train, not the file split. A
  cluster spanning multiple colours (a gold cycle) still touches multiple files
  and must be serialized against others hitting them — the fan-out batch
  selector must compute file-overlap, not assume one-file-per-issue.
- **Faster gate and lighter context** as a side effect: smaller modules cut the
  Vitest cold-start transform and shrink the file a subagent loads to add a card.
- **Affected-tests become meaningful.** A change to `red.ts` maps to
  `red.test.ts`; during iteration the subagent can run the colour's test file
  instead of the whole set. (The pre-merge gate still runs the **full** suite —
  the green-baseline invariant tolerates **zero** red, ever, regardless of which
  module changed.)
- **A large one-time mechanical migration** across ~10 sets / ~49 K lines:
  partition consts by colour, split the parallel test files, add `index.ts`
  barrels. Mechanical and self-hostable — the parallel loop can perform its own
  enabling migration, one set per worktree.
- **Sparse modules are accepted.** A set with two gold cards still gets a
  `multicolor.ts`. Consistent shape beats minimal file count; the barrel makes
  empty/near-empty modules free.
- **CPU contention on the local gate** when N subagents finish together and each
  runs the ~150 s suite. Reasoning (the dominant cost) overlaps cleanly; gates
  queue. Net throughput still scales with parallelism.

---
title: A partial vi.mock of @convex/cards is invisible to every pre-merge gate, so widening the barrel's internal use breaks 12 suites nothing sees
discoveredBy: 2339
status: draft
confidence: high
---

**What is wrong.** ~40 frontend suites replace the whole `@convex/cards` barrel
with a hand-rolled partial mock. Nothing checks those factories against the set
of exports the modules under test actually reach. So a change entirely inside
`convex/cards/` — not touching a single `src/` file — can turn a dozen unrelated
frontend suites red, and no gate a branch is required to run will notice.

**Evidence.** #2339 made `getInstanceManaCost` (`convex/cards/registry.ts:428`)
the single mana-cost authority: `convex/cards/effectiveColors.ts:27`,
`convex/cards/castRestrictions.ts:17` and `convex/cards/attackRestrictions.ts:13`
switched from re-deriving `embedded ?? tryGetDefinition(id)?.manaCost` inline to
importing `getInstanceManaCost` from the barrel. Behaviour-identical; two `opus`
reviews passed it. It turned **102 tests across 12 files** red at the
merge-train's full gate, all with
`Error: [vitest] No "getInstanceManaCost" export is defined on the "@convex/cards" mock`.

Three independent reasons nothing caught it earlier:

1. **`check:pr` runs zero app-suite tests, structurally.** `check:guards`
   (`package.json`) is
   `TOLARIA_BOT_FAST=1 vitest run --project bot-node --project bot-jsdom && vitest run --project node scripts/__tests__`.
   The 12 failing files are `src/**/*.test.tsx` in the `jsdom` project — not
   `*.bot.test.ts`, not `scripts/__tests__`. No deny-list entry is involved: the
   app suite is simply not in `check:pr`'s selection at all.
2. **The type-checker cannot see it.** A `vi.mock` factory returns an untyped
   object literal; it is never checked against the real module's export shape.
   `bun run check:ts` is green on a mock missing every export.
3. **A touched-path heuristic points the wrong way.** The diff touched
   `convex/cards/**` and `convex/gre/**`; the broken files are `src/components/board/**`
   and `src/hooks/**`, mention neither eternalize nor `manaCostOverride`, and are
   not reachable from any "suites of the modules it modifies" rule. The only
   query that would have found them is
   `grep -rl 'vi.mock("@convex/cards"' src/` — i.e. _who stubs the barrel whose
   internal imports I just widened_ — which is not in any checklist.

**The mechanizable guard.** `convex/cards/**` imports from `"."` are enumerable
statically; so are the keys of each `vi.mock("@convex/cards", …)` factory. A
`scripts/__tests__` hygiene test could assert every such factory exports a
superset of the barrel names that `convex/cards/**` modules import from the
barrel — the exact class the repo already guards mechanically elsewhere
(`bot-suite-boundary`, `bot-fast-lane`, `worktree-bootstrap`). This PR only fixed
the 40 factories and routed their mana-cost resolution through one shared helper
(`src/lib/testing/convex-cards-mock.ts`); the next name to become
barrel-internal will break them again the same way.

**Why it may not deserve its own issue.** The narrower half of the problem is
arguably a gate-scope question, not a mock question: if `check:pr` ran the app
suite (or a changed-file-reverse-dependency slice of it) this would have been
loud on the branch, and the same gap swallows _every_ app-suite-only regression,
not just mock staleness — so it may belong as a line on the workflow-modernization
PRD (#2180) rather than a ticket of its own. Against that: the reverse-dependency
slice is hard (the dependency here is a `vi.mock` string literal, not an import
edge), whereas the export-superset guard is ~30 lines and catches the class
directly. If only one gets built, build the guard.

/**
 * The guard tests that read documentation. `check:docs` runs exactly these, so
 * the docs lane's cheapness is bounded by a list — and a list drifts. The
 * census in `docs-lane.test.ts` fails when a NEW test under `scripts/__tests__`
 * reads a documentation path without being classified in `docs-lane.ts`, which
 * is the only way this list stays honest as guards get added.
 *
 * WHY A `lib/` MODULE. Two consumers read it: `docs-lane.ts` (the `docs:ship`
 * flow, which owns the census and the exclusions) and `check-lane.ts`, which
 * appends exactly this list to a code lane whenever prose travels with code
 * (ADR 0136 §3). `docs-lane.ts` imports `land.ts`, which imports
 * `check-lane.ts`, so importing the list from `docs-lane.ts` would close an
 * import cycle through the one script that runs under the merge mutex. A pure
 * module with no imports of its own breaks it.
 */
export const DOC_GATE_TESTS = [
    "scripts/__tests__/action-space.test.ts",
    "scripts/__tests__/adr-index.test.ts",
    "scripts/__tests__/agents-md-drift.test.ts",
    "scripts/__tests__/bot-globs.test.ts",
    // Issue #4686: asserts that `convex/CLAUDE.md` § Card testing convention
    // and the `/next-issue` skill name the test-hygiene census and its
    // allow-list — prose the docs lane carries on its own, so the lane that
    // merges a rewrite of either has to be the lane that re-runs this.
    "scripts/__tests__/check-test-hygiene.test.ts",
    // The CR citation ledger (ADR 0133) is accountable for every `CR` line
    // in prose too — an ADR or guide that adds a citation owes an entry — so
    // the lane that merges a doc edit runs its whole-tree assertion
    // (`bun run cr:lint`, already in `check:docs:inner`, runs the same scan;
    // the test is what keeps the gate honest if that wiring changes).
    "scripts/__tests__/cr-citation-ledger.test.ts",
    // ADR 0098's no-third-party-mirror sweep READS the instruction files that
    // tell an agent where rules come from — `.claude/skills/{mtg-rules-check,
    // new-card,new-set}/SKILL.md`, `.claude/rules/gre-development.md`,
    // `CLAUDE.md` — and asserts the rules-check skill still points at the
    // vendored document. Those are exactly the paths the docs lane carries
    // since issue #4376, so the lane that merges a skill edit has to be the
    // lane that re-runs this. (It ALSO guards `data/cr/`, which is why its row
    // used to sit in `DOC_GATE_TESTS_EXCLUDED` — that reason covered half the
    // file and stopped being enough the moment a `SKILL.md` stopped forcing
    // the full gate.)
    "scripts/__tests__/cr-source.test.ts",
    // Scans the SKILLS for two destructive data-regeneration recipes. A skill
    // step is prose the docs lane will happily carry on its own, and the
    // recipes got into the skills by being copied from a guard hint in the
    // first place — so the lane that merges a skill edit has to be the lane
    // that re-runs this.
    "scripts/__tests__/destructive-data-recipes.test.ts",
    "scripts/__tests__/findings.test.ts",
    // The ONE gate-running rule, held in two files at once (issue #3698):
    // `.claude/hooks/deny-guard.sh` § 3b and the `/next-issue` skill. Both
    // copies are prose the docs lane will carry on its own, and the whole
    // point of the guard is that they cannot drift — so the lane that merges
    // an edit to either has to be the lane that re-runs it.
    "scripts/__tests__/gate-rule-parity.test.ts",
    "scripts/__tests__/project-skills.test.ts",
    "scripts/__tests__/resident-context-budget.test.ts",
] as const;

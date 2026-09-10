---
description: Rules for developing the Bot (play AI / draft AI)
globs:
    - "convex/gre/{search,evaluate,moves,applyMove,determinize,difficulty,shouldThink,describeMove}.ts"
    - "convex/gre/ai/**"
    - "src/lib/ai/**"
---

# Bot Development Rules

You are in the Bot — read `/bot-slice` first; full seam map + doctrine.

- Every behaviour change ships a `must` blade entry in the same PR
  (`convex/gre/ai/blade/`) — a discriminating pair when the fix is a
  preference. Don't debug via self-play.
- Fix the class, never the card — no card names in identifiers, no
  per-card registries (ADR 0102).
- **A blunder is a Verdict, not a root rule** (ADR 0124 §5, issue #3399).
  Order: Verdicts → fit → report. `RootDecisionMechanism` is FROZEN behind
  `ROOT_RULE_ALLOWLIST` (`convex/gre/ai/decisionTelemetry.ts`): a new member
  needs the identical-vector proof — the two candidates share ONE feature
  vector under EVERY term — recorded in the issue its row names. Retiring one
  needs BOTH measures: `flipped` = 0 on the telemetry corpus AND `must` green
  under `BLADE_VARIANT=no-rule:<mechanism> bun run test:blade`. The rule's
  blade entries stay when the rule goes.
- Ladder is for STRENGTH claims only — declare rung + pairing dynamics;
  never to explain WHY a decision happened.
- Tests are `*.bot.test.ts` (`bot-suite-boundary.test.ts` enforces it).
- A new `EvalTerms` key needs its row in `src/lib/ai/eval-term-labels.ts`
  — the ONE table the DecisionTrace line and its legend render from
  (`Record<keyof EvalTerms, …>`, so `tsc` reds on a missing row). #2686
  shipped `manaDevelopment` and it was invisible in both.
- Determinism required — fixed `iterations`, never wall-clock (`timeMs`).
- A NEW CARD owes a Bot reachability walk too, though its diff touches no bot
  path (`gre-development.md` § Bot reachability).

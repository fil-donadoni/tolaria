---
title: The smoke planner treats a numeric `{ min, max }` choice count as a runtime amount
discoveredBy: 6622
status: draft
confidence: high
---

**What is wrong.** `analyseOwnArguments` (`convex/gre/effects/scenarioGenerator.ts`)
sends every `count` under `AMOUNT_KEYS` to `analyseValue`, which knows numbers,
refs, `{ X }` and the counter/kicker readers — but not the `{ min, max }`
range `EffectChoiceCount` admits. A range of two plain numbers falls through
to the generic `runtime-amount` skip ("reads a runtime count amount — the
canned generator does not size it"), so every search frame with a stated
quality (`count: { min: 0, max: N }`, CR 701.23b) is quarantined until a
`GOLDEN_FIXTURES` row exhibits its exact filter literal.

**Evidence.** After PR #6562 the premodern quarantine went 75 → 90, "most of
them on the smoke generator's runtime `count` form"; this issue's compile put
21 of its 22 graduates in `smoke-scenario` quarantine on the same reason, and
needed five fixture rows (one per distinct filter literal) to clear them.
Wargate (`{ type: [six permanent types], manaValueAtMost: { X } }`) stays
quarantined for want of a sixth. `fixtures.ts` is 11,000 lines and grows one
row per filter spelling.

**Why it may not deserve its own issue.** Sizing a numeric range in the planner
(pick `max`, or `min` when `max` is open) changes what the gate asserts for
~100 cards at once — each would then RUN its canned scenario instead of being
withheld, and some may fail there for reasons of their own. It is a gate
semantics decision (ADR 0105 § 7.1), not a one-line fix; it belongs on the
quarantine-classes tracker or in a `/grill` before anyone codes it.

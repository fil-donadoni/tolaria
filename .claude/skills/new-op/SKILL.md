---
name: new-op
description: Add a new Effect Script Op (or a new EffectOp field / construct usage) to the DSL — walk all seven registration sites across six files, three of which no guard covers, then write the Op's permanent test. Use when a card needs a verb the DSL doesn't have, when adding an entry to EFFECT_OP_REGISTRY, or when a review finds an Op that valuates as neutral / scenario-skips silently.
argument-hint: "<op-name>"
---

# New Effect Script Op

An Op is not one edit. **Seven registration sites across six files**, and only
four are guarded — the three that aren't fail _silently_, degrading the bot or
the smoke sweep with a green suite. This skill is the checklist that has been
missed twice.

Before anything: confirm the Op is actually needed. Per
`.claude/rules/gre-development.md` § Primitive reuse — decompose into existing
Ops, generalize an almost-right one (a parameter, not a boolean flag), check
orthogonality (a zone/mana/life operation, never a card-shaped effect). A new
Op is justified only after those three fail. Say which one you tried.

## The seven sites

| #   | File                                      | Symbol                                                 | Guarded by                                                                                                             |
| --- | ----------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | `convex/cards/types.ts`                   | the `EffectOp` union member + its doc comment          | tsc                                                                                                                    |
| 2   | `convex/gre/effects/validate.ts`          | `OP_SCHEMAS` (→ `SCHEMA_OP_NAMES`)                     | ✅ set-equality                                                                                                        |
| 3   | `convex/gre/effects/interpreter.ts`       | `OP_EXECUTORS`                                         | ✅ set-equality + tsc (keyed by `EffectOp["op"]`)                                                                      |
| 4   | `convex/cards/mechanicsRegistry.ts`       | `EFFECT_OP_REGISTRY` row                               | ✅ set-equality                                                                                                        |
| 5   | `convex/gre/effects/scenarioGenerator.ts` | **Table A** — `analyseOp` (builds the canned scenario) | ❌ **none** — a deliberate `req.skip` is legitimate, so an unhandled Op is indistinguishable from an intentional skip  |
| 6   | `convex/gre/effects/scenarioGenerator.ts` | **Table B** — `OP_ASSERTORS` (asserts the outcome)     | ✅                                                                                                                     |
| 7   | `convex/gre/ai/opValuers.ts`              | `OP_VALUERS`                                           | ✅ `opValuerCoverage.bot.test.ts` — **BOT suite**, invisible to `bun run test:app`                                     |
| 7b  | `convex/gre/ai/opValuers.ts`              | `OP_BENEFICENCE` (same file, separate table)           | ❌ **none** — `?? "neutral"` fails open; the bot loses the who-does-this-help axis and hands your gift to the opponent |

Sites 2/3/4 are the ones a guard catches within seconds
(`convex/gre/effects/__tests__/validate.test.ts` asserts the three are
set-equal). **The three that bite are 5, 7 and 7b** — 7 because it lives in the
bot suite (run `bun run check:guards`, not just the app suite), 5 and 7b because
nothing checks them at all.

## Workflow

1. **Name it for the MECHANIC, not the card** (`feedback_no_card_names_in_identifiers`).
   A generic name from card #1; a generic _shape_ only once card #2 asks for it.
2. **Site 1** — write the union member with a full doc comment: the CR rule it
   implements, the issue number, the SpellContext primitive it skins, and what
   it deliberately does NOT do. Every neighbour in that union carries one; a
   bare shape is a review blocker.
3. **Sites 2–4** — schema (validator rules for every field, including which
   combinations are rejected), executor, registry row (`status: "implemented"`
   only when it really is).
4. **Sites 5–6** — teach `analyseOp` to build a scenario that exercises the Op,
   and `OP_ASSERTORS` to assert its outcome. If the Op genuinely can't be
   scenario-ized, set an explicit `req.skip` **with a reason string** — a
   surfaced skip is fine, a silent one is the bug.
5. **Sites 7 + 7b** — a leaf valuer projecting the Op onto the feature basis
   (`convex/gre/ai/featureBasis.ts`), and its beneficence sign (does this help
   or hurt the recipient?). Both are in `opValuers.ts`; do not stop at the first.
6. **The Op's permanent test.** A new Op earns the full regime
   (`.claude/rules/gre-development.md` § DSL-first authoring): an interpreter
   unit test covering the construct combinations it participates in
   (bind/ref/if/forEach), plus **one wire-format assertion** through
   `projectPublicState`. That test is inherited free by every later card that
   reuses the Op — this is the whole "new Op pays the entry fee once" trade.
7. **Proof-of-failure** — break the executor branch, watch the test go red,
   revert, and say what you broke.

## Related shapes that use the same checklist

- **A new FIELD on an existing Op** — sites 1, 2 (validator!), 3 and, if it
  changes the Op's value or sign, 7/7b. Special hazard: a new
  `EffectCardFilter` field **fails open** on hidden-zone selectors (it matches
  everything until threaded fail-closed through the filter's allow-flags) —
  see `project_effect_filter_fail_open`.
- **A new construct combination** (bind/ref/if/forEach used a way the
  interpreter suite doesn't cover) — no registry edits, but the full test
  regime applies exactly as for a new Op.

## Gate

`bunx vitest run convex/gre/effects/__tests__/validate.test.ts
convex/gre/effects/__tests__/interpreter.test.ts
convex/cards/__tests__/effectScripts.test.ts
convex/cards/__tests__/effectScriptSmoke.test.ts`, then **`bun run check:pr`**
(which includes `check:guards` — the bot fast lane where site 7's coverage guard
lives). A green app suite proves nothing about sites 7/7b.

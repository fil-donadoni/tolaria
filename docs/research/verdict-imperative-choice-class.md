# Verdicts on a choice raised from an imperative `resolve()` (issue #8731)

Measured on `7cef9865c` (2026-11-08).

## The question

The verdict quiz refuses a decision answering a Pending Choice when the
resolution that raised it has no checkpoint: `lowerStack` blocks it under
`pendingChoices`, because a rebuild would re-run the imperative body from its
first statement (CR 608.2). Chrome Mox's imprint trigger is the case the issue
reported. How large is that class, and how does it close?

(The other blocker in the same report, `abilityResolutionRecorded`, was a
lowering gap and is fixed in the same PR: the flag is re-derived from the
trigger's resolution checkpoint, so a DSL trigger suspended on a choice now
lowers and rebuilds with its per-turn tally counted once.)

## Method

A text census of the hand-written definitions, `convex/cards/sets/**/*.cards.ts`,
one block per `export const … = defineCard`. A block is in the class when it
calls `ctx.request<Something>(` (a `requestChoice`, `requestMayPay`,
`requestOptionChoice`, … suspension) and declares no `resolveSteps` (the
checkpointed shape). Compiled and DSL cards carry no closure and cannot be in
it.

A runtime census over `catalogueDefinitions()` reading `String(resolve)` was
tried first and is wrong: helper factories (`enteredTrigger`, `phaseTrigger`)
wrap the card's closure, so the source the census reads is the wrapper's, and
Chrome Mox itself drops out.

The block-level kind (trigger / activated / spell) is a heuristic on where
the first `resolve:` sits; a card with closures at several sites counts once.

## Numbers

| Population                                         | Cards |
| -------------------------------------------------- | ----: |
| `defineCard` blocks                                |  2211 |
| …raising a choice from a closure                   |   117 |
| …of which checkpointed (`resolveSteps`)            |    17 |
| **…bare: unjudgeable while the choice is pending** |   100 |
| — through a triggered ability                      |    58 |
| — through an activated ability                     |    22 |
| — through a spell's own `resolve`                  |    20 |

The triggered half is mostly old-frame upkeep and attack/block clauses ("pay
or sacrifice", "flip a coin", "choose a card"): Lord of the Pit, Paralyze,
Mijae Djinn, Raging River, Season of the Witch, Vesuvan Doppelganger, Chrome
Mox. This table counts cards, not decisions: how often each one blocks a
Verdict depends on the decks the Bot plays, which only the lowering sweep
measures.

## Decision

**No engine change, and no class-wide migration ticket.** The refusal is
correct by construction: resuming an imperative body would replay whatever it
did before suspending, so a lowered checkpoint would rebuild a different
position. The class closes one card at a time, as each card moves to an Effect
Script through the existing per-card path (`/new-card`, a Grammar Rule, a
Hand Tail pass). Every such move removes the card from this table, and no
lowering change is needed: the DSL interpreter's checkpoint is what this
issue's Gap 1 fix made lowerable.

What would change this: a card in the class showing up in the lowering sweep
(`bun run lowering-sweep`) as a frequent `pendingChoices` blocker on a preset
deck. That card's migration is the ticket, filed as its own `/new-card` pass.

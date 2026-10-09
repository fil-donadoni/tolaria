---
title: "Each player" and host-scoped phase triggers are read one-sided, and the recurrence multiplier scales that reading
discoveredBy: 5151
status: draft
confidence: high
---

**What is wrong.** The context-free grounding reads `"each"` / `"opponents"`
scoped phase triggers and `{ ref: "$event.activePlayerId" }` as the caster's
own side, so a symmetric trigger ("each player draws a card", "each player
loses 1 life", Stasis-style locks) prices as a one-sided benefit. Issue #5151
scopes the board-grounded valuation of symmetric locks out (`/grill` pending),
but its recurrence multiplier is what makes the mis-sign LIVE: a card that sat
at its `base + MV` floor with a small one-sided script now carries that script
several times over. Measured by the PR #5333 review from a catalogue census
(default vector against `recurrence: 1`):

| Card               | Before                 | After                                                                                                                                          |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Howling Mine       | floor 28 (script 23.4) | 139.9                                                                                                                                          |
| Copper Tablet      | floor                  | 77.6                                                                                                                                           |
| Karma              | floor                  | 77.6                                                                                                                                           |
| Collapsing Borders | floor                  | 277.9                                                                                                                                          |
| Sunken Hope        | floor                  | 160                                                                                                                                            |
| Destructive Flow   | floor                  | 380 raw, clamped to 300                                                                                                                        |
| Mana Vortex        | floor                  | 360 raw, clamped to 300                                                                                                                        |
| Cold Snap          | floor                  | lifted off the inert census once its guarded cumulative-upkeep sacrifice stopped compounding: the "each player" snow-land ping reads one-sided |

Two neighbours of the same class:

- **Essence Flare** reads +30.6 above its floor (one of issue #5151's own
  acceptance cards): its recurring `-0/-1` counter lands on the Aura's HOST,
  a drawback, but the shadow puts it on `$source` and the reading prices it as
  a benefit. The criterion validates a sign error inherited from the shadow.
- `noncreatureCardWorth` (`convex/gre/ai/candidateValue.ts`) has no
  `MAX_LATENT_SCRIPT_VALUE` clamp, so the multiplied values reach top-K
  admission of a search-library answer set unclamped (ordering only; the leaf
  valuation is clamped).

**Evidence.** `convex/gre/ai/grounding.ts` `contextFreeGrounding().isSelf`
answers `true` for every `{ ref }` and for `"controller"`; `phaseTrigger`
carries its `scope` in a closure, so no reader can tell "your" from "each"
without a marker on the `TriggeredAbility`. The symmetric-sweep lens
(`LatentLens.sweepUnits`, issue #4773) solved the same shape for `forEach`
sweeps by reading the real board; a phase trigger has no such lens.

**Why it may not deserve its own issue.** It is the `/grill` the issue already
names (board-grounded valuation of symmetric locks), with the recurrence
multiplier as the reason it is now urgent rather than cosmetic. The one
mechanical fix that stands on its own is a `scope` marker on
`TriggeredAbility` stamped by `phaseTrigger`, which would let the reader give
`each` / `host-controller` scopes weight 1 (or a net-of-both-sides reading)
without the grill.

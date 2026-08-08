---
title: Five more PermanentFilter fields marked "adapter-only" fail OPEN on the human picker, all with shipped cards behind them
discoveredBy: 2373
status: draft
confidence: high
---

**What is wrong.** `#2373`'s blocking review found that
`PermanentFilter.excludeInstanceIds` was marked `"adapter-only"` in
`MIRROR_CENSUS` while the human battlefield picker evaluates the wire filter
through the `ClientPermanentFilter` **mirror**, which had no branch for it — so
it failed OPEN (the client rings a pick the server then rejects with "Card does
not match the required filter"). That PR fixed `excludeInstanceIds` and
`instanceIds`. **Five more `"adapter-only"` fields have the exact same shape and
a shipped card already driving each one.**

The census's stated defence for `"adapter-only"` is "no shipped board-highlight
filter needs it yet". That premise is false for these five.

**Evidence.** The mirror `matchesPermanentFilter` (`src/lib/card-utils.ts:601`)
is reached from six call sites in `src/hooks/useBattlefieldVisualState.ts`, fed
by four wire-carried `PermanentFilter` objects — none of which is narrowed by a
`candidateIds` allow-list on the battlefield branch:

| call site                          | filter carrier                            |
| ---------------------------------- | ----------------------------------------- |
| `useBattlefieldVisualState.ts:161` | `SacrificeRequirement.filter`             |
| `useBattlefieldVisualState.ts:197` | `pendingActivation.tapOtherChoice.filter` |
| `:333`, `:561`                     | `pendingChoices[0].filter`                |
| `:356`, `:709`                     | `pendingCast.additionalCost.filter`       |

Fields marked `"adapter-only"` at `src/lib/card-utils.ts:3186` onward, honoured
by the engine matcher at `convex/cards/filters.ts`, absent from the mirror:

| field                | shipped producer reaching the picker                                                                                                                                      | fail-open symptom                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `isToken`            | `convex/cards/sets/one/black.ts:37` Sheoldred's Edict (`choice` Op, `isToken: false`); `arb/multicolor.ts:22` Thopter Foundry `sacrificeFilter`                           | "sacrifice a **nontoken** creature" rings tokens as legal              |
| `supertypes`         | `convex/cards/sets/ice/red.ts:981` Glacial Crevasses `sacrificeFilter` (`supertypes: ["Snow"]`); `ice/red.ts:1443` Karplusan Giant `tapOtherFilter`                       | "sacrifice a **snow** Mountain" rings every Mountain                   |
| `controllerRelation` | `convex/cards/sets/fem/blue.ts:633` Vodalian War Machine `tapOtherFilter` (`controllerRelation: "you"`); `fem/white.ts:270` Hand of Justice; `ice/black.ts:1179` Hecatomb | "tap an untapped Merfolk **you control**" rings the opponent's Merfolk |
| `createdBy`          | `convex/cards/sets/atq/colorless.ts:2229` Tetravus `requestChoice`                                                                                                        | rings Thopter tokens created by a _different_ Tetravus                 |
| `isAttacking`        | `convex/cards/sets/lea/red.ts:933` Raging River `partition` choice                                                                                                        | rings non-attacking creatures in the left/right partition              |

`excludeInstanceIds` / `instanceIds` are **already fixed** by #2373's fixup and
are listed only to establish the class.

**Severity is uneven.** `isToken`, `supertypes` and `controllerRelation` are the
sharp ones — each is a plain restriction on a common, frequently-played
affordance, so a human seat is offered an illegal pick and gets a raw server
error on click. `createdBy` and `isAttacking` sit behind `resolve()` cards whose
prompts are already narrow, so the practical exposure is smaller.

**Cost is not uniform, which is why this was not folded into #2373.**
`isToken`, `createdBy` and `isAttacking` are one-line boolean/equality branches
on fields `CardInstance` already carries over the wire. `supertypes` needs the
printed-supertypes lookup the mirror already does for `excludeSupertypes`
(`card-utils.ts:645`), so it is cheap but not one line. **`controllerRelation`
is a genuine seam change**: it needs a `FilterMatchContext`
(`selfControllerId` / `selfInstanceId`) that no client call site threads today —
six call sites in `useBattlefieldVisualState.ts` plus the `PendingChoice` /
`SacrificeRequirement` shapes would have to carry the source's controller and
instance id. That is the piece that makes this a ticket rather than a follow-up
commit.

**Why it may not deserve its own issue.** Every one of these fails in the _safe
direction for game state_ — the server re-validates and rejects, so no illegal
play is ever persisted (ADR 0074: the client has no authority). The damage is
purely UX: a ringed card that errors on click. If the team's line is that
picker-highlight drift is cosmetic, this belongs as lines on the existing mirror
tracker (#1938's lineage) rather than a fresh ticket. The counter-argument is
that this is now the **third** repetition of the same bug class (#1938
`excludeSubtypes`, #2373 `excludeInstanceIds`, these five) and each round was
caught only by a human reviewer probing by hand — the `MIRROR_CENSUS` guard
green-lights `"adapter-only"` by construction, so it structurally cannot catch
the next one. A ticket that changes the guard — e.g. requiring an
`"adapter-only"` entry to prove no shipped filter reaches a mirror call site,
rather than asserting it in a comment — would retire the class instead of the
instance.

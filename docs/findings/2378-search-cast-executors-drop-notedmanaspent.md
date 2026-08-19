---
title: Neither bot cast executor reconstructs notedManaSpent, so every Sunburst permanent enters the search tree with zero counters
discoveredBy: 2378
status: draft
confidence: medium
---

**What is wrong.** The bot never plays the real `announceCast` /
`tryAutoCommitPendingCast` commit path — it has two wholesale
reimplementations of "build a StackItem from a cast", and neither one produces
`StackItem.notedManaSpent`. That is a documented simulation limit (coarse mana:
the tap plan taps sources without draining the pool coin-exact), and it was
harmless while the only consumers were Soul Burn's X damage and Vibrance's
check-time condition. Sunburst makes it visible on the board: in every rollout
Pentad Prism enters with **zero** charge counters.

The consequence is narrower than "the bot cannot see the card" but sharper than
it sounds. The Prism's mana ability IS enumerable — `moves.ts` offers it for a
Prism that has counters — but in-tree the Prism never HAS counters, so the
ability is never reachable, never valuated, and the Prism scores as a blank {2}
artifact that does nothing. The "bot visibility" acceptance criterion on #2378
is therefore only half met: the move exists, the state that makes it legal does
not.

**Evidence.**

- ISMCTS in-tree executor: `convex/gre/search.ts:688-747` (`case "cast-spell"`)
  builds its stack item from `move` fields only — `targets`, `chosenX`,
  `chosenModeId`, `castOffSorceryTiming`. No mana-spend record.
- Greedy 1-ply sandbox: `convex/gre/applyMove.ts:600-640`, same shape, same
  omission.
- The limit is stated, not accidental: `convex/gre/search.ts:484` ("an
  activation's `notedManaSpent` (CR 106.10) … not reconstructed on the search's
  stack item") and again at `convex/gre/search.ts:822` for the activation
  branch. Both comments predate this issue and speak of ACTIVATIONS; the cast
  branch has the same hole and no comment at all.
- The payoff reads exactly that field at entry:
  `convex/gre/state.ts:6126` — `manaSpentToCast: item.notedManaSpent ?? {}` —
  so an absent record is indistinguishable from "colourless mana only" and
  `resolveEntersWithCounters` returns 0.
- `convex/cards/sets/5dn/__tests__/colorless.bot.test.ts` proves the ability is
  ENUMERATED from a Prism that already has counters. It does not (and cannot,
  as written) prove a rollout ever reaches such a Prism.

**Why it may not deserve its own issue.** The honest fix is not "special-case
sunburst in the executors" — it is the general one the two comments already
name: give the search a mana model exact enough to reconstruct a pool delta
from a tap plan, which is a real piece of work on the hottest loop in the bot
and would be paid for by every rollout. A cheaper local patch (derive the
per-colour spend from `move.tapPlan`'s sources) is plausible, but it duplicates
payment logic in a third place, and today it buys a stronger line only for one
common artifact. It is probably a line on a bot-fidelity tracker — beside
`additionalSacrificeSnapshot`, which is missing from the same two sites for the
same reason — rather than a Sunburst ticket. It becomes worth doing when a
Converge / Sunburst card whose payoff actually swings a game ships.

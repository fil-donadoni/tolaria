---
title: commitLandsForCost matches only the FIRST colour of a multi-colour chosenMana
discoveredBy: 3263
status: draft
confidence: medium
---

**What is wrong.** A source that deposited more than one colour in a single tap
can be untapped again after its mana has been spent, refunding mana that is no
longer there — a repeatable free-mana loop.

**Evidence.** `convex/gre/state.ts:22318` — `commitLandsForCost`'s local
`getManaColor` returns the FIRST colour of `card.chosenMana` in `MANA_COLORS`
order and nothing else:

```ts
if (card.chosenMana) {
    for (const color of MANA_COLORS) {
        if (((card.chosenMana as Record<string, number>)[color] ?? 0) > 0) {
            return color;
        }
    }
}
```

A source whose snapshot is `{W:1,B:1}`, spent on a cost containing only `{B}`,
therefore never matches (`getManaColor` answers `"W"`), is never marked
`manaCommitted`, and the `wasTapped && card.manaCommitted` guard in `tapUntap`
(`convex/game.ts:14922`) lets the player untap it — `refundChosenManaOutput`
then decrements a pool the cost already emptied, and the source is untapped and
free to tap again.

Reachable today through multi-colour `manaChoices` outputs:
`convex/cards/sets/ice/white.ts:220` (`{C:1,U:1}`) and
`convex/cards/sets/ice/red.ts:1990` (`{R:2,G:1}`). Not introduced by issue
#3263 — but that change makes the multi-colour `chosenMana` snapshot the normal
state of every source it newly enables, so the class is worth closing rather
than leaving to the two ICE cards.

**Why it may not deserve its own issue.** It is one function and one predicate,
and the fix is small (commit a source when ANY colour of its `chosenMana` is
still owed, or commit one source per mana it contributed). If the surviving
reachable set stays at two `manaChoices` cards it is a line on an existing
mana-plumbing tracker rather than a ticket of its own — the call is a human's.

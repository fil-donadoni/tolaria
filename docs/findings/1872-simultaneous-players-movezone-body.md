---
title: Exhume and Show and Tell still put cards onto the battlefield one player at a time (CR 101.4)
discoveredBy: 1872
status: draft
confidence: medium
---

**What is wrong.** #1872 widened `forEach`'s `simultaneous` flag to the
`{ set: "players" }` + `[choice, sacrifice|discard]` shape, so every player's
choice is collected before any action applies (CR 101.4, "Then the actions
happen simultaneously"). Two cards with the same `forEach{players}` + `choice`
shape were deliberately left OUT of that widening because their terminal Op is a
`moveZone` **to the battlefield**:

- `convex/cards/sets/usg/black.ts:24` — Exhume, "Each player puts a creature
  card from their graveyard onto the battlefield."
- `convex/cards/sets/usg/blue.ts:93` — Show and Tell, "Each player may put an
  artifact, creature, enchantment, or land card from their hand onto the
  battlefield."

Both Oracle lines are CR 101.4 lines, so both are wrong today in the same two
ways: the second player chooses knowing what the first already put onto the
battlefield, and the permanents enter as N separate CR 400.7 events rather than
one — so an ETB trigger or a static grant sees only some of its siblings.

**Evidence.** The interpreter's two new simultaneous paths are
`convex/gre/effects/interpreter.ts:5264` (graveyard batch, issue #1094) and the
players choices-then-actions pass added by #1872 just below it. The validator
gate is `isSimultaneousPlayerChoiceBody` in
`convex/gre/effects/validate.ts`, which admits only `sacrifice` / `discard` as
the terminal Op, and its doc comment records exactly this exclusion.

Deferring the moves alone — the cheap fix — would close the _choice_ half and
leave the _entry_ half wrong, which is the worse outcome: the card would read as
handled while still firing N entry events. A correct fix needs a batch-entry
primitive keyed on a per-player PICK. One exists for a whole graveyard SET
(`SpellContext.returnGraveyardSetToBattlefield`, the primitive the #1094 path
hands its frozen member set to) but not for "one card each, chosen by its
owner", and Show and Tell's source zone is the HAND, which that primitive does
not read at all.

**Why it may not deserve its own issue.** The divergence is invisible for the
overwhelmingly common line — two creatures entering with no ETB triggers and no
static grants between them plays identically either way, and Exhume's own
selection is usually forced (one legal creature card each). It also overlaps
substantially with whatever ticket eventually generalizes
`returnGraveyardSetToBattlefield` into a zone-agnostic batch-entry primitive; if
that work is coming anyway, this is a line on it rather than a ticket. The
counter-argument is that Show and Tell is a real constructed card whose whole
point is the simultaneous entry, and a player putting an Emrakul in after seeing
their opponent's pick is a strictly different game.

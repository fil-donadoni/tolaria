# Sacrifice-self as a fixed-output mana ability

## Status

accepted

## Context

Basal Thrull (FEM) reads "**{T}, Sacrifice this creature: Add {B}{B}.**" — a mana
ability (CR 605.1a: it adds mana, has no target, and isn't a loyalty ability, so
it resolves immediately without using the stack) whose activation cost includes
both a {T} component _and_ sacrificing the source. It is the first **fixed-output**
mana ability in the engine whose cost sacrifices the source permanent. The same
shape is reused by FEM's C6 sacrifice-land cycle (Ruins of Trokair et al., "Add
two mana of any one colour, then sacrifice") and Implements of Sacrifice.

The `ActivatedAbility.cost.sacrifice?: boolean` field ("sacrifice THIS source")
already existed and was already honoured in two places:

1. **Stack-ability activation** (`commitAbilityActivation`) — pays `cost.sacrifice`
   by moving the source to the graveyard (Atog-style sacrifice-for-effect cards).
2. **The `manaChoices` tap-mana path** — a tap mana ability that offers a choice
   list (`manaChoices` / `getManaChoices`) already branched on `isSacrifice` and
   moved the source to the graveyard instead of tapping it.

But a **fixed-output** tap mana ability (one with a static `manaProduced` and no
choice list — the path lands/Mox/Sol Ring take) went through a separate branch
that unconditionally set `card.isTapped = true` and never read `cost.sacrifice`.
Basal Thrull produces a fixed `{B}{B}` (single colour, amount 2), so it routes
to the fixed branch — where, before this change, it would tap-without-sacrificing.
That is the cost shape the PRD (#566) called "already allowed but unexercised":
the field and the choice-path handling shipped, but the fixed-output path silently
dropped the sacrifice.

There are three sites that tap a fixed-output mana source:

- `tapSourceIntoPayment` — tapping for mana mid-payment from the auto-tap helper.
- `tapForPayment` mutation — the player taps a source during a `pendingCast`.
- `tapUntap` mutation — the player taps a source while holding priority.

All three shared the same gap.

## Decision

Honour `cost.sacrifice` in the fixed-output tap-mana path at all three sites.
When a fixed-output mana ability has `cost.sacrifice === true`:

- **Do not tap** the source (`card.isTapped` is left unchanged).
- Produce the mana exactly as the fixed path already does (read `manaProduced`
  via `getActivatedManaColor` / `getFixedManaAmount`, add to the pool, emit the
  `PERMANENT_TAPPED` event _before_ the source leaves so leaves-the-battlefield
  triggers see the mana already added, CR 605.2).
- **Move the source to the graveyard** (sacrifice, CR 701.21) instead of tapping.
- The activation is **one-way**: a sacrificed source is never recorded as an
  untappable `tappedLandIds` entry, so the existing
  `"Cannot untap a sacrifice ability"` guard (already present in `tapUntap`)
  continues to hold and the source can't be "un-sacrificed".

No new `ActivatedAbility` field is introduced — this is the existing
`cost.sacrifice` boolean, now consistently paid across every mana-ability code
path rather than only the stack-ability and choice-mana paths.

Basal Thrull is defined with `cost: { tap: true, sacrifice: true }` and
`manaProduced: { B: 2 }`, `useStack: false`.

## Consequences

- Self-sacrifice mana abilities with a fixed multi-pip single-colour output now
  work end-to-end through priority, mid-cast payment, and the auto-tap helper.
- The C6 sacrifice-land cycle and Implements of Sacrifice reuse this path
  unchanged — they are the same fixed-output sacrifice shape.
- No regression risk for non-sacrifice fixed sources: the new branch is gated on
  `cost.sacrifice === true`, which is `undefined`/false for every land, Mox, and
  mana rock shipped to date.
- Restricted-mana sacrifice sources (a hypothetical Mishra's-Workshop-style
  sacrifice ability) are not in scope; the restricted-mana sub-branch is untouched
  and still taps. No FEM card needs that combination.

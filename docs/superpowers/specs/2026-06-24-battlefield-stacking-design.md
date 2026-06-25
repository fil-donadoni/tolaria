# Battlefield identical-permanent stacking (Arena-style)

**Date:** 2026-06-24
**Status:** Design approved — ready for implementation plan
**Prototype:** `src/routes/prototype-stack.route.tsx` (`/prototype/stack?variant=A`, throwaway — delete on fold-in)

## Problem

The spatial battlefield renders every permanent in its own slot. A board with
many copies of the same card (basic lands, tokens, identical vanilla creatures)
spreads wide and reads as noise. MTG Arena collapses runs of identical
permanents into a single fanned **stack** with a count badge, keeping the board
compact while every individual instance stays clickable.

We want the same: permanents that are **identical in every gameplay-relevant
way** collapse into one stack; anything with instance-specific state stands
alone.

## Stacking identity

Two permanents stack together **iff** they are "clean" (no altered state) AND
share the same identity key.

### Identity key (must match)

- `card.card.id` — same card / printing (drives art + name)
- `isSummoningSick` — a sick creature looks/plays differently from a ready one

### Excluded from the key (still stack)

- `isTapped` — **excluded by design.** Tapping one land must not eject it from
  the stack; otherwise the row fragments card-by-card as you tap for mana. A
  stack freely mixes tapped and untapped members.
- `manaCommitted` — excluded for the same reason (it rides along with the
  tap-for-mana cycle; including it would re-fragment the stack the moment a land
  taps).

### Breaks the stack → renders as a singleton ("altered" predicate)

A permanent is **not** stackable (always its own group) if ANY of:

- `counters` non-empty
- `damageMarked > 0`
- `temporaryPTMods` non-empty
- `attachedTo` set (it is an aura/attachment — handled by the existing
  host-overlay path, never a standalone slot)
- it is a **host** of any aura/equipment (`attachedAurasByHost` /
  attachment-by-host has an entry for its id)
- any of `grantedActivatedAbilities` / `grantedStaticAbilities` /
  `grantedTriggeredAbilities` non-empty (aura/effect-granted ability → altered)
- `colorOverride` set
- `copiedFrom` set
- `isAttacking` or `isBlocking` (combat involvement makes the instance
  individually meaningful)

Rationale: stacks are a pure visual compaction of **interchangeable** objects.
The instant a permanent carries instance-specific state a player must read or
target precisely, it leaves the stack and renders in full.

## Layout & interaction

### Footprint is FIXED — never reflow (hard rule)

A stack occupies a stable footprint. Hover/expand/lift **must never change the
layout box** or push neighbouring permanents. Any expansion floats in an
**overlay** (absolute, high z-index, outside layout flow) above the
neighbours. The prototype's reflow-on-hover behaviour is the anti-pattern this
rule forbids.

### Member order inside a stack

Always **untapped first, then tapped** (`untapped × k → tapped × m`), stable by
instance id within each segment. Re-sorted on every tap/untap toggle, so the
sequence is never interleaved (never `tapped-untapped-tapped`). Tapped members
render with the usual 90° rotation, grouped at the tail.

### Size-driven presentation

| Stack size         | Resting presentation                                                                                  | On hover                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `1` (or singleton) | normal single card                                                                                    | normal card behaviour                                                                                          |
| `2 … 8`            | **horizontal fan** — fixed reveal offset (base 34px), clamped so the fan never exceeds **360px** wide | per-card **hover-lift**: the hovered instance rises in z and pops up (~16px) so it can be read/clicked exactly |
| `> 8`              | **depth-pile** — tight diagonal offset (~4px), ~1-card footprint, `×N` badge                          | the pile **expands to the fan in overlay** (no reflow); then per-card hover-lift applies                       |

- `×N` count badge on every stack with ≥2 members (top-right).
- Clamp: for `2…8`, reveal offset = `min(34, (360 − cardW) / (N−1))`.
- The `> 8 → depth-pile` threshold keeps very large stacks at a single-card
  footprint; the overlay fan restores per-instance selection on demand.

### Selection / targeting

Every instance remains individually clickable (that is why we fan rather than
show one representative). Click/right-click/targeting on a fanned or
hover-expanded member dispatches exactly as it does for an un-stacked card —
the stack is presentation only; the underlying `CardInstance` list is
unchanged. Hover-lift + the overlay fan guarantee the intended instance is
reachable even when members heavily overlap.

## Where it plugs in

Presentation-only layer over existing projected state — **no GRE / backend
change**, no new `CardInstance` fields.

- **Grouping** — a new pure helper (e.g. `src/lib/battlefield-stacks.ts`):
  `groupBattlefield(perms, attachmentsByHost) → Group[]`, where a `Group` is
  either a singleton or an ordered stack. Pure + unit-tested in isolation.
- **`src/components/board/board-battlefield.tsx`** — already computes
  `attachedAurasByHost`; feed both into `groupBattlefield`, then lay out
  **groups** (not raw permanents) through the existing `rowLayout`
  (`src/lib/board-layout.ts`). A singleton group lays out exactly as today; a
  stack group occupies one footprint slot and renders the fan/depth-pile.
- **New component** `BattlefieldStack` (one stack: fan / depth-pile / overlay
  expand / hover-lift / count badge), composing the existing
  `BoardBattlefieldCard` for each member so tap rotation, P/T, counters, rings,
  targeting and abilities are inherited unchanged (one component per file).
- **Card dimensions / overlap constants** stay sourced from `board-layout.ts`
  (`CARD_WIDTH` 120, `CARD_HEIGHT` 168).

## Testing

- **Unit (`groupBattlefield`)** — identity key matches on `card.id` +
  `isSummoningSick`; tapped/`manaCommitted` differences DO stack; each "altered"
  condition (counter, damage, temp mod, aura host, attached aura, granted
  ability, colorOverride, copiedFrom, attacking, blocking) ejects to a
  singleton; member order is untapped-then-tapped, stable.
- **Wire format** — run `groupBattlefield` against `projectPublicState` output
  (slim `card: { id }`, stripped fat fields) and assert grouping is identical to
  the fat-state result. Mandatory: the projection reshapes exactly the fields
  the identity key reads.
- **Component** — fan for `2…8`, depth-pile for `> 8`, badge `×N`, hover
  never changes the layout box (footprint stable: assert neighbour positions
  unchanged on hover), every member individually clickable.

## Out of scope

- No change to game rules, GRE, or persisted state.
- Opponent permanents stack by the same rule (read-only; same projection).
- Hover-expand animation polish is implementation detail, not spec.

## Open implementation notes

- The prototype reflows neighbours on hover-expand — **must not** ship; the
  real impl overlays (see "Footprint is FIXED").
- Decide animation for a member migrating across the untapped→tapped boundary
  on tap (smooth `left` transition vs instant); cosmetic, not blocking.

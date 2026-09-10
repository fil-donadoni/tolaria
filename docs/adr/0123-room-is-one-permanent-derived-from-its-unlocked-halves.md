# A PERMANENT split card is one permanent whose characteristics are DERIVED from its unlocked-designation set (CR 709.5 — every Room); the twin swap does not survive 709.5b (amends ADR 0041, extends ADR 0121)

## Status

accepted (amends [ADR 0041][adr-0041]'s out-of-scope clause for CR 709.5;
extends [ADR 0121][adr-0121], which admitted CR 709.1–709.4 and left the
permanent class in the bucket for this record; sibling of [ADR 0122][adr-0122];
decides issue #3306)

## Context

ADR 0121 split `layout: "split"` into three classes and admitted one of them.
Measured against the vendored corpus (`data/oracle-corpus.json.gz`), **30** of
the 137 split cards have a permanent face, and every one is
`Enchantment — Room // Enchantment — Room`. The compiler gate it shipped is
CR-shaped rather than name-shaped — _a split card with a permanent face is
refused_ — 30 for 30, with no card-name list to rot. That gate was always meant
to be a placeholder for a decision, not the decision: ADR 0041 prescribes one
`ready-for-human` issue per unmodelled layout, and issue #3306 is it.

**The decision has been taken: model CR 709.5.** The Vintage Cube card it
unblocks is **Walk-In Closet // Forgotten Cellar**; the other 29 Rooms follow
for free once the rule is modelled, because nothing about them is card-shaped.

### What CR 709.5 actually asks for

`bun run cr 709.5`:

- **709.5** — a shared type line "represents two static abilities that function
  on the battlefield": "As long as this permanent doesn't have the 'left half
  unlocked' designation, it doesn't have the name, mana cost, or rules text of
  this object's left half", and its mirror. "These abilities, as well as which
  half of that permanent a characteristic is in, are part of that object's
  **copiable values**."
- **709.5a** — "Each half of a split card with a shared type line shares the
  types and subtypes listed on that card's shared type line."
- **709.5b** — the existence of each half is part of the copiable values "even
  if that object is a spell on the stack. This is an exception to rule 709.3b."
- **709.5c/5d** — the two unlocked designations; a permanent enters with the
  designation of the half that was cast, and with neither if neither was.
- **709.5e** — the **unlock cost** special action: pay a locked half's mana cost
  to give the permanent that half's unlocked designation, "any time they have
  priority and the stack is empty during a main phase of their turn."
- **709.5f/5g** — effects that unlock and lock a half.
- **709.5h/5i** — abilities triggering on unlocking a half, and on **fully
  unlocking** the permanent.
- **709.5j** — "a 'door' of a Room permanent … is a half of that permanent."

### Three of issue #3306's six seams are not the seams it names

The issue's Agent Brief was written before any of these files was read for this
purpose, and its cost estimate is wrong in three places. Recording the
corrections IS most of this decision, because they are what moved the answer
from "schema-level layout work" to "four ordinary slices".

**The unlocked designations are not a `designations.ts` concern.**
`convex/cards/designations.ts` is **pure display data** — a registry of global
fallback MARKER-CARD art, keyed by designation id, the direct analogue of the
emblem registry (issue #1199/#1305). The Monarch's gameplay does not live there
either; it lives in `GameState.monarchId`. There is no marker card printed for
"left half unlocked", and there is nothing for that registry to hold. The
unlocked designations are permanent-scoped state on the permanent instance.

**The suppression is LAYER 1, not layer 3 / layer 6.** CR 613.1a: "Layer 1:
Rules and effects that modify copiable values are applied." CR 709.5's last
sentence puts the two static abilities, and which half a characteristic is in,
**inside the copiable values**. So the locked half's name, mana cost and rules
text are already absent from the object the layer series starts with — 613.1
begins "with the actual object", and layer 1 has finished with it before layer 2
runs. The layer system therefore does not need an object shape for a half, and
does not change at all. What changes is where a permanent split card's printed
characteristics come from.

**The 709.5e window already exists.** "Any time they have priority and the stack
is empty during a main phase of their turn" is character-for-character
`isSorceryTimingFor(state, playerId)` (`convex/gre/phases.ts`) — the
caster-aware predicate issue #1690 split out of the player-agnostic
`isSorceryTiming` precisely because asking the turn-scoped form on behalf of a
non-active player silently answers about somebody else. The unlock action is not
a new timing window; it is the oldest one in the engine, asked correctly.

## Decision

**CR 709.5 leaves ADR 0041's out-of-scope bucket. A permanent split card is ONE
permanent whose characteristics are DERIVED, at read time, from its
unlocked-designation set — the same mechanism ADR 0121 already uses for CR
709.4, given one more argument. It is NOT cast through a half twin: CR 709.5b
is an explicit exception to the rule the twin exists for.**

### 1. The unlocked designations are copiable permanent state

The permanent instance (`convex/gre/state.ts`) carries the set of unlocked
sides — the same `SplitHalfSide` union `convex/cards/splitCard.ts` already
exports, so "door" (709.5j) is a naming convention over `left`/`right` and never
a second vocabulary. Two properties bound the field:

- It is **copiable** (709.5, last sentence). It therefore belongs with the
  copiable values a copy effect reproduces, not with damage and counters, which
  a copy does not.
- It is **permanent-scoped**, so it lives on the instance and nowhere near the
  player-scoped designations (`GameState.monarchId`) or their art registry.

Being an optional `GameState` field, it owes its row in `PERSISTED_OPTIONAL_KEYS`
(`convex/gre/serialize.ts`) — the drift guard fails otherwise.

### 2. The derivation takes the designation set, and the type line is SHARED

`deriveSplitCombination(halves)` (`convex/cards/splitCard.ts`) is CR 709.4's
combination: two names joined, mana costs merged, types unioned, in every zone
but the stack. CR 709.5 is the same shape with two differences, and both are
rule text rather than special-casing:

- **The unlocked set selects which halves contribute** the name, mana cost and
  rules text (709.5). Zero unlocked halves — 709.5d's "neither half was cast",
  a Room put onto the battlefield by an effect — yields a permanent with the
  shared type line and no name, no mana cost and no text. That is not a
  degenerate case to guard against; it is what the rule says the object is.
- **The types and subtypes are the SHARED type line** (709.5a), not 709.4c's
  union over the halves. `Enchantment — Room` is one type line that both halves
  share, and a locked half subtracts nothing from it.

The derivation stays a **pure function computed at read time**, never a stored
mutation of the permanent's characteristics. An unlock changes one field —
the designation set — and every characteristic that depends on it is recomputed,
exactly as CR 613.1 requires and exactly as the P/T layers already behave.

### 3. 709.5b kills the twin swap, so a permanent split card is cast as ITSELF

ADR 0121 registers `${id}#left` / `${id}#right` twins because CR 709.3b says
that while on the stack, only the cast half's characteristics exist — casting
Deliver puts a `{2}{U}` Instant named "Deliver" on the stack and not a
`{2}{W}{U}` anything. 709.5b is the named exception to that rule: for a shared
type line, **both halves exist on the stack too**. A Room therefore gets no twin
registration. The stack item is the parent definition plus the side that was
chosen, and 709.5d reads that side at resolution to stamp the entering
designation.

`splitHalfTwinDefinition` and `offersPrintedCast` (`convex/cards/splitCard.ts`)
gain the permanence branch. This divergence, and not the designations, is why
CR 709.5 could not ride along inside ADR 0121: the two classes want opposite
things from the stack.

### 4. The unlock is a fourth special action — and the first that pays a real cost

`SPECIAL_ACTION_MOVE_KINDS` (`convex/gre/moves.ts`) grows a fourth member for
CR 116.2 / 709.5e, class-named for the rule and never for Rooms. Its timing
predicate is `isSorceryTimingFor` (§Context). What is genuinely new is the
**cost**: `play-land` is free, `summon-companion` is a fixed `{3}`, and morph's
`turn-face-up` pays the printed morph cost — none of the three carries a tap
plan. An unlock cost is a locked half's own mana cost (709.5e), so this Move is
the first special action that must carry one, on the same channel a cast does.

### 5. 709.5i is derived from 709.5h at ONE emission site

Both triggers fire from the moment the designation is granted, never from the
action that caused it — 709.5h is explicit that it triggers "regardless of
whether it was given that designation while entering the battlefield or after
entering the battlefield", which covers 709.5d's ETB grant, 709.5e's special
action and 709.5f's unlock effects with one emitter. That emitter compares the
designation set before and after: it emits the unlock-a-half event always, and
the fully-unlock event when the post-state holds both and the pre-state did not
(709.5i). Two `GameEventType` members, one site, no second derivation to drift.

709.5g's lock removes a designation and triggers nothing — the rule names no
lock trigger, and neither does the engine.

### 6. Slicing

The mechanic ships WHOLE, and the card ships in the last slice. Nothing here is
a marker or a documented divergence.

- **Slice 1 — state and derivation.** The unlocked-designation set on the
  permanent as a copiable value, its `PERSISTED_OPTIONAL_KEYS` row, the
  derivation taking the set (709.5, 709.5a, 709.5c), and the compiler gate
  admitting a split card with a permanent face. The frontend wiring walk
  belongs here: the permanent's rendered name and text come from the
  derivation, so `projectPublicState` must carry the designation set or the
  client renders a Room that never changes.
- **Slice 2 — the cast and enter path.** 709.5b (no twin, both halves on the
  stack, the chosen side on the stack item) and 709.5d (enters with the cast
  half's designation).
- **Slice 3 — the unlock.** The 709.5e special action with its tap plan, plus
  709.5f/5g as Effect Script Ops, plus the Bot seams: `enumerateMoves` must
  reach the action, and `OP_VALUERS` / `OP_BENEFICENCE` must want it — an
  unvalued Op fails open to neutral, which is a Bot that never opens a door.
- **Slice 4 — the triggers and the card.** 709.5h/5i, then **Walk-In Closet //
  Forgotten Cellar**. It is blocked on issue #2244 (ADR 0093) for its left
  half's graveyard-play permission record, and on nothing else.

## Consequences

- **30 Room cards become reachable**, and PRD #1525 records Walk-In Closet //
  Forgotten Cellar as unblocked by decision, pending the slices. ADR 0121's
  consequence "30 Room cards stay unshipped … out of scope until CR 709.5 gets
  its own decision" is discharged by this record.
- **ADR 0121's compiler gate is lifted in slice 1, not narrowed.** Fuse
  (CR 702.102, 22 corpus cards, none in any shipped pool) keeps its own refusal
  and stays out of scope — this record touches only the permanent class.
- **`SplitHalf`'s field list grows in slice 1.** Its doc comment
  (`convex/cards/types.ts`) bounds the fields on CR 709.3b and says a permanent
  split card "is CR 709.5, a different rule and out of scope (ADR 0121; issue
  #3306)"; a Room half has statics, triggers and rules text that function on the
  battlefield, so keywords, static and triggered abilities join the record and
  that comment is revised.
- **The layer system is untouched**, which is the load-bearing claim of §2. If
  a future card makes a locked half's suppression observably interact with an
  external text-changing or ability-removing effect, that card — not this
  record — is where layer 3 / layer 6 shapes get built. No such card exists in
  the corpus's 30.
- **"Door" is not a synonym to maintain** (709.5j): the field, the Move and the
  events are named in halves and sides, and Room oracle text reading "unlock
  this door" lowers onto the same words.

[adr-0041]: 0041-worklist-driven-cross-set-card-implementation.md
[adr-0121]: 0121-split-card-is-one-combined-definition.md
[adr-0122]: 0122-modal-double-faced-card-is-a-front-face-with-a-back-twin.md

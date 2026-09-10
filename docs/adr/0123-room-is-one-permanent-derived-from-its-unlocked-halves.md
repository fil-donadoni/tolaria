# A PERMANENT split card is one permanent whose characteristics are DERIVED from its unlocked-designation set (CR 709.5 — every Room), and that set is CARRIED IN THE PRESENTED DEFINITION ID (amends ADR 0041, extends ADR 0121)

## Status

accepted (amends [ADR 0041][adr-0041]'s out-of-scope clause for CR 709.5;
extends [ADR 0121][adr-0121], which admitted CR 709.1–709.4 and left the
permanent class in the bucket for this record; sibling of [ADR 0122][adr-0122];
decides issue #3306. §§1–4 were rewritten against the codebase before any slice
started — see [Corrections after the codebase walk](#corrections-after-the-codebase-walk).)

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

### The layer reading, which is the one thing this record does not take from the codebase

CR 613.1a: "Layer 1: Rules and effects that modify copiable values are applied."
CR 709.5's last sentence puts the two static abilities, and which half a
characteristic is in, **inside the copiable values**. So the locked half's name,
mana cost and rules text are already absent from the object the layer series
starts with — CR 613.1 begins "with the actual object", and layer 1 has finished
with it before layer 2 runs.

**The layer system therefore does not change.** It has no object shape for "one
half of an object" and does not need one. What changes is what the object IS
when the layers start, which is layer 1's job and nothing else's.

## Decision

**CR 709.5 leaves ADR 0041's out-of-scope bucket. A permanent split card is ONE
permanent whose characteristics are DERIVED from its unlocked-designation set,
and that set is carried where every existing reader already looks: in the
definition id the instance presents.** It is the `faceDown` / `transform` /
`adventure` definition-swap idiom, given a fourth caller.

### 1. The lock state lives in the presented definition id

`getDefinition(cardId)` (`convex/cards/registry.ts`) maps an id to a definition
through a memo, with **no access to the instance** — and it has ~3,200 call
sites. Nothing a permanent knows about itself can reach a characteristic read
through that function. The engine's answer to exactly this problem already
exists and has four callers:

| Mechanic                            | Swap marker                       | Record   |
| ----------------------------------- | --------------------------------- | -------- |
| Face-down (CR 708.2)                | `faceDown` / `faceDownOf`         | ADR 0013 |
| Transform (CR 712)                  | `transformed` / `transformedFrom` | ADR 0067 |
| Adventure (CR 715)                  | `adventureOf`                     | ADR 0120 |
| Split half on the stack (CR 709.3b) | `splitHalfOf`                     | ADR 0121 |

Each overwrites `card.id` and the instance's mutable characteristic fields from
a different definition, retaining the previous id in a companion field for the
revert — "so every existing reader (layers, combat, activated-ability
discovery) observes the swap" (`convex/gre/state.ts`, on `transformed`).

A Room takes the same shape. The presented id encodes which doors are unlocked:

```
neither  → `${parent}#room:`        // CR 709.5d — entered without being cast
left     → `${parent}#room:left`
right    → `${parent}#room:right`
both     → `${parent}`              // == CR 709.4's combination == the printed card
```

**Both-unlocked is the parent id, not a fourth synthesized one.** With neither
door locked, neither of CR 709.5's two static abilities applies, so the object
has both names, the CR 709.4b combined mana cost and both text boxes — which is
precisely the parent definition. A separate id for the same characteristics
would be a second object for no reason, and it would cost every consumer that
compares a presented id to a catalogue id (deck lists, the card index, "is this
Walk-In Closet") a Room-shaped special case.

The `#room:` suffix joins the twin namespace (`#left`, `#right`, `#adventure`,
`#back`) without joining its vocabulary: `splitSideOfDefinitionId` keys on the
suffix alone and keeps answering `undefined` for it, exactly as it does for
`#adventure`. The three synthesized definitions are built on lookup, the way
`maybeSynthesizeToken` already builds a token from a structured id — never
registered, so 30 Rooms do not put 90 entries into the catalogue, the card index
or any census. Each carries `imagePrintId` from the parent for the reason the
split twin does (issue #3321: a `#`-bearing id reaching the Scryfall URL builder
truncates at the fragment into a 404).

**This is what makes CR 709.5's copiable-values sentence free.** `CopySource` is
`Pick<CardInstanceState, "card" | "faceDown" | "copyExcept">` (`convex/gre/copy.ts`)
and `applyCopy` overwrites the recipient's `card.id` with the source's presented
id. A copy of a half-unlocked Room copies its lock state through the copy path
that already exists, with no new field, no widening of `CopySource`, and
therefore no new row owed by the LKI store (ADR 0086). A designation held in a
field beside the id would have to be added to all three by hand.

### 2. The derivation feeds the swap, and the type line is SHARED

`deriveSplitCombination(halves)` (`convex/cards/splitCard.ts`) is CR 709.4's
combination. CR 709.5 is the same function with an unlocked-set argument, and
two differences that are rule text rather than special-casing:

- **The unlocked set selects which halves contribute** the name, mana cost and
  rules text (CR 709.5). Zero unlocked halves — CR 709.5d's "neither half was
  cast", a Room put onto the battlefield by an effect — yields a permanent with
  the shared type line and no name, no mana cost and no text. That is not a
  degenerate case to guard against; it is what the rule says the object is.
- **The types and subtypes are the SHARED type line** (CR 709.5a), not
  CR 709.4c's union over the halves. `Enchantment — Room` is one type line that
  both halves share, and a locked door subtracts nothing from it.

The standing norm is that a continuous effect is never faked by mutating a
stored characteristic — and this does not breach it. The mutation here IS the
object's copiable values changing, which is CR 613.1a, layer 1: it is the INPUT
to the layer series, not a shortcut around it. Layers 2–7 recompute on top
unchanged, exactly as they do over a transformed permanent.

### 3. CR 709.5b needs nothing — the twin id already carries the parent

`castAsSplitHalf` swaps a stack item's identity to the twin and records the
parent, and `revertSplitIdentity` restores the parent **where the object leaves
the stack**, "never on the stack itself: while it is there, 709.3b keeps the
twin" (`convex/gre/splitCast.ts`).

CR 709.5b excepts **the existence of each half**, not its characteristics:
CR 709.3b keeps governing what a Room spell presents on the stack, and CR 709.3a
("only the chosen half is evaluated to see if it can be cast") is untouched by
any 709.5 clause. What 709.5b asks for is that a copy of a Room spell still be a
two-doored Room. It already is: the twin id is `${parent}#left`,
`parentIdOfTwin` recovers the parent from it, and `card.id` is copiable (§1). So
**the twin swap survives intact for the permanent class**, and CR 709.5b costs
one test rather than a second cast path.

What CR 709.5d costs is one branch in `revertSplitIdentity`: a permanent split
card reverts not to the parent id but to the `#room:` id naming the door that
was cast. A Room reaching the battlefield without having been cast never passes
through `castAsSplitHalf`, so the enter path stamps `#room:` on it — the "with
neither unlocked designation" case, spelled.

### 4. The unlock is a fourth special action, shaped exactly like morph's

`SPECIAL_ACTION_MOVE_KINDS` (`convex/gre/moves.ts`) grows a fourth member for
CR 116.2 / 709.5e, class-named for the rule and never for Rooms. It is the
**morph shape with a different gate**: `turn-face-up` is already per-permanent
(hence `cardInstanceId`), already VARIABLE-cost — the permanent's own printed
morph cost — repeatable, and carries **no tap plan**, because the cost is solved
and applied server-side in one shot by the shared auto-tap solver
(`canTurnFaceUp` / `morphTurnUpPaymentPlan`), leaving no coloured-pip choice for
an executor to replay. An unlock cost is a locked door's own mana cost and wants
that treatment unchanged.

The one thing that differs is timing. CR 116.2b grants morph's action at any
priority with no restriction at all; CR 709.5e's window — "any time they have
priority and the stack is empty during a main phase of their turn" — is
character-for-character `isSorceryTimingFor(state, playerId)`
(`convex/gre/phases.ts`), the caster-aware predicate issue #1690 split out of
the player-agnostic `isSorceryTiming` precisely because asking the turn-scoped
form on behalf of a non-active player silently answers about somebody else. **No
new timing window is built.**

CR 709.5f/5g ship as Effect Script Ops (ADR 0045), not `resolve()`: to unlock,
the controller chooses a locked door and the permanent gains that designation;
to lock, an unlocked door and it loses one.

### 5. CR 709.5i is derived from CR 709.5h at ONE emission site

Both triggers fire from the moment the designation is granted, never from the
action that caused it — CR 709.5h is explicit that it triggers "regardless of
whether it was given that designation while entering the battlefield or after
entering the battlefield", which covers CR 709.5d's ETB grant, CR 709.5e's
special action and CR 709.5f's unlock effects with one emitter. That emitter
compares the presented id before and after: it emits the unlock-a-half event
always, and the fully-unlock event when the post-state holds both designations
and the pre-state did not (CR 709.5i). Two `GameEventType` members, one site, no
second derivation to drift.

CR 709.5g's lock removes a designation and triggers nothing — the rule names no
lock trigger, and neither does the engine.

### 6. Slicing

The mechanic ships WHOLE, and the card ships in the last slice. Nothing here is
a marker or a documented divergence.

- **Slice 1 — the id, the derivation and the enter path.** The three synthesized
  `#room:` definitions and the derivation that builds them (CR 709.5, 709.5a,
  709.5c); the `revertSplitIdentity` branch and the uncast-enter stamp
  (CR 709.5d); the compiler admitting a split card with a permanent face; the
  CR 709.5b copy test. The frontend needs no wiring work — the swap hands the
  client a different definition through the reader it already uses, the way a
  transformed permanent's back face reaches it — but the walk is still owed, and
  the SURFACE assertion runs through `projectPublicState`.
- **Slice 2 — the unlock.** The CR 709.5e special action on the morph shape with
  the sorcery-window gate, CR 709.5f/5g as Ops, and the Bot seams:
  `enumerateMoves` must reach the action, and `OP_VALUERS` / `OP_BENEFICENCE`
  must want it — an unvalued Op fails open to neutral, which is a Bot that never
  opens a door.
- **Slice 3 — the triggers and the card.** CR 709.5h/5i, then **Walk-In Closet //
  Forgotten Cellar**. It is blocked on issue #2244 (ADR 0093) for its left
  door's graveyard-play permission record, and on nothing else.

## Corrections after the codebase walk

§§1–4 above are the SECOND reading. The first, written from issue #3306's Agent
Brief before the relevant files were opened, got three of its four mechanisms
wrong — all three in the same direction, and the direction is worth recording
because the reasoning that produced them is not obviously wrong from the rule
text alone.

| First reading                                                                                                     | Why it was wrong                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The designation set is a field on the instance, read by a pure derivation "at read time, never a stored mutation" | `getDefinition` is id → definition with no instance in scope, at ~3,200 call sites. "Derive at read time" has nowhere to stand; the engine's layer-1 representation IS the definition swap, four mechanics deep. |
| CR 709.5b "kills the twin swap" — the load-bearing reason 709.5 needed its own record                             | 709.5b excepts the EXISTENCE of the halves, not their characteristics, and the twin id already encodes the parent and is copiable. The clause costs one test. The twin swap was never in danger.                 |
| The unlock is the first special action carrying a real cost, hence a tap plan                                     | `turn-face-up` has paid a variable printed cost since issue #2705, with no tap plan, through the shared auto-tap solver. The unlock differs from morph in its timing gate and in nothing else.                   |

The common cause: reading a CR clause as a demand for new machinery without
first asking which existing mechanism already answers it. The correction that
survived both readings unchanged is the layer one — CR 709.5's suppression is
layer 1, so the layer system does not change — and it survived because it was
derived from CR 613.1a rather than from the shape of the rule's prose.

The slicing shrank from four slices to three as a result. No acceptance
criterion was dropped; two of them stopped needing their own diff.

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
- **The layer system is untouched**, which is the load-bearing claim of the
  layer reading above. If a future card makes a locked door's suppression
  observably interact with an external text-changing or ability-removing effect,
  that card — not this record — is where layer 3 / layer 6 shapes get built. No
  such card exists in the corpus's 30.
- **The copy path, the LKI store and `CopySource` are untouched**, because the
  lock state rides the one field they already carry.
- **"Door" is not a second vocabulary** (CR 709.5j): the ids, the Move and the
  events are named in halves and sides, and Room oracle text reading "unlock
  this door" lowers onto the same words.

[adr-0041]: 0041-worklist-driven-cross-set-card-implementation.md
[adr-0121]: 0121-split-card-is-one-combined-definition.md
[adr-0122]: 0122-modal-double-faced-card-is-a-front-face-with-a-back-twin.md

# A split card is ONE combined definition with two registered half twins; a PERMANENT split card (CR 709.5 — every Room) stays out of scope (amends ADR 0041, extends ADR 0120)

## Status

accepted (amends [ADR 0041][adr-0041]'s out-of-scope clause for CR 709.1–709.4;
extends [ADR 0120][adr-0120]'s twin-definition mechanism and amends its
parenthetical that split stays in the bucket; decides issue #3224 for the split
half, re-files the Room half)

## Context

ADR 0041 files split cards under **out-of-scope**, a bucket defined by layout:
_"cards whose layout isn't modeled (transform/MDFC/split/meld/flip)… one
`ready-for-human` issue per layout (schema-level work)."_ Issue #3224 is that
issue, and it names two blocked Vintage Cube cards — **Life // Death** and
**Walk-In Closet // Forgotten Cellar**, a Room.

ADR 0120 took adventure and preparation out of that bucket and explicitly left
split in it, on this reading: _"a split card carries two names and two mana
costs **in every zone** (CR 709)… Those are schema problems."_ The reading of
the rule is right. The conclusion does not follow, and this record is why.

### `layout: "split"` is not one class but three

Measured against the vendored corpus (`data/oracle-corpus.json.gz`, 34,890
cards), **137** carry `layout: "split"`:

| Class                                 | Count | What it is                                                            |
| ------------------------------------- | ----: | --------------------------------------------------------------------- |
| A permanent face                      |    30 | CR 709.5 shared-type-line permanents — every one `Enchantment — Room` |
| Fuse (CR 702.102)                     |    22 | Two halves cast as one spell from hand                                |
| Two instant/sorcery halves, no others |    85 | Life // Death, Fire // Ice, Stand // Deliver, Wax // Wane             |

The three want different things, and the bucket drawn around the Scryfall
string cannot tell them apart: admitting `"split"` to `SUPPORTED_LAYOUTS`
(`convex/oracle/compile.ts`) would admit the Rooms with it. The discriminator is
CR-shaped rather than name-shaped — 709.5's own first sentence is _"Some split
cards are **permanent cards** with a single shared type line"_ — so the gate is
**a split card with a permanent face is refused**. Against the corpus that is 30
for 30, with no card-name list to rot. Aftermath cards (Refuse // Cooperate,
CR 702.127) sit in the admitted 85 and need nothing from this record: aftermath
is a keyword on a half, ordinary card text, not layout.

### What CR 709 actually asks for, off the stack and on it

`bun run cr 709`:

- **709.3** — "A player chooses which half of a split card they are casting
  before putting it onto the stack." **709.3a** — "Only the chosen half is
  evaluated to see if it can be cast." **709.3b** — "While on the stack, only
  the characteristics of the half being cast exist."
- **709.3c** — a copy of a split card "retains the characteristics of the two
  halves separated into the same two halves as the original card."
- **709.4** — "In every zone except the stack, the characteristics of a split
  card are those of its two halves **combined**." **709.4a** two names,
  **709.4b** combined mana cost (so Life // Death is a green **and** black card
  with mana value 3), **709.4c** every card type from either half and every
  ability in either text box.

Two halves and one combination, and the combination is a **function of the
halves** — which is the fact ADR 0120's reading skipped. A derived object is a
definition, and a definition already has a home: ADR 0120 §2 built one for the
Inset Spell, resolvable through `convex/cards/registry.ts` and invisible to
`catalogue.ts`'s enumerable `allCards`.

`ManaCost` (`convex/cards/types.ts:92`) is counts per colour plus `generic`, so
combining two costs is addition, and 709.4b's colours and mana value fall out of
the sum. Its third sentence — "An effect that refers specifically to the symbols
in a split card's mana cost sees the separate symbols rather than the whole mana
cost" (the Jegantha example: Fire // Ice contains `{1}` twice, not `{2}`) — is
the one clause a summed record cannot answer, and it needs no new field: the
halves are declared on the definition, so a symbol-level reader reads the
halves. Nothing in the pool asks today; the field it would read exists the day
one does.

## Decision

**CR 709.1–709.4 leave ADR 0041's out-of-scope bucket. CR 709.5 — permanent
split cards, which is every Room — stays in it, with its own `ready-for-human`
issue. Fuse (CR 702.102) stays unbuilt.** No `faces[]` at runtime: CR 709.4 asks
for one object with combined characteristics, and one object is what every
reader keeps seeing.

### 1. One definition, declared as two halves, combined by DERIVATION

`CardDefinition` gains one optional field:

```ts
splitHalves?: readonly [SplitHalf, SplitHalf]; // printed left, printed right
// SplitHalf: name; manaCost; types; subtypes?; oracleText; effects;
//            targetRequirement?; …  — the castable characteristics, nothing else
```

The definition's top-level `name`, `manaCost` and `types` are **never
hand-authored** on a split card. A pure `defineSplitCard(halves)` derives them —
`"Life // Death"`, the summed cost, the union of card types — and the set file
exports its result. An authored combination can disagree with 709.4 in a way
nothing detects; the same argument keeps morph's `{3}` out of card data (ADR
0120 §3), because a constant of the rule is not a property of the card.

The consequence that matters: **755 files name `CardDefinition`**, and every one
of them keeps reading a flat definition with one name, one cost, one type list.
Deck legality, the Limited pool, `check:index`, the card-index lockfile, tutors
and the Bot's valuation are untouched — 709.4 is satisfied by construction, not
by a conditional at each site. A nested half read through at every reader is the
shape ADR 0120 §2 rejected for Adventure, on the ground that every forgotten
conditional fails **open** (`.claude/rules/gre-development.md` § Frontend wiring
analysis).

### 2. Each half is a registered twin, and the parent is never castable

Each half is built into a real `CardDefinition` under `${parentId}#left` /
`${parentId}#right` and registered in `registry.ts`, outside `allCards` —
ADR 0120 §2's mechanism, unchanged. Casting a half swaps the stack item's
identity (`card.card = { id: twinId }`) and swaps back as the object leaves the
stack, the idiom `faceDown.ts` and `transform.ts` already use. Then:

| Subrule                                    | How it is satisfied                                       |
| ------------------------------------------ | --------------------------------------------------------- |
| 709.3a — only the chosen half is evaluated | The announced subject IS the twin, before the commit      |
| 709.3b — only its characteristics exist    | The stack item's `card.id` names the twin; nothing nests  |
| 709.3c — a copy keeps both halves          | A copy carries the PARENT id, which carries `splitHalves` |
| 709.4 — combined elsewhere                 | The twin exists only while the item is on the stack       |

Where split differs from Adventure, and the only place it does: an adventurer
card offers a normal cast **and** an inset one; a split card offers **two half
options and no normal one**. CR 709.3 has the choice happen _before_ the card is
put onto the stack, so there is no cast that ever puts the combined object
there. The census already has that shape — ADR 0120's `kind: "prepare"` is
precisely the parent that never offers a cast option — so this is a census row,
not a new rule.

**This record builds none of that machinery a second time.** The `subject`
member of `CAST_MODE_CENSUS` (`convex/gre/castMode.ts:79`), twin registration
and the `alternativeCostId` prefix channel are ADR 0120 slice 1's, and split
takes `split-left:` / `split-right:` prefixes in the same space. Split is
therefore **blocked by that slice**: a second implementation of twin
registration is exactly the drift `castMode.ts` was created to prevent (issue
#2796).

### 3. Two names is a predicate, not a second field

709.4a: "Each split card has two names. If an effect instructs a player to
choose a card name and the player wants to choose a split card's name, the
player must choose one of those names and not both." The name-choice seam
already exists (`chosenName` — `convex/gre/state.ts`,
`convex/gre/pendingChoiceSubmit.ts`; Meddling Mage, `convex/cards/sets/pls/multicolor.ts`), and ADR 0120 already owes it the Inset Spell's name (CR 715.5).
One predicate serves both: `hasName(def, chosen)` is true when `chosen` equals a
half's name, and the choice **list** offers the two half names and never the
combined string.

### 4. 709.4c's ability union has no reachable subject in the admitted class

The type union is derived (§1). The ability union — "each ability in the text box
of each half" — is observable only where a half's abilities function somewhere
other than on the stack as that half. All 85 admitted cards have two
instant/sorcery halves, so no half's abilities ever function off the stack, and
on the stack 709.3b already says only the cast half's characteristics exist. The
clause becomes observable exactly when a **permanent** split card ships, and
that is 709.5.

This is not a mechanic shipped in half, which the GRE rules forbid: the clause's
subject does not exist in the class this record admits, and the class it does
exist in stays out of scope whole.

### 5. The compiler learns the layout in the same slice, and gates on permanence

`SUPPORTED_LAYOUTS` admits `"split"`; a split card with a permanent face, or one
with Fuse, is refused and produces the gap it already produces today. `OracleCard`
gains the `faces` the corpus reducer (`scripts/oracle-corpus.ts`) already
produces, and lowering builds both halves and calls the same `defineSplitCard`,
so Guard C (compiler round-trip) round-trips **through** the derivation rather
than around it. Ordering is forced anyway: nothing can be lowered into a field
that does not exist.

### 6. Slicing

- **Slice 1** — the schema, the derivation helper, twin registration for split,
  the two census rows, the compiler gate, the frontend and Bot walks, and
  **Stand // Deliver** and **Wax // Wane** (INV), whose every capability
  exists: a damage prevention shield, a bounce, a P/T pump, a targeted destroy.
  `convex/cards/sets/inv/white.ts`'s own out-of-scope note and
  `cardDataConformance.test.ts`'s exclusion comment are revised in this slice.
- **Slice 2** — **Life // Death** (issue #3224's cube card). Its right half is
  ordinary reanimation; its left half — "All lands you control become 1/1
  creatures until end of turn. They're still lands." — is a layer 4 / layer 7b
  continuous effect over a set fixed as the effect resolves (CR 611.2c), which
  is its own subject and belongs on its own diff.
- **Rooms** — CR 709.5, its own `ready-for-human` issue, untouched here.

## Consequences

- ADR 0041's out-of-scope bucket keeps its force for MDFC, meld, flip and
  **permanent split cards**. ADR 0120's parenthetical — "Split, MDFC and meld
  stay here" — is amended for CR 709.1–709.4 only.
- **30 Room cards stay unshipped**, Walk-In Closet // Forgotten Cellar among
  them. PRD #1525 records issue #3224's split half as unblocked and its Room
  half as pending the new issue; the Room card is not "permanently out of
  scope", it is out of scope until CR 709.5 gets its own decision.
- **A two-colour split card is a GOLD card** (709.4b), so its home-set file is
  the multicolour one. `convex/cards/sets/inv/white.ts` currently records
  Stand // Deliver as `{W} // {2}{W}` and Wax // Wane as `{W} // {1}{W}`; the
  corpus has `{W} // {2}{U}` and `{G} // {W}`. Both stubs are wrong, and both
  belong in `inv/multicolor.ts` — slice 1 moves them.
- 709.4b's separate-symbols sentence is answered by the halves, not by a field.
  Recorded so the next reader does not add one speculatively.
- Fuse (CR 702.102) and the 22 cards behind it stay out of scope, recorded here
  so the next census does not re-ask. It is not a layout question: fuse is a
  keyword that casts both halves as one spell, and 709.4d gives that spell the
  combined characteristics this record already derives.
- The split half of issue #3224 is unblocked without any new engine concept:
  everything it needs is either derived, or a row in a census ADR 0120 already
  widened.

[adr-0041]: 0041-worklist-driven-cross-set-card-implementation.md
[adr-0120]: 0120-inset-spell-is-a-registered-twin-definition.md

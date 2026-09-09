# Adventure is not layout work: an Inset Spell is a registered TWIN definition, and the cast option census owns which one is being announced (amends ADR 0041)

## Status

accepted (amends [ADR 0041][adr-0041]'s out-of-scope clause for two of the six
layouts it names; builds on ADR 0067, ADR 0083, ADR 0102; decides issue #3223)

## Context

ADR 0041 files adventurer cards under **out-of-scope**, in a bucket defined by
layout: _"cards whose layout isn't modeled (transform/MDFC/split/adventure/meld/
flip)… one `ready-for-human` issue per layout (schema-level work)."_ Issue #3223
is that issue. Two Vintage Cube cards sit behind it — Bonecrusher Giant // Stomp
and Brazen Borrower // Petty Theft — and the question it asks is whether Tolaria
models multi-face layouts at all.

### The bucket was drawn around Scryfall's `layout`, not around this engine

Scryfall reports `layout: "adventure"` and splits the text into `card_faces`, so
the compiler's fail-closed allowlist (`SUPPORTED_LAYOUTS = new Set(["normal"])`,
`convex/oracle/compile.ts`) refuses the card, and the census that produced ADR
0041 sorted it with the other multi-faced prints. That grouping does not survive
reading the rules.

`bun run cr 715`:

- **715.3b** — "While on the stack as an Adventure, the spell has only its
  alternative characteristics."
- **715.4** — "In every zone except the stack, and while on the stack not as an
  Adventure, an adventurer card has only its normal characteristics."

So no zone ever shows two faces at once. A Bonecrusher Giant in a graveyard is a
4/3 creature card with mana value 3, and nothing that reads a graveyard, a hand,
a library or a battlefield needs to learn anything. That is categorically unlike
the other three layouts still in ADR 0041's bucket: a split card carries two
names and two mana costs **in every zone** (CR 709), an MDFC's back face is a
permanent (CR 712.3), meld replaces one object with another (CR 701.42). Those
are schema problems. Adventure is not.

What Adventure is, this engine already has a word for. `convex/gre/castMode.ts`
defines a **cast mode** as "an alternative cost that changes what the spell IS,
or what happens to the permanent it becomes", and morph goes further than
Adventure ever does: the spell on the stack has no name, no text, no mana cost
and no subtypes, and is a 2/2 face-down creature.

### CR 722 makes the same shape a second time

`bun run cr 722` — Preparation cards — repeats 715 clause for clause: 722.2 is
715.2 verbatim in structure, 722.2a is 715.2a, 722.2b is 715.2b, 722.2c is
715.2c, 722.5 is 715.5. One bit differs, and only one:

- **715.3** — the player chooses to cast the card **as an Adventure**;
- **722.3** — a preparation card **can never be cast** with its inset
  characteristics. A permanent gains the `prepared` designation and 722.3c
  creates **a copy in exile** which "has only the characteristics of that
  permanent's prepare spell", and "those characteristics become the copy's
  **normal** characteristics".

A design that serves 715 alone and has to be reopened for 722 is a design that
read one of the two.

### The load-bearing subrule

**715.3a** — "When casting an adventurer card as an Adventure, only the
alternative characteristics are evaluated to see if it can be cast."

Stomp is an Instant printed on a creature card. Timing (`castTimingBaseLegal`,
`gre/rules.ts`), affordability, targeting and the Bot's `enumerateCastMoves` all
have to evaluate the Inset Spell, and all of them run **before** a stack item
exists. A stamp applied to the freshly-built stack item — which is all
`CAST_MODE_CENSUS` does today — arrives too late to make an instant-speed Stomp
legal.

## Decision

**Adventure and Preparation leave ADR 0041's out-of-scope bucket. Split, MDFC
and meld stay in it, each with its own `ready-for-human` issue, untouched by
this record.** No `faces[]`, no multi-face schema: CR 715.4 and CR 722.4 make one
unnecessary.

### 1. An Inset Spell is declared on the parent, once, with a kind

`CardDefinition` gains one optional field:

```ts
insetSpell?: {
    kind: "adventure" | "prepare";
    name; manaCost; types; subtypes; oracleText; effects; targetRequirement;
};
```

One field, not `adventure?` beside a later `prepare?`: 715 and 722 share the
declaration, the copiable-values rule, the "has an X" predicate and the
name-choice rule, and differ only in how the half becomes castable. `kind` is
load-bearing — it decides whether the **parent** ever offers a cast option
(adventure yes, prepare never, CR 722.3) — and is therefore the key of a
`Record<InsetSpellKind, …>`, the same guard shape this codebase already uses for
cast modes and cost keys.

CR 715.2c / 722.2c: **one card is one card.** One catalogue row, one card-index
lockfile row, one Guard C anchor, and no new filtering owed by deck legality,
the Limited pool, `check:index` or the Bot's valuation.

### 2. The half is REGISTERED as a twin `CardDefinition`, not read through

At import time the Inset Spell is built into a real `CardDefinition` under the
derived id `${parentId}#adventure` (`#prepare`) and registered in
`convex/cards/registry.ts` — the id-resolvable `Map` that `tryGetDefinition`
reads and that tokens and transform back faces already live in — and **not** in
`convex/cards/catalogue.ts`'s enumerable `allCards`, which deck legality, the
Limited pool and the card index read. Resolvable everywhere; invisible to every
enumerator. Client and server import the same module, so both resolve the twin's
name, cost and art with no id codec — unlike `registerBackFaceDefinition`, whose
`tokenDefinitionId` **encodes** its spec into the id, a codec an `EffectOp[]`
cannot pass through.

Casting as an Adventure then swaps the stack item's identity —
`card.card = { id: twinId }`, the idiom `faceDown.ts` and `transform.ts` already
use — and swaps back when the object leaves the stack (CR 715.4), the front id
retained the way `transformedFrom` retains it.

The alternative — a nested half read through at every site (`if it is an
Adventure, read `def.insetSpell`instead) — was rejected on two counts. It makes
roughly twenty readers each responsible for a conditional, every one of which
fails **open** when forgotten (the recurring bug class named in`.claude/rules/gre-development.md` § Frontend wiring analysis). And it has no
answer at all for CR 722.3c, which needs an object whose _normal_ characteristics
ARE the half — that object is a definition, so the twin has to exist regardless.

Most of CR 715 then falls out rather than being implemented:

| Subrule                                   | How it is satisfied                                         |
| ----------------------------------------- | ----------------------------------------------------------- |
| 715.4 — normal characteristics elsewhere  | The twin exists only while the item is on the stack         |
| 715.2b — alt characteristics are copiable | A clone copies `card.id`, and the id names the twin         |
| 715.3c — a copy of an Adventure is one    | Same: the copied stack item carries the twin id             |
| 722.3c — the exiled copy's NORMAL chars   | An instance whose `card.id` is the twin; no swap, no revert |

What stays real work: 715.2a's "has an Adventure" predicate, and 715.5's
name-choice list having to offer the Inset Spell's name.

### 3. The cast option rides the existing channel, and the census owns it

There is exactly one channel for "which cast option was announced": the
`alternativeCostId` string, whose five consumers `gre/castPermissions.ts` names
as the invariant that must not drift — the timing gate, the cast-option list,
`announceCast`, `enumerateCastMoves`, the client picker. It is namespaced by
prefix (`cast-permission:`) and already carries an id that is not a card's price
at all (morph's, where "the {3} belongs to the rule, not the card"). Adventure
takes an `adventure:` prefix in the same space. The field name is legacy for
"CR 601.2b announcement choice"; renaming it is a separate refactor.

A second, parallel channel (`castAs` on `announceCast` and on `Move`) was
rejected: it duplicates the drift surface that module exists to prevent, and
every site that forgot to read it would offer the cast and resolve the wrong
half.

**`CAST_MODE_CENSUS` grows from post-commit to pre-commit.** The row gains a
third member beside `idOf` and `stamp`:

```ts
subject: (def: CardDefinition) => CardDefinition; // identity for every existing mode
```

and the five surfaces resolve the announced subject through the census instead
of through a bare `tryGetDefinition(card.card.id)`. `Record<CastMode, …>` is the
guard: a mode cannot compile without declaring all three members, exactly as it
cannot compile today without declaring two. This is the same argument the module
was created for — two partial reimplementations had diverged in silence until a
`Record` forced them into one table (issue #2796) — applied to five sites rather
than two.

### 4. CR 715.3d is an engine rule at the resolution site, never card text

A spell cast as an Adventure is exiled instead of being put into its owner's
graveyard **as it resolves**, and its controller may play it from exile for as
long as it remains there. That clause is printed in the card's _frame_, not in
its Oracle text, so writing it into a card's Effect Script is inventing text the
card does not have — and Guard C (compiler round-trip) would read the invention
as a divergence.

It goes where a resolved spell is put into a graveyard, keyed on the stack item's
Adventure mark. A **countered** Adventure is then correct by construction: it
never resolves, so it reaches the graveyard by the ordinary path and the creature
half is gone with it.

The permission itself is not new machinery. `castableFromExileBy`
(`gre/state.ts`) already carries six sibling fields, each modelling one clause of
a grant — `castableFromExileIncludesLand` (CR 305.9: _play_, not _cast_),
`castFromExileCostIncrease`, `castFromExileManaSubstitution`, the cost waiver,
and `castableFromExileUntilTurn`, whose ABSENCE is precisely 715.3d's open-ended
"as long as that card remains exiled". "Can't be cast as an Adventure this way"
is a seventh sibling, and it rides the **permission**, not the zone: 715.3d is
explicit that another effect granting a cast may still allow the Adventure.

### 5. The compiler learns the layout in the same slice

`SUPPORTED_LAYOUTS` admits `"adventure"`, `OracleCard` gains the `faces` the
corpus reducer (`scripts/oracle-corpus.ts`) already produces and then discards,
and lowering copies `faces[1]` into `insetSpell`. The ordering is forced anyway —
nothing can be lowered into a field that does not exist — and the alternative
leaves two `compiler-gap:` markers in the catalogue, which is the debt PRD #2693
counts.

### 6. Slicing

- **Slice 1** — this schema, the census widening, the resolution rule, the
  seventh permission term, the compiler, the frontend and Bot walks, and
  **Brazen Borrower // Petty Theft**, whose every capability already exists
  (flash, flying, the `block-restriction` static, a bounce).
- **Slice 2** — **Bonecrusher Giant // Stomp**, which needs one thing Adventure
  does not: a game-scoped, turn-long "damage can't be prevented" — the sibling of
  the existing target-scoped `lockDamage` Op (CR 615.12 / 614.9, issue #2231).
  Shipping it inside slice 1 would put a new Op with nine consumers on the same
  diff as a pre-commit census change, so a red gate could not name its cause.

Bonecrusher Giant does **not** ship behind a Guard B marker. A marker on a clause
we can build is chosen debt.

## Consequences

- ADR 0041's out-of-scope clause keeps its force for split, MDFC and meld. Its
  premise for adventure — "the layout isn't modeled" — is withdrawn: the layout
  is not what was missing.
- `convex/cards/__tests__/cardDataConformance.test.ts`'s exclusion comment
  ("Split/flip/adventure/meld cards are out of scope catalogue-wide") is revised
  in slice 1, not here: it is accurate until the first adventurer card registers.
- Preparation cards (CR 722) become a bounded addition rather than a second
  design: the `prepared` designation (`convex/cards/designations.ts` is where
  designations live), and the exiled copy — an instance carrying the twin id,
  cast with no mode and no swap.
- The cast-option census becomes load-bearing for legality, not only for search.
  A future mode that changes what may legally be announced now has one place to
  say so, and cannot compile without saying it.
- `alternativeCostId` drifts further from its name. Recorded, not fixed.

[adr-0041]: 0041-worklist-driven-cross-set-card-implementation.md

# A modal double-faced card is its FRONT face plus a registered back twin; the CR 712.12 land play ships and the CR 712.11b cast option waits for a card (amends ADR 0041, extends ADR 0120 and ADR 0121)

## Status

accepted (amends [ADR 0041][adr-0041]'s out-of-scope clause for the modal
double-faced layout; extends [ADR 0120][adr-0120]'s twin-definition mechanism
and amends its parenthetical that MDFC stays in the bucket; sibling of
[ADR 0121][adr-0121]; decides issue #3226)

## Context

ADR 0041 files modal double-faced cards under **out-of-scope**, a bucket defined
by layout: _"cards whose layout isn't modeled (transform/MDFC/split/meld/flip)…
one `ready-for-human` issue per layout (schema-level work)."_ Issue #3226 is that
issue, and it names two blocked Vintage Cube cards — **Sink into Stupor //
Soporific Springs** and **Witch Enchanter // Witch-Blessed Meadow**.

ADR 0120 took adventure and preparation out of that bucket and left MDFC in it on
one sentence: _"an MDFC's back face is a **permanent** (CR 712.3)."_ The sentence
is true. It is not a reason, and this record is why.

### CR 712.8a makes this the CHEAPEST of the four remaining layouts, not the dearest

`bun run cr 712`:

- **712.8a** — "While a double-faced card is outside the game or in a zone other
  than the battlefield or stack, it has only the characteristics of its front
  face."
- **712.8f** — "While a modal double-faced spell is on the stack or a modal
  double-faced permanent is on the battlefield, it has only the characteristics
  of the face that's up."
- **712.14** — "A double-faced card put onto the battlefield from a zone other
  than the stack enters the battlefield with its front face up by default."

Set that beside what the two decided layouts asked for. A split card carries the
**combined** characteristics of both halves in every zone but the stack
(CR 709.4), so ADR 0121 had to derive a combination and keep it honest. An
adventurer card has its normal characteristics everywhere except one stack state
(CR 715.4), which is the shape that got it out of the bucket. A modal
double-faced card asks for **less than either**: nothing is combined and nothing
is derived, because outside the battlefield and the stack there is only the front
face.

So the flat `CardDefinition` **is** the front face, and it is right in every zone
by construction. Deck legality, the Limited pool, `check:index`, the card-index
lockfile, tutors, mill and discard, and the Bot's valuation are untouched — not
by a conditional at each reader, which is the shape that fails open
(`.claude/rules/gre-development.md` § Frontend wiring analysis), but because the
object those readers hold never has a second face to miss.

Two things issue #3226 lists as costs are consequences of that clause and cost
nothing:

- **A land tutor cannot find Soporific Springs.** In a library the card is an
  instant card (712.8a), so "search your library for a land card" does not see
  it; and **712.14b** — "If a player is instructed to put a modal double-faced
  card onto the battlefield and its front face isn't a permanent card, the card
  stays in its current zone" — stops the effect that tries anyway. Correct
  behaviour, no code.
- **The card's name is its front face's name.** `convex/cubes/vintageCubeNames.ts`
  already records `"Sink into Stupor"`, not the Scryfall combined string, and
  712.8a says that is the name.

### The measurement: one hundred cards, two ACTIONS, no second schema

Measured against the vendored corpus (`data/oracle-corpus.json.gz`, 34,890
cards), **100** carry `layout: "modal_dfc"`:

| Back face                                                                                                   | Count | Reached by                        |
| ----------------------------------------------------------------------------------------------------------- | ----: | --------------------------------- |
| A land (50 `spell // land`, 10 `land // land`)                                                              |    60 | CR 712.12 — the land play         |
| A spell or nonland permanent (creature 17, sorcery 8, artifact 9, planeswalker 4, instant 1, enchantment 1) |    40 | CR 712.11b — a second cast option |

The split of the layout is not by schema but by **which player action turns the
back face up**, and both cube cards sit in the first row. The ten `land // land`
cards (the Zendikar Rising pathways) are why the action has to name a face at all:
712.12 says the player "chooses one of its faces that's a land", and for those ten
that is a real choice rather than a formality.

### Both doors are pre-object choices, and one of them is already built

- **712.11b** — "A player casting a modal double-faced card or a copy of a modal
  double-faced card as a spell chooses which face they are casting before putting
  it onto the stack." **712.11c** — "Only the face that will be face up on the
  stack is evaluated to determine if it can be cast."
- **712.12** — "A player playing a modal double-faced card or a copy of a modal
  double-faced card as a land chooses one of its faces that's a land before
  putting it onto the battlefield. It enters the battlefield with that face up."

The first is ADR 0120's cast option census, clause for clause: a choice made
before the object exists, with only the chosen subject evaluated. The second is a
special action — **116.2a** "To play a land, a player puts that land onto the
battlefield from the zone it was in (usually that player's hand)" — and lands in
`convex/gre/playLand.ts`, which already separates _which card_ from _which zone
and which permission_ (a graveyard land under Icetill Explorer, the top library
land under Courser of Kruphix).

**305.1** speaks of playing "a land card from their hand", and by 712.8a the card
in hand is an instant card. That is not a contradiction to resolve: 712.12 is the
rule that says a modal double-faced card may be played as a land, and 116.2a's
own wording never asks the object in hand to be a land — it asks the player to
put a land onto the battlefield, which is what the chosen face is. The legality
question reads the **chosen face**, the exact mirror of 712.11c on the cast side.

### The battlefield object is the one transform already puts there

712.8f governs a modal permanent, and a permanent whose characteristics are a
back face has shipped since transform (`convex/gre/transform.ts`,
`transformPermanent`). ADR 0120's reason for holding MDFC back describes an
object this engine has had for a long time. What a modal card **removes** is the
flip; it adds no permanent shape.

The one thing it cannot reuse is transform's **registration**.
`registerBackFaceDefinition` encodes the face into the id it returns
(`tokenDefinitionId`) — the codec ADR 0120 §2 already recorded that an
`EffectOp[]` cannot pass through. A modal back face is a whole card face:
Soporific Springs carries an entry replacement ("As this land enters, you may pay
3 life. If you don't, it enters tapped", the shipped `entersTappedUnlessPay`
shape, `convex/gre/state.ts`) and a mana ability. So it is a module-registered
twin, ADR 0120 §2's mechanism unchanged.

## Decision

**The modal double-faced layout leaves ADR 0041's out-of-scope bucket. The
CR 712.12 land play ships. The CR 712.11b cast option is admitted in principle
and left unbuilt until a card in a shipped pool needs it — today none does.** No
`faces[]` at runtime: 712.8a means one object with one face is correct everywhere
the enumerators look.

### 1. The KIND is declared on the back face, and the kind is the door

`CardDefinition.backFace` already exists (`convex/cards/types.ts`, a
`CardBackFace`) and means the nonmodal face. It gains one optional
discriminator, defaulting to what every card that has the field today means:

```ts
backFace?: CardBackFace; // CardBackFace gains: kind?: "nonmodal" | "modal"
// absent === "nonmodal" — the 401 corpus transform cards are untouched
```

CR 712.1 names three kinds of double-faced card, and what separates them is not
the data on the face but the door the face is reached through: a nonmodal face is
turned up by transform or convert (712.2) or by an effect that casts the card
transformed (712.11a); a modal face is turned up by the player's own choice at
712.11b or 712.12. One field whose `kind` is load-bearing is ADR 0120 §1's shape
and it is chosen here for ADR 0120's reason — the kinds share the declaration and
differ only in the door, so a `Record<kind, …>` is the guard shape rather than a
second field nobody remembers to read.

`kind: "modal"` alone changes the registration: the face is built into a real
`CardDefinition` under `${parentId}#back` and registered in
`convex/cards/registry.ts`, outside `convex/cards/catalogue.ts`'s enumerable
`allCards` — resolvable everywhere, invisible to every enumerator. Retiring
transform's id codec in favour of the same twin is a separate record's job and is
deliberately not smuggled in here.

### 2. The land play names the face (CR 712.12)

`{ kind: "play-land"; cardInstanceId: string }` (`convex/gre/moves.ts`) gains the
chosen face. It has to: 712.12 makes the face a choice, and the ten `land // land`
cards make it a choice with two answers. The seams are the three enumeration
sites in `convex/gre/moves.ts`, `applyMove.ts`'s `"play-land"` leaf,
`search.ts`, `describeMove.ts`, `legalActions.ts`, `src/lib/ai/executor.ts`, and
the authoritative `playCard` mutation in `convex/game.ts`.

Everything else about the play is ordinary: 116.2a's once per turn, a main phase
of the player's own turn with an empty stack, and the permanent that enters is the
twin. The face is a parameter on a path that exists, not a second path.

The consequence the client owes is exactly one sentence: the two plays a modal
card offers have **independent legality windows**. Sink into Stupor is castable
whenever an instant is; Soporific Springs is playable only in a main phase of its
controller's turn, with an empty stack and a land drop left.

### 3. 712.14b is an engine rule and its subject exists on day one

"If a player is instructed to put a modal double-faced card onto the battlefield
and its front face isn't a permanent card, the card stays in its current zone."
Sink into Stupor's front face is an instant, so the clause has a live subject in
the class this record admits and ships with it, at the put-onto-battlefield site.
Deferring it is the "mechanic shipped in half" the GRE rules forbid.

### 4. 712.19 is the predicate ADR 0121 §3 already owes

"If an effect instructs a player to choose a card name, the player may choose the
name of either face of a double-faced card but not both." The `chosenName` seam
exists (`convex/gre/state.ts`, `convex/gre/pendingChoiceSubmit.ts`; Meddling
Mage). Where split offers the two half names and never the combined string, a
modal card's own name **is** its front face's (712.8a) and the choice list
additionally offers the back face's. One predicate, two callers.

### 5. The compiler gate is CR-shaped, and it reads the back face's type line

`SUPPORTED_LAYOUTS` (`convex/oracle/compile.ts`) admits `"modal_dfc"` **whose
back face is a land face**; a modal card with a nonland back face is refused and
keeps producing the gap it produces today. That is the CR 712.12 class exactly,
60 of 100 against the corpus, with no card-name list to rot. Unlike split,
nothing is derived on the way in: each face lowers as its own object, because
712.8a and 712.8f never show two of them at once.

### 6. Slicing

- **Slice 1**, blocked by ADR 0120 slice 1 (issue #3302), which owns twin
  registration: the `kind` discriminator, the twin, the play-land face parameter,
  712.14b, 712.19's second name, the compiler gate, the client's two plays with
  its `check:ui` receipt, the Bot walk — and both cube cards. Neither front face
  needs a capability that does not ship: Sink into Stupor is
  `type: "spell-or-permanent"` with `controller: "opponent"` and
  `excludeTypes: "Land"`, all three shipped (`convex/cards/types.ts`), and Witch
  Enchanter is an enters-the-battlefield destroy. Both back faces are the shock
  clause `entersTappedUnlessPay`.
- **The 712.11b cast option and its 40 cards** stay unbuilt. It is a census row in
  ADR 0120's `CAST_MODE_CENSUS` plus 712.13 — "a resolving double-faced spell that
  becomes a permanent is put onto the battlefield with the same face up that was
  face up on the stack" — and it earns an issue the day a shipped pool wants such
  a card. The Vintage Cube has none, and neither does any preset deck.

## Consequences

- ADR 0041's out-of-scope bucket keeps its force for meld, flip and permanent
  split cards. Its MDFC clause is amended, and ADR 0120's parenthetical "Split,
  MDFC and meld stay here" is now amended for the second of its three.
- **Issue #3226's premise is corrected in the record.** Its brief lists "outside
  the battlefield an MDFC has only its front face's characteristics" as work owed
  to deck legality, the Limited pool, tutors, `check:index` and the Bot. That
  clause is 712.8a, and it is what makes every one of those readers correct with
  no change at all — the cheapest clause in rule 712, not the dearest.
- **Forty modal cards keep producing a compiler gap**, visibly and on purpose,
  until the cast-option slice is earned. They are not out of scope: the record
  above says what building them costs.
- **Transform is untouched.** The 401 nonmodal cards keep a `backFace` with no
  `kind`, and the id codec keeps its separate life until a record retires it.
  712.16 — "double-faced permanents can't be turned face down" — binds those 401
  exactly as it binds a modal permanent, so it is not an obligation this record
  creates.
- 712.15a is satisfied by construction for the modal kind: a face-down
  double-faced permanent turned face up has its front face up, and the front face
  is the parent definition.
- Issue #3226 asked for a decision or a permanent exclusion, and gets neither
  extreme: its two cube cards are unblocked behind one slice, and the half of the
  layout they do not need is recorded rather than built.

[adr-0041]: 0041-worklist-driven-cross-set-card-implementation.md
[adr-0120]: 0120-inset-spell-is-a-registered-twin-definition.md
[adr-0121]: 0121-split-card-is-one-combined-definition.md

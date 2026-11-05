# A melded permanent is ONE instance remembering TWO cards; one card becomes two at the departure funnel and at the action site, never at resolution (amends ADR 0041, extends ADR 0120 and ADR 0122)

## Status

accepted (PRD #3227's five design calls, issue #3341; amends [ADR 0041][adr-0041]'s
out-of-scope clause for the meld layout, the last double-faced layout in that
bucket; extends [ADR 0120][adr-0120]'s twin-definition mechanism and
[ADR 0122][adr-0122]'s `CardBackFace.kind`). PRD #3227 and issue #3341 call
this record "ADR 0123"; that number went to the Room record, so meld takes the
next free one.

This record covers the ENGINE substrate (issue #7639); § 7 covers the slice
that exposed it (issue #3341): the `meld` Effect Script Op, its Grammar Rule and
the Urza pair. The Mechanics Registry's Meld row is `implemented`.

## Context

`bun run cr 701.42` / `bun run cr 712`:

- **701.42a** — "To meld the two cards in a meld pair, put them onto the
  battlefield with their back faces up and combined. The resulting permanent
  is a single object represented by two cards."
- **701.42b / 701.42c** — only two cards of the same pair meld; tokens never
  do; objects that can't be melded "stay in their current zone".
- **712.4b / 712.4c** — the back faces exist only to give the melded permanent
  its characteristics; meld cards "cannot be transformed … Any instructions to
  do so are ignored."
- **712.8g** — the melded permanent has only the combined back face's
  characteristics; its mana value is the SUM of its front faces'; a copy of it
  has mana value 0.
- **712.21, 712.21a–e** — one permanent leaves, two cards arrive (each to its
  owner's zone); the owner arranges them in a graveyard or library, the
  exiling player orders them in exile; an effect that finds the new object
  finds both cards and acts on each; one replacement applied to one card
  affects both; one object moved, two cards moved.

The engine's invariant is one card = one `CardInstanceState`. CR 701.42a asks
for one object represented by two cards, and 712.21e makes the difference
observable.

## Decision

### 1. One instance, two cards remembered

A melded permanent is ONE `CardInstanceState`. It keeps the instance id of
the half whose ability melded it, presents that half's registered meld twin
(`${cardId}#meld`) and carries `meldedFrom: [MeldedCard, MeldedCard]` — card
id, owner, instance id and print pin of each card. The partner's instance
exists nowhere while melded. SBAs, combat, targeting, the projection and the
Bot's enumerator all see the one object CR 701.42a describes, with no reader
taught a second shape.

`meldedFrom` and `meldGroupId` are `CARD_FIELD_LIFECYCLE` rows (`list`,
survives every ladder; `scalar`, cleared on zone change and stack exit).

Rejected: two instances with one flagged the lead — every reader would see two
permanents where the CR says one (the per-reader conditional that fails open).

### 2. The pair declares itself on `backFace.kind: "meld"`, on both halves

Each half declares the pair's combined back face with `kind: "meld"` (the
compiler already lowers the layout this way, issue #7581). The declaration is
a LAYOUT fact, never a copiable value, so a token copy of a meld card is not a
meld card. That is CR 701.42b's token case, and it fails because of the
declaration rather than through a special case.

Each half's combined back face is registered as a twin under
`${parentId}#meld` at the ADR 0120 §2 seam (`preloadDefinitions`). It is
outside `allCards`, so deck legality, the Limited pool, `check:index` and
`getAllCardNames` never see a third card (CR 712.4b). The twin carries no mana
cost. Its art is the FRONT image of `backFace.imagePrintId`, because Scryfall
publishes the combined face as a card of its own.

`isTokenCodecBackFace` (`cards/modalDfc.ts`) is the one predicate that tells a
nonmodal transform face (the token codec) apart from a twin kind. It replaces
three sites that asked `kind === "modal"`, where a meld face would otherwise
have fallen into the token bucket.

Rejected: a central pair table (ADR 0102 forbids per-card registries).

### 3. CR 712.4c and 712.8g are definition facts, read where they already are

- `transformPermanent`, `stampBackFaceForEntry` and `backFaceDefinitionIdOf`
  refuse a meld card. A "return it transformed" puts it back front face up.
- `getPermanentManaValueCost` sums the front faces' mana values off
  `meldedFrom` (`meldedManaValueCost`). A copy presents the twin without
  `meldedFrom`, and the twin has no cost, so the copy's mana value is 0 with
  no branch of its own.
- The CR 603.10 look-back (`lookBackLayer1`) treats a departed melded
  permanent as neither a copy nor a transform, so no `retainedThroughCopy`
  union is claimed.

### 4. One card becomes two at the departure funnel and at the ACTION site

**Departure** (`splitMeldedPermanent`, called by `removePermanentTo`, the
single battlefield-departure funnel):

- It runs after the LKI snapshots, so the leave events describe ONE object
  (Chittering Host's "whenever a creature dies" triggers once).
- It runs on the destination that replacements have already rewritten. That is
  CR 712.21d: one replacement moves both cards.
- The leading card becomes itself again in place. The other card is
  materialised with its own id and print pin into ITS owner's zone (712.21a).
- Both cards carry `meldGroupId`.
- The library and exile card events count two cards (712.21e).

**Acting** (`expandMeldGroup` via `withMeldGroup`, `gre/effects/
interpreter.ts`): `resolveObjectRef` keeps its single-selection signature, so
FINDING is one reference and a question is asked once (CR 712.21c's Mimic Vat
example). An object-acting Op whose reference found a card of a group acts
once more per partner, through a scratch binding. A target slot never
expands: a target is chosen, never "found" as the new object. Flickerwisp's
delayed return therefore returns both cards, each as its own permanent, front
face up (CR 712.14).

The rule is enforced mechanically. `MELD_GROUP_DISPOSITION` adjudicates every
executor whose source calls `resolveObjectRef(`, as `"expands"` or with a
reason. `meldGroupExpansion.test.ts` derives that set from `OP_EXECUTORS`, so
a new object-acting Op reds until it is adjudicated.

The partner is handed to the executor as a RESOLVED selection, so it is
acted on in whatever zone it lies — a graveyard card found off the departure
event (CR 712.21c's False Demise example) as much as an exiled one. A
`forEach` member (`$each`) never expands: the sweep finds each card as its own
member. The census reads executor source, so a primitive with its OWN return
leg is invisible to it: `exileWithAttachments` (the "until this leaves"
family) records the partner in its `ExileReturnBundle` and returns both
cards.

Rejected: widening `resolveObjectRef` to an array. Every caller reading `[0]`
compiles green and drops the second card.

### 5. Arranging the two cards is a player choice: `meld-arrange`

When both cards land in one player's graveyard, library or exile, the
arrangement is queued (`GameState.pendingMeldArrangements`). The owner
arranges a graveyard or library; the player who exiled the permanent orders an
exile (712.21b, the exception to 613.7m). The SBA sweep raises the
arrangement at its settle point as a `meld-arrange` zone pick: of two cards,
choosing the top one is the whole order. This is the `legend-keep` shape:
stackless, committed by `finalizeMeldArrangement`, which re-runs the sweep.
The library pick exposes only those two cards through `libraryPeek`. The Bot
answers through the minimal-legal fallback (first card): the order moves no
material and no reader ranks it.

Noted, not coded around: the arrangement is asked at the sweep's settle point,
so the instants between the two cards landing and the answer — the rest of
the same resolution — see the default order.

### 6. Melding is one atomic engine step: `meldPermanents`

`meldPermanents(state, holderId, partnerId, controllerId)` (`gre/state.ts`)
exiles both objects, then melds them if they are a pair (CR 701.42b). Otherwise
it leaves them in exile (701.42c), where a token then ceases to exist
(704.5d). The melded permanent enters through the ordinary non-cast entry path
(`putReanimatedOnBattlefield`), so its loyalty, ETB events and grants are
those of any permanent put onto the battlefield. The `meld` Op (next slice) is
a thin skin over it. It is ONE Op, never `exile` + `meld`: the `exile` valuer
would score exiling your own permanents as removal, inverting the sign (PRD
#3227 call 4).

### 7. The `meld` Op reads "both own and control" itself (issue #3341)

`{ op: "meld", partner: EffectCardFilter }` runs on the ability's source. PRD
#3227 asked for the condition as an `if` construct around the Op; it stayed
inside the Op, read on resolution, because the construct has no way to say it:
`EffectCardFilter` has no owner, and a field its dozen zone-scoped readers
ignored would fail open. A `choice` beside an owner check would also offer a
counterpart the condition then rejects. Inside the Op, only owned counterparts
are offered, one is taken with no prompt, and two raise one pick.

The valuer is neutral (`ZERO_OP_VALUE`, `OP_BENEFICENCE` `"neutral"`), so the
search decides. A discriminating `must` pair in the blade suite pins that: it
melds with no attack on offer and keeps the 2/4 when the attack is lethal.

The Grammar Rule is a Verb Frame, and reads the ACTIVATED form only. A triggered
meld ability (Graf Rats, Gisela, Vanille) prints an intervening-if the Op reads
only at resolution, so those forms stay refused under `MELD_CLAUSE_REASON`
(CR 603.4). A meld back face names a continuous effect by key
(`staticEffectKeys`), as any back face does.

The Urza halves are hand-written. The Mightstone's modal trigger and mana rider
are outside the grammar (issue #8285). Urza, Lord Protector compiles `ready`, and
is hand-written only because the combined face's art, its own Scryfall card, has
no compile path. Gold lists it as incomparable, because its compiled statics
rebuild to closures, so `urzaPairClauses.test.ts` pins its abilities and back face
to the compiler's output directly.

"This mana can't be spent to cast nonartifact spells" is
`not-nonartifact-spell`, not `artifact-spell`: the two agree on spells, and only
the first pays for an ability.

## Consequences

- Noted, not built: CR 712.21's "whenever a card is put into a graveyard from
  anywhere" triggering TWICE. The engine has no per-card event for a
  battlefield-to-graveyard move (those triggers read `CREATURE_DIED`), so a
  melded CREATURE would trigger them once. Unreachable for the Urza pair (a
  planeswalker). Every other pair melds into a creature and stays refused by the
  compiler today; the first to ship owes it (issue #8176 is next).

- `meld.test.ts` remains the capability test, run with a test-only pair
  registered through the real seam; `meldOp.test.ts` runs the shipped pair.
- CR 712.19 (a player may choose the combined back face's name) shipped
  beside this ADR in issue #7640: the name-choice DOMAIN
  (`chooseableDomainNamesOf`) widens while the object-name predicate
  (`chooseableNamesOf`) does not, because CR 712.4b denies a meld card in hand
  the back face's name. `CARD_BACK_FACE_KINDS.meld.contributesChooseableName`
  is `true`.
- Flip cards are now the last inhabitant of ADR 0041's out-of-scope layout
  bucket.

[adr-0041]: 0041-worklist-driven-cross-set-card-implementation.md
[adr-0120]: 0120-inset-spell-is-a-registered-twin-definition.md
[adr-0122]: 0122-modal-double-faced-card-is-a-front-face-with-a-back-twin.md

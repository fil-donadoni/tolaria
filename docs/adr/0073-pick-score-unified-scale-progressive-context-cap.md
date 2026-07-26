# Pick scoring on one rating-point scale, with a context cap that grows with the pick

## Status

accepted

## Context

The Bot Drafter's score is currently a sum of terms living on unrelated scales
(`convex/limited/botDrafter.ts`):

| Term              | Magnitude                                                        |
| ----------------- | ---------------------------------------------------------------- |
| quality × rarity  | `cardValueById`, tens to low hundreds                            |
| colour commitment | 6 per on-colour Pool card                                        |
| curve gap         | ≤ 30                                                             |
| Pick Rating       | `(rating − 2.5) × PICK_RATING_DOMINANCE_WEIGHT`, weight **1000** |

The dominance weight was deliberate (issue #1117: "rating DOMINATES ordering"),
and it works exactly as specified — which is the problem. Wherever ratings
exist, and the Vintage Cube is now fully rated through the DB layer (ADR 0066),
a single rating point outweighs every contextual term by more than an order of
magnitude. Colour commitment and curve fit are not weak inputs; they are
tie-breaks between cards of identical rating. The bot picks the highest-rated
card in the pack and nothing else is capable of changing that.

Adding Archetype and Capability terms (ADR 0072) underneath a ×1000 term would
change nothing observable. The composition has to be rebuilt before any new
signal can matter.

A second defect blocks the same path: the colour term reads `colors` derived
from the mana cost (CR 202.2), so a dual land, a Mox, a Signet and Birds of
Paradise all present `colors: []` and never enter the colour branch at all. The
mana base is invisible to the current model — not underweighted, absent.

## Decision

**One scale: rating points (0–5), the unit an Admin already edits.** Every term
is expressed in it, and the final score is their sum.

```
effectiveRating = baseRating          // DB rating -> seed rating -> heuristicAsRating(quality)
                + archetypeFit
                + capabilityFit
                + comboEdge
                + colourCommitment
                + castability
                + fixingValue
                + curveFit
```

`PICK_RATING_DOMINANCE_WEIGHT` is retired. `heuristicAsRating` maps the existing
quality heuristic onto 0–5 so an unrated card is comparable with a rated one —
without it a mixed Pool compares different units and unrated cards become
either invisible or dominant depending on the sign.

**The sum of every non-base term is capped, and the cap grows with the pick
number** — roughly 0.3 rating points at the first pick, roughly 2.0 by the end
of the draft. An uncapped sum lets three Capability matches outrank a Black
Lotus; a constant cap forces a single answer to a question that has two, since
the first pick genuinely has no deck to respect and the thirtieth genuinely
does. The growing cap is the "raw power early, fit late" rule every drafter
applies, expressed as the one parameter it actually is.

**Colour splits into three distinct questions**, all derived, none authored:

- **Colour Commitment** — measured from **coloured pips**, not card count:
  `{U}{U}` commits twice as hard as `{4}{U}`. Mana sources contribute at a
  lower weight than spells: a dual land _follows_ commitment rather than
  creating it, so a strong land taken early never marries the seat to a colour
  pair — the classic way these bots derail.
- **Castability** — the candidate's pip requirement against the sources the
  Pool already holds for those colours.
- **Fixing Value** — **deficit-driven, not commitment-driven**:
  `Σ_colour produces[c] × max(0, pipDemand[c] − sources[c])`, capped. A Temur
  pool heavy in `{R}` pips and short on red sources values Volcanic Island above
  Tropical Island though both are on-colour. It self-scales — one white card
  yields a deficit of one, a nudge rather than a summons.

Produced colours come from `getProducibleColors` (`convex/gre/constants.ts`), so
the mana-base half of the model requires no authoring at all.

**The scorer returns the breakdown as its primary type; the score is derived by
summing it.** `scoreCandidate` returns a `PickCandidateTrace` carrying each
term's value **and its provenance** — the specific Pool cards that produced it
(`capabilityFit +0.8 ← provides value-on-death; required by Flash (pick 4)`).
A separate explanation path is rejected outright: a shadow narrator eventually
diverges from the scorer it describes, and a debugging instrument that
confidently reports arithmetic that no longer decides anything is worse than no
instrument.

**`chooseBotPick` takes the seat's `packsSeen` history** even though nothing
reads it yet. Draft Signal reading is out of scope for this work, but the
signature change touches every call site (`startLimitedEvent`, `submitPick`,
`autoPickSeatTimeout`) plus the pure test surface, and doing it twice costs
more than doing it early.

**Correctness is asserted as Pick Invariants, not expected picks.** A gameplay
move has a ground truth — a move that loses by force of rules is wrong, which
is what ADR 0070's Blade admission criteria are built on. A draft pick has
none: every pick is defensible, so a test asserting "the bot picks X" records an
opinion and then defends it against every future retune. Instead, assert the
**direction** the model must respond in:

```
adding Flash to the Pool may not LOWER Worldspine Wurm's score
adding Animate Dead to the Pool may not RAISE Worldspine Wurm's score
a source is worth more to a Pool short of that colour than to one already served
```

These hold for any positive weighting. Retuning never reddens one; only a broken
model does — a miscensused Capability, an inverted deficit, a term not reading
the Pool it claims to. Above them sits a small, **separately filed** set of
**Anchor Picks**: consensus opinions stated tightly enough to be uncontroversial
(Black Lotus is taken from a pack containing no other Power Nine), each with its
rationale, and each failing with a message saying it is an opinion — a red
Anchor calls for a decision (accept and restate, or revert), never an automatic
weight fix.

**Auto-Build (`convex/limited/autoBuild.ts`) consumes the same seams.** It
currently picks the two strongest colours by summed quality and takes ~17
spells, which undoes this work from the other end: a bot that patiently drafts
Flash, Sneak Attack and Worldspine Wurm then cuts Flash for low isolated
quality, and always compresses to exactly two colours — wrong for essentially
every cube Pool, where three-colour decks on duals and fetches are normal. So:
colour choice moves to pip-weighted Colour Commitment, the colour **count**
becomes derived (two, or three when the Pool's own mana base supports it, by
the same source/deficit arithmetic), and spell selection gains a Capability term
so a required enabler is not cut for weak standalone quality.

## Considered Options

- **Keep the dominance weight, add new terms above it** — rejected: it makes
  ratings the only input by construction, so ADR 0072's model would be
  unobservable and untestable.
- **A per-scope flag selecting old or new scorer** — rejected: two code paths,
  one of which keeps its tests green while nobody reads it. The behaviour change
  on already-rated sets (LEA) is accepted instead, and caught by Pick
  Invariants plus the fixed-seed diff.
- **A constant contextual cap** — rejected: it must answer "how much may
  context overturn power" once, when the honest answer differs by an order of
  magnitude between the first pick and the last.
- **Commitment-driven fixing value** (a source is worth more the more committed
  the seat is to its colours) — rejected in favour of deficit: it rewards the
  colour that is already served, which is exactly backwards, and it compounds
  early commitment into a self-reinforcing loop.
- **Score as a number, explanation reconstructed on demand** — rejected: see
  the shadow-narrator argument above.
- **Blade-style admission criteria for a draft correctness suite** (ADR 0070) —
  rejected as a whole: rule 1 (fairness by forced loss) has no analogue when
  every pick is legal and defensible, and rule 2 (iteration budget as a realism
  constraint) has none when a pick is O(pack size) and deterministic. The rules
  that do carry — an entry must bite, an entry must never be circular — are
  carried here in the Pick Invariant / Anchor Pick split without importing the
  runner or the vocabulary around them.

## Consequences

- Bot picking changes on **every** scope, including sets with hand-curated Pick
  Ratings — there is no "empty table means byte-identical" guarantee of the kind
  ADR 0066 could offer, because recomposing the scales _is_ the change. The
  fixed-seed Draft Lab diff is how that change is inspected before shipping.
- Ratings remain the anchor of the score and still decide the large majority of
  picks; they stop being the only input.
- Existing `botDrafter` tests change shape with the return type. This is the
  intended cost of making the breakdown authoritative.
- Weight tuning becomes cheap and safe: Pick Invariants do not move when weights
  do, so a retune produces a Draft Lab diff to read rather than a suite to
  repair.

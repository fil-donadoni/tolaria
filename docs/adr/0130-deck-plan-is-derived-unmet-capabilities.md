# A deck's Plan is the Capabilities its cards require, derived from card structure and priced as latent value — never an archetype label, never per-card knowledge

## Status

accepted (2026-09-14, "formato verdicts" grill session, plan-and-archetype
branch; extends ADR 0072 and ADR 0124 §4, bounded by ADR 0102). Amended the
same day: §9 and §11 first said the static Plan was persisted and carried the
library multiset; the `deckColorKnowledge` precedent makes it transient and
small by construction.

## Context

The play Bot plays a card by what the card does and what the board is worth
after it. It has no notion of what its deck is TRYING to do. That is adequate
for a Premodern aggro list and inadequate for every deck built around a line:
Animate Dead is worth nothing without a creature worth reanimating, a tutor is
worth whatever piece is missing, Oath of Druids is worth something only in a
deck with few creatures of its own. Measured on the Verdict corpus (issue
#3588): not one library-search judgement exists, and the resolution choices it
does hold are blind — identical feature vectors — because the value of the
choice is a goal the evaluation cannot read.

The repository already holds a model of card-to-card fit, built for the draft
Bot: ADR 0072's Archetype / Capability / Combo Edge, where a card PROVIDES or
REQUIRES a named Capability from a closed vocabulary and "absence of a match is
itself the veto". The play Bot uses none of it, because ADR 0102 forbids
per-card knowledge in play.

ADR 0102 also records the one plan-shaped attempt that was measured and
failed. `comboAnnotations` added progressive boosts for registered combos; more
search converged AWAY from the winning activation (2/5, 1/5, 0/5 as iterations
rose). The mechanism, not the magnitude, was the fault: the boost was a
function of the STATE, identical before and after the move, and at its size it
flattened every leaf into the same maximum. Any design here has to produce a
value that changes when the move is made.

Two facts measured during the session bound the scope. The six Premodern tier
1 decks in the repository hold 89 distinct non-basic cards, of which 14 appear
among the 285 Vintage Cube Card Profiles — all format staples, and none of the
engines that make those decks plan decks (Aluren, Oath of Druids, Replenish,
Psychatog). And all 285 profiles are LLM-seeded and unreviewed.

## Decision

1. **A Plan is a vector of Needs**: what the deck requires to function, and
   how much of it is satisfied right now. Not a target state, not a per-style
   reweighting of existing terms. A Need shrinks when the right move is made,
   which is exactly the gradient `comboAnnotations` lacked, and it is bounded,
   so it cannot saturate the material signal.
2. **Needs are unmet Capabilities**, ADR 0072's vocabulary, with the deck's
   structure (colours, curve, land count) as the floor beneath them. Minimum
   threats, answers and acceleration are Capabilities once the vocabulary
   carries them, not a separate model.
3. **The Capability registry moves out of `convex/limited/`** to a neutral home
   beside the Mechanics Registry, one authority for both Bots. The vocabulary
   will grow for constructed play; ADR 0072's own signal still holds — past
   ~15–25 rows, a proposed Capability is probably an Archetype or a Combo Edge.
4. **Capabilities are DERIVED, and derivation is not per-card knowledge.** A
   derivation rule reads only structured definition fields — Ops, keywords,
   types, costs, zones, triggers — never an id, a name or Oracle text. The
   gate enforces that on the derivator's source, in the shape of
   `engineIdentifierNames.test.ts`. How many catalogue cards each rule fires on
   is reported in the generated artifact, visible in review, and deliberately
   NOT a gate: a generic rule over a rare Op is not per-card knowledge, and a
   predicate widened to cover three cards still can be.
5. **The derived Capabilities are a generated, committed artifact**, never a
   field on `CardDefinition`. A definition is authored data, and a field there
   is writable by hand by construction: the day a Bot bug is fixed by typing a
   Capability onto one card, ADR 0102 is violated while the field is still
   nominally derived. The artifact is regenerated from the derivator and
   reviewable in diff, exactly as the Oracle lockfile is. The one exception is
   a card OPAQUE to the derivator (an imperative `resolve()`, a script the rules
   cannot walk): it may declare its Capabilities on its definition, with a
   written justification — the discipline `aiEffects` already has.
6. **Human Card Profiles become the derivator's test bench.** Certified
   profiles are what the derivation must reproduce; a disagreement is a queue
   entry, not a silent override. Judgement stays in profiles — thresholds, an
   Archetype, playability in a format — and is not expected to scale.
7. **An unmet Need enters the Evaluation as CONDITIONAL LATENT VALUE**, no new
   term. A card in hand that requires something absent is worth less, and its
   worth rises in the move that supplies it. This is ADR 0124 §4's mechanism
   already — a targeted Op priced by its best legal target on the current
   board — generalised to what a card requires.
8. **Satisfaction is discounted by distance.** A provider already where the
   requirer needs it satisfies fully. A provider in HAND satisfies partially,
   discounted by how far it is from use, and that discount is a fitted weight
   (ADR 0124), never a hand-picked constant. A Need is satisfied once: the
   best provider counts, not the sum of providers. Without this a tutor for
   the missing piece changes no value on the move that fetches it, and stays
   blind.
9. **The Plan is split by what changes.** The static half — what the deck's
   cards require — is a SEARCH-ONLY field stamped onto each determinized world,
   listed with the transient keys and never persisted, exactly as
   `deckColorKnowledge` already is (issue #3533): the evaluation is called with
   a signature the whole engine uses, and riding on the world the leaf already
   holds keeps one home for the quantity. It is small by construction, because
   the search deep-copies the state at every node — a handful of counts per
   seat, never a decklist. Its absence is the gate: every server path and every
   test that stamps nothing behaves as before. The dynamic half — what is
   satisfied now — is read at every evaluation, and must stay a scan of zones,
   not a recomputation.
10. **The opponent's Plan comes from exactly what the difficulty level
    grants.** Informed — the one difficulty that knows the opponent's list
    today — the opponent's decklist, which the search already samples from
    (PRD #2787). Blind: only cards observed in public zones, as
    `colorCoverage` already does for the seat whose hand may never be read.
    The Plan never reads information the level does not concede.
11. **Deck-composition needs dissolve into two generic readings**, not a new
    construct. Oath of Druids' "controls more creatures" is already a target
    requirement — a condition on the current board. What its reveal finds and
    mills depends on the deck, and the `revealUntilMatch` valuer states that it
    cannot price that "without knowing the deck". The static Plan carries a
    compact summary of each library the search is granted — a few counts per
    seat (how many cards of each type and Capability remain), never the
    multiset, for the same per-node copying reason as §9 — so valuers of
    revealing and drawing effects can take an expectation over it. The deck-BUILDING constraint ("few creatures") is a
    construction concern and not the play Bot's.
12. **An Archetype on a constructed deck is a hint, never a source.** A preset
    may declare one, and the derivation may be checked against it. The engine
    never reasons from the label: an Archetype registry for decks would be the
    per-card registry of ADR 0102 one level up — it does not scale, and a new
    deck would be a Bot that cannot play it.
13. **Success is staged and its criteria are fixed before building.** (1)
    Derivator agreement with certified profiles, reported per Capability, with
    no numeric threshold until certification exists. (2) On the Premodern tier
    1 decks, zero required Capabilities left uncovered without a named cause —
    a missing vocabulary row or a wrong rule. (3) One Discriminating Pair per
    new mechanism: the same position with and without the payoff in hand must
    change the tutor's choice. (4) Authored tutor and reanimation Verdicts are
    not blind, measured as a census diff. The Ladder is not among them; it
    stays for strength claims.
14. **The first slice is vertical, on reanimation.** Derive `reanimatable`,
    carry the static Plan, price reanimation spells by conditional latent
    value, prove it with a Discriminating Pair and an authored Verdict. The
    risk of this design is the evaluation mechanism, not the derivator, so it
    is de-risked on one Capability before the catalogue is derived. Its
    `reanimatable` threshold is a structural proxy declared as provisional,
    replaced once the certified profiles exist.

## Consequences

- The play Bot and the draft Bot share one Capability vocabulary and one
  authority for its names.
- A tutor decision stops being blind the moment the Plan exists: fetching the
  missing piece raises the value of the card that needed it, in the same move.
- Oath of Druids, and every effect that reveals or draws, becomes priced by the
  deck it is in rather than by one scalar.
- The generated Capability artifact is one more thing a card change can
  invalidate, alongside the card index, the Oracle lockfile and the catalogue
  pack.
- The Capability vocabulary will grow, and growth is the moment to ask whether
  a new row is really an Archetype or a Combo Edge.
- What this does not do: find combos. A two-card loop is still ADR 0102's CR
  732 shortcut. A Plan tells the search where value is; it does not walk forty
  plies for it.

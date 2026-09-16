# Draft Signal: a share-gap read per passing direction, a bonus that yields to commitment, persisted as its accumulators

## Status

accepted

## Context

ADR 0073 rebuilt the Bot Drafter's score on one rating-point scale and threaded
`packsSeen` into `chooseBotPick` while explicitly leaving **Draft Signal**
reading out of scope (issue #1616). Two forces make the design non-obvious.

First, a Signal argues for _changing_ colours while **Colour Commitment**
argues for _keeping_ them — two terms pulling in opposite directions on the
same capped contextual sum. Second, the history a Signal needs does not exist
outside the Draft Lab: a live event's Default Pick and Auto-Pick timeout see
only the pack in front of the Seat, and `runBotAutoPicks` sees only the packs
of its own mutation.

In the Vintage Cube, colours alone are a weak read: a control drafter and an
aggro drafter of the same colours are cutting different cards. The closed
Archetype vocabulary (`ARCHETYPE_REGISTRY`, ADR 0072) is the axis that
captures it, though its census is still incomplete.

## Decision

**What is read.** For every pack a Seat receives, the gap between each axis
value's **share** of the raw power still in the pack and its expected share in
a pack of that size drawn from the same scope. Two axes: colour, always; and
Archetype, from Card Profiles, so a scope without profiles is read by colour
alone with no per-scope switch. Raw power is `baseRating` only — never the
contextual score the Signal feeds, which would make the read circular. The
expectation is derived from the scope's pack generator (booster variant ×
slot count × sheet weight; uniform for a cube), never authored. Share, not
absolute mass, because upstream Seats take the best cards and every colour
sits below its absolute expectation in a late pack. A multicolour card splits
its power across its colours; colourless cards and unprofiled cards move
nothing on the axis they lack. A pack nobody has picked from carries zero
weight; the weight grows with the cards removed upstream.

**One read per passing direction.** The Seats feeding a drafter change every
round (`passDirection`), and a pack is already mixed by every upstream Seat
before it arrives, so per-neighbour attribution is impossible and one
aggregate read would follow a side that is not currently passing. A pick
consumes the current round's direction at full weight and the other at a
reduced weight.

**Two new contextual terms, `colourSignal` and `archetypeSignal`**, inside the
ADR 0073 cap and bonus-only like every contextual term. Their weight scales
with **(1 − commitment concentration)**: a Signal counts for as much as the
Seat is still undecided. The conflict with Colour Commitment is resolved by
that one rule, not by a pick-number schedule (the cap already grows with the
pick, and a Seat still undecided at pick 20 should keep listening).

**Persisted as accumulators, not as a pack log.** Each Seat — humans too,
since a Default Pick and an Auto-Pick act for them — carries its per-direction
accumulators on its `limitedSeats` row, folded forward once per pack received
by the same pure function the Draft Lab folds over its in-memory history. An
event started before this lands begins from an empty read.

**Verification** is six Pick Invariants (monotonic in what remains, untouched
pack reads nothing, the read independent of the Pool, the weight
non-increasing as commitment concentrates, same-direction weight not below
cross-direction, neutrality of colourless / unprofiled cards) plus a **Cut
Experiment** — identical seeds, one upstream Seat forced to a single colour,
asserting the downstream Seat ends with less of it — filed as an opinion in
the Anchor Pick sense.

**No live UI.** Reading Signals is the human drafter's skill; the read is
visible in the Draft Lab through the pick breakdown only.

## Considered Options

- **Signal as pseudo-units inside Colour Commitment / `archetypeFit`** —
  rejected: past `COLOUR_COMMIT_GRACE_UNITS` the steeper committed slope would
  marry the Seat to a colour it merely saw open, the exact failure ADR 0073
  closed for mana sources ("a dual land follows commitment, it does not create
  it").
- **A wheeled strong card as the Signal** — rejected: rare, binary, and
  available only from the ninth pick in an 8-Seat pod.
- **"Playables of colour X still present"** — rejected: no baseline, so a
  colour with more cards in the scope always looks open.
- **Persisting the full `packsSeen` log** — rejected: ~14 KB per Seat on the
  row every seat read loads (issue #2507 had just slimmed it), for the sole
  benefit of re-deriving a read under a formula changed mid-event.
- **Draft Lab only** — rejected: the bots of a real event would stay blind,
  which is the only place the behaviour matters.

## Consequences

- A formula change applies to new packs only in an event already running; its
  stored accumulators keep the old formula's contribution. Accepted for a
  draft bot.
- The Archetype half of the read is only as good as the Card Profile census;
  it improves without code changes as profiles are reviewed.
- Picks change on every scope once the terms land; the fixed-seed Draft Lab
  diff remains the inspection tool (ADR 0073).

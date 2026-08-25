# A Limited Deck carries its own Pool; the Limited Event is its provenance, not its authority

## Status

accepted

## Context

`format: "limited"` is the one Format whose legality is not set membership
(ADR 0054/0055). `allowedSets` is `null`, `checkSets` never runs, and the whole
legality surface is `checkPoolMembership` against the Pool of the Seat the deck
was built at. The deck row stores `limitedEventId` + `limitedSeatId`, and every
validation site resolves the Pool through them:
`resolvePoolFromEvent` for the lobby list (`convex/userDecks.ts`), and
`loadLimitedPoolResolver` for game start (`convex/game.ts`). An unresolvable
Pool is a hard failure by design (`pool-unresolved`, issue #1109 AC4) — never a
silent pass.

That coupling has three observed consequences.

**A deck dies with its Event.** Three of the eight `limited` decks in the dev
deployment point at events that no longer exist; their `limitedSeats` rows are
gone too. They report `pool-unresolved` forever and cannot be played, edited
into legality, or converted — `format` is immutable (ADR 0036), so no in-app
gesture can free them. The events were lost to a manual cleanup, not to a live
code path: `cancelLimitedEvent` deletes only `open` events (which have no
Pools) and `sweepAbandonedLimitedEvents` sweeps only `open` ones. But the
fragility is structural, and only luck decides whether it is exercised.

**Event retention is hostage to deck legality.** `convex/crons.ts` states the
bind outright: started/finished events are deliberately never swept, because
their Seats' Pools are what every `limited` deck validates against. Unbounded
event growth is accepted as the price of not silently invalidating saved decks.

**The Event's lifecycle is not a reliable snapshot point.** Five events in the
same deployment are parked in `started` and were last touched days ago; an
abandoned event is ordinary, not pathological. Any scheme keyed on `finished`
would never free their decks.

Separately, a `limited` deck can be opened in the lobby's constructed
deckbuilder, which has no notion of the format (no occurrence of `limited` in
`deck-builder.tsx`, `deckBuilderDispatch.ts` or `deck-detail.route.tsx`) and
edits against the full catalogue. `userDecks.update` validates nothing —
consistent with the glossary, where an illegal deck is still saved as a draft —
so adding one off-Pool card silently makes the deck permanently illegal. This
was reported from real use, not inferred.

## Decision

**A `limited` deck owns a Deck Pool: its own copy of the Seat's Pool, stored in
a companion table keyed by deck id, and the only Pool any validation of that
deck ever reads.**

1. **Written on save, skipped when identical.** Every save of a `limited` deck
   writes the current Pool into the companion and skips the write when the
   payload matches what is stored — the discipline `saveSeats` already applies
   to seat payloads. During a Draft the Pool grows and the copy is refreshed;
   once picking ends the payload stops changing and the writes stop. The deck
   and its Deck Pool are written in the same instant from the same Pool, so a
   deck can never be illegal against its own Deck Pool by construction.
2. **Companion table, never the deck row.** The lobby keeps `userDecks.listMine`
   subscribed and Convex bills a read by the whole document; 45–90 Pool entries
   inline on a hot row repeats the amplification the `limitedSeats` split
   already removed from the event row.
3. **One authority at every instant.** Validation reads the Deck Pool and never
   the Seat. There is no "companion if present, else the event" fallback: a
   two-source rule is what drifts.
4. **Game start resolves by deck id.** `createGame`/`createSoloGame`/`joinGame`
   accept an inline deck payload, so it carries `userDeckId`, mandatory for
   `format: "limited"`. The server asserts ownership of that row and reads its
   Deck Pool. Ownership is thereby expressed once, as "you own this deck",
   replacing `assertLimitedSeatOwnership`'s "you occupy this seat" — the same
   guarantee, still keyed off the authenticated caller, and one that keeps
   holding after the event is gone. A client-supplied Pool is never accepted:
   it would let the caller declare the universe it is validated against.
5. **`limitedEventId` / `limitedSeatId` are demoted to provenance.** They stay,
   because `useLimitedSeatDeck` uses them to find a Seat's deck while the event
   runs, but they gate no legality and may dangle harmlessly.
6. **Limited Origin classifies the deck.** A canonical key — event kind plus
   Pack Source (`sealed:lea`, `draft:inv`, `draft:inv+ps`, `draft:cube:<slug>`)
   — copied onto the deck row at creation, driving a second-level filter under
   the lobby's `Limited` Format filter whose options are the distinct keys among
   the user's own decks. Set codes are sorted and deduplicated in the key; the
   displayed label is derived from it. Pack counts are deliberately excluded.
7. **A `limited` deck is edited only inside its Pool.** It opens in the pool
   deckbuilder over its Deck Pool rather than in the constructed builder, and
   `userDecks.update` rejects a patch introducing a card the Deck Pool does not
   account for. The server-side guard is load-bearing regardless of what the
   client offers.
8. **Migration.** Backfill the Deck Pool for every `limited` deck whose event
   still resolves; delete the decks whose Pool cannot be recovered. Afterwards
   "a `limited` deck without a Deck Pool" is an impossible state, and if it
   occurs anyway the existing hard failure stands.

## Consequences

- A Limited deck is a permanent, self-contained object: playable, sideboardable
  within its Pool, and classifiable long after its event ends.
- Event retention is no longer a deck-legality question. Sweeping finished
  events becomes possible — deliberately NOT done here (see below).
- The Pool is duplicated per deck. A Seat has one deck today
  (`useLimitedSeatDeck` looks one up by `(eventId, seatIndex)`), so the cost is
  one copy per deck that exists.
- Anything reading a Pool for a saved deck must read the Deck Pool. A new
  consumer resolving through the event would reintroduce exactly the coupling
  this removes.
- Draft-time saves cost one extra write each until the Pool settles.

## Alternatives considered

**Clone the deck into Freeform when the event is deleted.** The original
proposal. Rejected on two counts: nothing deletes an event that has Pools, so
the trigger does not fire; and it answers deck survival with a format change,
which discards the sideboard's meaning (at Limited the Pool IS the sideboard,
`maxSide: null`) and files a Sealed LEA deck and a cube draft deck together
under Freeform with nothing to tell them apart. A manual "duplicate as
Freeform" gesture remains available as an unrelated deck-library feature; an
automatic one is rejected outright, since it would silently double every deck.

**Snapshot at Pool freeze, or at `finished`.** Cleaner-sounding, both unusable.
At freeze the deck row may not exist yet (the builder refuses to create a row
for an empty deck) and a Seat-keyed companion would just be `limitedSeats`
again. At `finished`, the five events parked in `started` show that a large
share of decks would never be freed.

**Sub-format as separate FormatIds** (`sealed-lea`, `draft-cube`). Rejected:
Format is defined as a set of construction constraints, and these all share the
same ones. It would also multiply FormatIds by every set combination.

**Sweep finished events now.** Unlocked by this ADR, deliberately deferred. An
event holds Rounds, Pairings and the results Standings derive from — deleting
it discards event history, a different decision from "the deck survives", and
the destructive half of the pair. Keeping them separate leaves it reversible.

**Make Limited decks read-only.** Considered as the cheap fix for the
constructed-builder bug. Rejected: it preserves a Limited deck while forbidding
the one gesture Limited play consists of between games — rebuilding out of the
Pool.

## What would change the answer

- A Seat gaining several decks would make the per-deck Pool copy real
  duplication, and a Seat-keyed store with deck backrefs would then be cheaper.
- A Pool that could change after a deck is saved (an event-level rebuild, a
  card correction) would break the write-together invariant and demand an
  explicit version on both sides.

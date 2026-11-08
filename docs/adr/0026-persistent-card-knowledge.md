# ADR 0026 — Persistent per-card knowledge (`knownTo`) replaces choice-derived visibility

_Dated (2026-11-08, issue #8726): repo paths named below that no longer exist (path retired): `convex/cards/sets/lea.ts`._

**Status:** Accepted (2026-06-19), amended 2026-09-11 (issue #3001 — the
impulse idiom exiles FACE UP; see the `knownTo` bullet below), amended
2026-11-06 (issue #3281 — position is a fact of its own; see § Amendment:
library position follows the placement)

## Context

Card identity in a **Hidden Zone** (library, hand, face-down exile) is today
**stateless**: visibility is recomputed at projection time from the head of
`state.pendingChoices` (`computeChoiceExposure` in
`convex/gameProjections.ts`). While a `reorder-library` / `search-library` /
`reveal-hand` choice is active, the chooser sees the relevant cards
(`libraryPeek` / `librarySearch` / `revealedHand`); the instant the choice
resolves, that exposure evaporates.

That model is wrong for any effect whose knowledge must **outlive the
action**:

- **Natural Selection** (`convex/cards/sets/lea.ts`) looks at the top 3 cards
  and optionally shuffles. If you choose **not** to shuffle, you still know
  those 3 cards — but only you, not the opponent. Today the knowledge is gone
  the moment the reorder choice closes.
- **Reveal** effects ("reveal the top card…") must make a card face-up to
  **all** players until the library is shuffled.
- **Hand disruption** (Duress/Hymn) lets the caster see an opponent's hand;
  that knowledge should persist until an event invalidates it.

There is no card-level field expressing "player X knows this instance's
identity." The only adjacent state is `faceDown` / `faceDownOf` for
battlefield morphs (ADR 0013), which is identity-hiding for permanents, not
viewer-scoped knowledge for hidden zones.

## Decision

Introduce a **stateful, per-instance, viewer-scoped** knowledge field and
make projection a pure function of it.

- **`knownTo?: string[]`** on `CardInstanceState` — the set of player ids that
  currently know this instance's identity while it sits in a hidden zone. One
  field serves both information classes:
    - _look_ effects add the **looker** only.
    - _reveal_ effects add **all** players.
    - ~~face-down exile (impulse-draw) adds the **controller**~~ — **amended
      (issue #3001):** a **face-down exile** adds the one player entitled to
      look, reusing `knownTo`, **not** a parallel mechanism (`faceDownOf`
      stays scoped to battlefield morphs) — but the **impulse idiom is not a
      face-down exile**. "Exile the top card of your library; you may play
      that card this turn" (Ragavan, Laelia, Inti, Robber of the Rich, Fallen
      Shinobi, Urza, Elkin Bottle, Ice Cauldron) names no face-down exile, so
      CR 406.3's first sentence holds — "exiled cards are, by default, kept
      face up and may be examined by any player at any time" — and those
      cards stamp **nothing**: they reach exile through the ordinary
      zone-mover, which empties `knownTo` on entry to a public zone.
      `exileFaceDown` now serves only the cards whose ORACLE TEXT says "face
      down" (Memory Jar, Necropotence, Headliner Scarlett, CR 702.75a
      hideaway), and its `producer` argument is **required** so a new call
      site cannot inherit opponent-hiding by omission. Visibility and
      permission are orthogonal: the play/cast grant stays scoped to one
      player regardless.

- **Persistence.** `knownTo` lives on the instance and **persists across
  hidden→hidden moves** (drawing a card whose top-of-library identity an
  opponent had seen keeps it known to that opponent — matches Arena). There is
  **no lifetime/expiry**; only explicit events clear it.

- **Clear triggers** (the single principle: knowledge of viewer V over hidden
  zone Z is cleared when Z changes in a way V did not choose-and-witness):
    1. **Shuffle library** → clear all viewers, whole library (CR 701.24).
    2. ~~**Random or owner-chosen discard** → clear all non-owner viewers, whole
       hand.~~ **Revised (2026-07, see below): discards no longer clear
       knowledge of the remaining hand.** A discard moves one instance to the
       public graveyard; because knowledge is per-INSTANCE, every card left in
       hand stays identifiable to any prior knower. A discard is therefore NOT
       an uncertainty event for the cards it leaves behind.
    3. **Entering a public zone** (stack/battlefield/graveyard/exile-face-up) →
       empty that instance's `knownTo`. The zone makes identity universally
       known anyway; emptying ensures a later return to a hidden zone is hidden
       unless **freshly** re-granted by precise positioning. Stale `knownTo`
       never resurrects.

    Implemented as one helper `clearKnowledge(zoneCards, selectorId | null)`
    invoked by the mutation primitives; `selectorId = null` (random) clears
    everyone except the owner.

- **Owner never auto-knows their own library order.** A player sees their own
  library cards only where they are `knownTo` them (e.g. scry-to-top). This is
  a deliberate game-correctness choice, not a leak.

- **Two layers coexist.** The existing **transient** choice exposure still
  drives the in-choice dialog (reorder UI, search picker). New **persistent**
  `knownTo` is stamped at the moment the look/reveal resolves and is what
  survives afterward.

- **Telepathy** ("opponents play with hands revealed") is **continuous** and
  is **not** modeled via `knownTo` (a clear event would wrongly wipe it).
  It is a projection-time static check.

- **Projection** (`projectPublicState`, per `viewerId`) reveals identity iff
  the zone is public, OR the viewer owns the hand, OR `viewer ∈ knownTo`. Wire
  shapes:
    - Library: `{ count, known: Array<{ index; card }> }` — sparse, only
      `knownTo`-viewer cards, `index` from top.
    - Hand: `(SlimCard | null)[]` — known slots carry identity, length
      preserved.
    - Own-hand cards gain a derived `seenByOpponent: boolean` (≥1 non-owner in
      `knownTo`) → drives the Arena-style **eye icon**, rendered per-card only on
      the specific known cards.
    - Raw `knownTo` is **never** sent to the client — only identity gating + the
      derived flag.

## Amendment: library position follows the placement (issue #3281)

`knownTo` answers one question, who knows what this card is, and the library
projection used it to answer a second, who knows where it is. Two defects came
from that:

- A card put second or third from the top in full view (Oust, Teferi, Hero of
  Dominaria) was hidden from everyone until it reached an end of the library,
  because only the two contiguous runs from each end counted.
- A card an opponent had seen in hand kept that opponent in `knownTo` through a
  private put-back (Brainstorm), so the run rule showed the opponent where the
  controller had chosen to put it. "Prior knowers persist" held for identity and
  was wrong for position.

**A card's position in a library is known to exactly the players who could see
that placement.** A public placement gives identity and position to every player.
A private placement gives its position to its controller alone.

`libraryPositionKnownTo?: string[]` on the instance records who saw the card
placed where it is. `knownTo` stays the identity record and is not narrowed by a
private placement. `knownLibraryIndices` stays the single derivation, shared by
the wire projection and `determinize`:

- **A card with a record:** the record alone decides. A player it names knows the
  index at any depth; a player it omits does not, even one in `knownTo`.
- **A card with no record:** the contiguous-run rule on `knownTo`, unchanged. A
  look, a scry or a reveal conveys what it always did, and a scry-known card an
  unknown card straddles still reads as a back. A witnessed card extends a run,
  as any card known to that viewer always has.

**Stamped by** the placements themselves: `putIntoLibraryFromBattlefield`, a spell
moved from the stack into a library and a card `moveCardById` moves there from a
public zone, Volrath's Stronghold's top leg included (everyone), and
`putHandCardOnTopOfLibrary` (the hand's owner plus the audience of a reveal in the
same resolution).

**Kept through** ordinary library traffic. The record names the card, not an
index, so a draw or an insert shifts it with no bookkeeping. A later look or
reveal of a recorded card adds the viewer to the record.

**Narrowed** to the chooser when the card goes through a hidden choice: the answer
to any choice over library cards (`order-top`, `reorder-library`, a
`look-distribute` split, a closure's own pick or partition, a melded pair's
`meld-arrange`), `putLibraryCardsOnTop`, and a hand card `moveCardById` puts into a
library. The narrowing covers every card the chooser looked at, not
only those picked: a card that stayed where it was would otherwise show that the
split left it there. A card with no record whose every knower saw the placement
stays under the run rule, so a look gains no reach. A card known to anyone else
gets a record naming the witnesses, because the run rule alone would show it: a
card revealed on top and then scried to the bottom is hidden from the opponent, and
so is the order Drafna's Restoration chooses for the artifacts it returns. Reordering
a single card hides nothing and narrows nothing.

**Ended by** a shuffle and by a re-placement nobody can follow (`clearKnowledge`,
through `forgetLibraryCards` for part of a library): a random-order placement and
the `lookDistribute` bottom leg, which also runs with no choice when nothing can be
kept. A chooser who ordered that bottom pile regains its knowledge as a look. A
card also loses its record by leaving its position (`moveCard`, the zone-change and
stack ladders).

Raw `libraryPositionKnownTo` never crosses the wire. The client Brain restores
every `library.known[]` entry as a record, because an entry may sit at any depth.

**Not widened, on purpose:** look-class knowledge, `reorder-library` and
`divide-piles` peeks.

## Rationale

- **One field, both classes.** Look vs reveal differ only in _which_ players
  are added. A single `string[]` keeps one projection rule and avoids a
  parallel "revealed" concept that would drift out of sync.
- **State on the instance, not a player-side map.** A player-level
  `Record<playerId, instanceId[]>` duplicates identity and must be kept in
  sync on every zone move; `knownTo` on the instance moves with the card for
  free, which is exactly the persistence semantics we want.
- **Clear-on-public-zone, not clear-on-exit.** Clearing on every zone exit
  would break the witnessed draw case (opponent legitimately keeps knowing a
  card they saw you draw). Clearing specifically at the public-zone boundary
  is the minimal rule that prevents stale knowledge from resurrecting.
- **~~Conservative whole-hand clear on unwitnessed discard.~~ Revised
  (2026-07): discards do NOT clear knowledge of the remaining hand.** The
  original rule reverted the whole hand to hidden on any discard the knower did
  not choose. In practice this hid cards a full reveal (Thoughtseize, Duress,
  Hymn to Tourach) had legitimately exposed: the reveal stamps the whole hand
  `knownTo`, the caster picks one to discard, and the remaining cards then
  vanished from view the instant the spell finished resolving. Because
  knowledge is tracked per card INSTANCE and every discarded card is publicly
  visible in the graveyard, removing one card introduces no uncertainty about
  the others — the identity→instance mapping of the survivors is unchanged.
  Only a genuine uncertainty event (shuffle, or a hidden return to the library)
  now clears hand knowledge. `discardCard`, `discardAtRandom`, and the CR 514.1
  cleanup discard dropped their `clearKnowledge` calls accordingly.

## Consequences

- New optional field on `CardInstanceState` → must be added to
  `PERSISTED_OPTIONAL_KEYS` in `convex/gre/serialize.ts` with a round-trip
  smoke test (schema-drift guard).
- Every zone-mutation primitive (shuffle, discard, draw, move-to-public) gains
  a `clearKnowledge` / transfer responsibility; look/reveal/disruption resolve
  paths gain a `knownTo +=` stamp.
- Projection, wire format, and the four UI surfaces (own-hand eye icon,
  opp-hand face-up, own-library known positions, opp-library known positions)
  change. Library preview shows the top card when it is `knownTo` the viewer;
  the expanded pile shows known cards at their known positions.
- **Deferred (follow-up):** the client-side ISMCTS bot's determinization
  should be constrained by `knownTo` (do not randomize cards the bot
  legitimately knows). Out of scope for the first cut.

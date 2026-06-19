# ADR 0026 — Persistent per-card knowledge (`knownTo`) replaces choice-derived visibility

**Status:** Accepted (2026-06-19)

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
    - face-down exile (impulse-draw) adds the **controller** — reusing
      `knownTo`, **not** a parallel mechanism. `faceDownOf` stays scoped to
      battlefield morphs.

- **Persistence.** `knownTo` lives on the instance and **persists across
  hidden→hidden moves** (drawing a card whose top-of-library identity an
  opponent had seen keeps it known to that opponent — matches Arena). There is
  **no lifetime/expiry**; only explicit events clear it.

- **Clear triggers** (the single principle: knowledge of viewer V over hidden
  zone Z is cleared when Z changes in a way V did not choose-and-witness):
    1. **Shuffle library** → clear all viewers, whole library (CR 701.20).
    2. **Random or owner-chosen discard** (Hymn-style, and any discard the
       knower did not select) → clear all non-owner viewers, whole hand.
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
- **Conservative whole-hand clear on unwitnessed discard.** Even though
  discarded cards are publicly visible in the graveyard, the chosen rule
  reverts the whole hand to hidden for non-owners — the user's intended
  behavior (you can no longer trust your mapping of identities to held cards).

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

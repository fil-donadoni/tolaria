# A Last-Known-Information store for copiable values, so "create a token that's a copy of it" survives the source leaving

## Status

accepted (shipped in #2075)

## Context

Offspring's trigger half (CR 702.175a) reads "When this permanent enters, if its
offspring cost was paid, create a token that's a copy of **it**, except it's
1/1." The word "it" names the ability's own source, and it is **not a target**.
Two rules decide what happens when that source has left the battlefield before
the trigger resolves:

> **608.2h** If the effect requires information from a specific object,
> **including the source of the ability itself**, the effect uses the current
> information of that object if it's in the public zone it was expected to be
> in; if it's no longer in that zone … the effect uses the object's **last known
> information**.

> **111.12** If an effect instructs a player to create a token that is a copy of
> a nonexistent object, no token is created … **This does not apply to an effect
> that would use the last known information of an object.**

So the token **is** created from LKI. Removal in response to an ETB trigger is
the single most ordinary line of play in Magic, which makes this the common case
rather than an edge.

The engine does the opposite. `SpellContext.createTokenCopyOf`
(`gre/state.ts:12448`) resolves its source with `findOnBattlefield` and returns
`undefined` otherwise — correct for Dance of Many, where the source is an
announced **target** and CR 608.2b makes an absent target illegal, and wrong for
any non-targeted "a copy of it". The consequence is broader than Offspring: no
"when this creature dies, create a token that's a copy of it" trigger is
expressible at all today, because at resolution its source is off the
battlefield by definition.

There is LKI at the departure chokepoint (`gre/state.ts:7855`) — types,
subtypes, presented card id, owner, controller, effective P/T, combat partners —
but it exists as **local variables** fed to the leave event, consumed by triggers
matching that event. Only `countersAtLeave` persists, and CR 707.2 excludes
counters from copying. The one persistent LKI in the engine is precisely the one
a copy must not use.

Three further facts constrain the shape:

1. `TRANSIENT_KEYS` in `serialize.ts` is **empty**, so any new `GameState` key is
   persisted into the `gameStates` row — and row size is this system's Convex
   cost driver, paid on every write through subscription fan-out (PRD #1776).
2. **CR 704.5d** (`sba.ts:280`): a token in any zone other than the battlefield
   ceases to exist and its instance is **removed from state**. State-based
   actions run before priority is regained, so by the time a trigger resolves a
   dead token has no instance in any zone.
3. `PublicGameState = Omit<GameState, "players" | "stack" | "phasedOut" | "pendingTriggerBatch">`,
   so every other top-level key crosses the wire verbatim, with no one deciding
   that it should.

## Decision

**A pruned `GameState` map from instance id to a copiable-values snapshot,
written at the single battlefield-departure chokepoint and read as
`createTokenCopyOf`'s fallback.**

- **Contents: the copiable values only** (CR 707.2) — deliberately **not** the
  _effective_ P/T the adjacent departure snapshot takes: layered buffs are
  correct for "damage equal to its power" and wrong for a copy, because CR 707.2
  ends "Other effects … are not copied". Two LKI snapshots sit side by side with
  deliberately different semantics, and the code must say so or someone will
  unify them.

    **As shipped (#2075), the entry is the presented definition id plus the
    copy-effect "except it's N/N" stamp — not a materialised dump of types,
    subtypes, base P/T and static abilities.** Those four ARE the copiable values,
    and they are exactly what `getDefinition(presentedDefId)` answers: `applyCopy`
    derives every one of them from the copied definition and reads nothing else
    off the source object. Materialising them would duplicate the definition into
    the hottest row in the system for no behavioural gain — the very cost this ADR
    bounds elsewhere with a two-turn window — and would create a second, driftable
    authority on what a copy of the object is. The invariant to keep is the
    pairing: the store carries whatever `CopySource` (`gre/copy.ts`) declares a
    copy source contributes, minus what the definition id already answers. Issue
    #2963, which will make the remaining "except" clauses (colours, additional
    subtypes, no mana cost) inherit off the SOURCE INSTANCE instead of being
    rebuilt from the copied definition, is the day the store owes those fields.

- **Enumerate the fields; never spread the instance.** A `{...card}` would carry
  `faceDownOf`, which is not a copiable value and which the projection
  deliberately deletes for non-controllers (`gameProjections.ts:325`, `410`).
- **Taken before any CR 708.9 reveal.** A face-down permanent's copiable values
  _are_ the face-down body (CR 707.2 "as modified by … its face-down status"), so
  an LKI copy of a face-down creature that died is a 2/2 colourless nameless
  thing, not the revealed card. `presentedDefId` returns the sentinel at that
  moment — correct by construction, but only in that order.
- **Written for every departing permanent, tokens included.** The map entry
  outlives the instance that `checkTokenExistenceSBA` removes, so a token source
  is covered with no second mechanism. This is why the map beats the obvious
  alternative of a `copiableAtLeave` field on the instance, mirroring
  `countersAtLeave`: that field dies with the token and would need a hoisting map
  anyway, i.e. two mechanisms to do one thing.
- **Pruned at cleanup (CR 514) on a two-turn window.** The longest-lived
  referent the engine can produce is a delayed trigger: "at the beginning of the
  next end step" fires by turn N+1 and "at the beginning of your next upkeep" by
  turn N+2's upkeep, both before the cleanup that would drop a turn-N entry. Row
  growth is therefore bounded by two turns of departures rather than by the game.
- **It crosses the wire, unredacted, on purpose.** The client Brain runs
  `resolveTopOfStack` on a local clone (ADR 0074); without LKI its simulation
  diverges from the server on exactly the cards this store enables, which is the
  drift ADR 0074 says sharing the module exists to prevent. It is safe because
  everything that was on the battlefield was public, and CR 708.9 reveals a
  face-down permanent to all players in the very act of leaving. Recorded
  explicitly because unredacted state crossing `projectPublicState` is a known
  bug class here (#1977/#1982).

### Considered and rejected

- **Document the divergence and create no token.** Cheap, and wrong in the most
  common line of play: pay the offspring cost, opponent responds with removal,
  receive nothing.
- **Snapshot the copiable values onto the trigger's stack item when it is put on
  the stack.** Small, and almost right — but it freezes a characteristic early
  instead of reading the mechanism late, so it is wrong whenever the copiable
  values change between trigger and departure, and it serves one trigger where
  the store serves the family.

## Consequences

- One new persisted `GameState` key, owing `PERSISTED_OPTIONAL_KEYS` an entry
  and a round-trip smoke test — the drift guard in `serialize.test.ts` fails
  otherwise. The snapshot's definition id should use the v2 card-id string table
  (#1780) rather than embedding raw uuids in the hottest row.
- `createTokenCopyOf` gains one fallback branch, opt-in per call; the fizzle
  behaviour for an announced **target** that has left is unchanged, because that
  is CR 608.2b and a different rule.
- **Precedence against the Eternalize recovery** (#2339), settled in #2075.
  Both widenings answer "the source is not on the battlefield", and CR 608.2h
  says which applies: the effect reads the object "in the public zone it was
  **expected** to be in". An ability whose own activation cost moved the card
  graveyard → **exile** expects it in exile and copies THE CARD (printed
  values); a battlefield-sourced ability naming its own source expects the
  battlefield, so the store wins — and it must, because `revertCopy` restored
  the printed identity of a dead Clone on the way to the graveyard, making that
  card the wrong object. The `createTokenCopy` Op therefore splits its `$source`
  recovery on the zone the card is actually found in, and the two opts are
  mutually exclusive.
- Unlocks the "when this dies, create a token that's a copy of it" family, none
  of which is expressible today.

# A scenario spec carries its stack: the position is declared, not replayed

## Status

accepted (2026-09-12, verdict-quiz design session; PRD #3397, issue #3513)

amended 2026-09-13 (issue #3515): decision 8 is lifted — a spec carrying a
stack IS loadable into a live game. See below.

## Context

`ScenarioSpec` (`convex/debugScenarioSpec.ts`) describes a BOARD. Until this
record it had no stack, so a decision taken with anything in flight could not
be written down — and that is most of the decisions worth judging. The verdict
quiz exists to file a human's judgement on one Bot decision (ADR 0124), and the
interesting ones are responses: hold priority over your own spell, answer the
opponent's.

Issue #3480 answered that with a RECORDER. `convex/gre/ai/verdicts/journal.ts`
plus `src/lib/ai/stack-journal.ts` keep the board as it last stood with an
empty stack, plus the moves taken since, and the lowering replays them as a
`setup` walk. The mechanism is sound; its coverage is not. The browser journal
is fed from exactly one call site (the vs-AI driver), so it sees the Bot's
moves and no human's — and this engine hands priority to the NON-caster once a
cast commits, so essentially every live response window contains at least one
move the journal never saw
(`docs/findings/3480-human-moves-never-reach-the-stack-journal.md`). Two real
refusals, both from live play:

```
the journalled walk rebuilt a different stack — in play [opp Powder Keg spell], on the rebuild []
the journalled walk rebuilt a different stack — in play [me Rishadan Port ability:rishadan-port-ability-2 | opp Impulse spell], on the rebuild []
```

The journal's own doc argues, correctly, that a stack cannot be INVERTED: you
cannot derive the board as it stood before the spell was paid for, because
there is no event log and `manaCommitted` is a bare boolean with no attribution
to the spell it paid for. That argument is about inversion. It says nothing
about DECLARING.

## Decision

**A `ScenarioSpec` carries an ordered, bottom-up `stack` of declared objects,
and `specFromState` lowers a live stack into it.**

Declaring is not inverting. What is lowered is the LIVE board — mana already
spent, card already out of hand, every cast trigger already on the queue — with
the objects in flight NAMED. Nothing is walked back, so the impossibility the
journal established is not contradicted; it is sidestepped.

1. **A top-level array, not a `zone: "stack"` on `ScenarioCard`.** An activated
   ability on the stack is not a card: its source permanent is already on the
   battlefield, and a second `ScenarioCard` naming it would build a second Port
   and make every by-name battlefield match ambiguous. The array's ORDER is the
   LIFO semantics (CR 608.1) — index 0 is the bottom.

2. **Two kinds ship: `spell` and `ability`.** A `trigger` needs a `GameEvent`
   vocabulary the spec does not have, and is a later slice. It needs no special
   case to stay out: `placeTriggersOnStack` always writes `triggerEvent`, which
   the residue rule below refuses. (Amended by issue #3516 — see the amendment
   at the end: a third kind, `trigger`, ships with that vocabulary.)

3. **Targets are a full list, and the index is load-bearing** (CR 608.2b,
   `illegalTargetSlots`, `{ target: N }` in an Effect Script). Four shapes:
   permanent by name and seat, player by seat, another stack object by its
   INDEX in the same array, graveyard card by name and seat. `hand-card` is
   never a real announced target (issue #1101), so it is unrepresentable rather
   than refused.

4. **A reference carries `nth`** — the position of the intended object among
   the same-named ones in that zone. `resolveCombatants`' consuming convention
   (a repeated name names a second instance) is deliberately NOT borrowed here,
   for two reasons: it cannot express one spell naming the SAME object in two
   slots, which CR 601.2c expressly allows ("if the spell uses the word 'target'
   in multiple places, the same object or player can be chosen once for each
   instance" — the Plague Spores case, whose CR 608.2b example is about those
   slots' resolution-time LEGALITY, not the permission to pick them), and with
   two same-named permanents
   — one damaged, one not — it resolves to whichever is unconsumed, which is a
   different board with an identical candidate list.

5. **A `spell` reference points at a LOWER index than its own.** You can only
   target what is already on the stack.

6. **The rebuild writes `stackSourceId` with the engine's own rule**,
   `triggerSourceId ?? item.id` (CR 113.7a): an activated ability's stack item
   borrows its source permanent's battlefield id, a trigger's is fresh. Getting
   this wrong loses Tishana's-Tidebinder-class effects silently, so the rule is
   written rather than guessed, and the item itself is built by the engine's own
   `buildActivatedAbilityStackItem`.

7. **Fail closed, per item and per field.** `StackItem` is `CardInstanceState`
   plus ~45 announcement fields. An allowlist names what the spec carries or the
   rebuild re-derives; anything else PRESENT is reported naming the item and the
   field (`isCopy`, `kickerPayments`, `chosenModeId`, `stormSnapshot`,
   `sourceLki`, …), and the WHOLE stack is then withheld. A partially described
   stack is not a smaller loss than none: it rebuilds a position that looks
   complete, and its candidate list can match the live one move for move while
   the board differs — the argument `COMBAT_DROPPED_PREFIX` already makes.

8. ~~**A spec carrying a stack is NOT loadable into a live game.**~~
   **AMENDED by issue #3515: it is.** The refusal read "the objects were never
   announced, so no payment, target window or cast trigger behind them exists"
   — but each of those is SPENT by the time the objects are in flight, so what
   the spec describes is the board AFTER the announcement, which a live game
   continues from exactly as it continues from a response window it reached by
   play. `assertLoadableIntoLiveGame` now refuses only `hiddenHand`; a second
   assertion over the BUILT position (`assertLiveGameCanContinue`) refuses a
   board nobody can ACT in. It asks `computeExpectedInput` — the engine's own
   authority on who is owed a decision (ADR 0047) — rather than listing phases:
   the `MULLIGAN` phase grants no priority at all (CR 117.3a), and a combat
   whose turn-based action is unconfirmed is refused exactly when the mutation
   that would confirm it is closed to everybody (CR 508.1 — the attack
   declaration needs the ACTIVE player holding priority; CR 509.1 — the block
   declaration needs to BE the expected input, which an attacker-less combat
   never makes it). A position a seat can confirm out of is strange, not
   frozen, and loads.

## Consequences

- The stack journal loses its reason to exist. Keeping both would leave two ways
  to lower a stack and a `lowerDecision` that picks between them — and the
  less-travelled branch is the browser one, which is where the journal is
  already blind. It is retired in the next slice (issue #3514).
- `castOffSorceryTiming` (CR 601.2 / 307.1, issue #2473) is lowered rather than
  re-derived. It is an ANNOUNCEMENT-time snapshot, and the board a targeted cast
  commits on is not the board it was announced on — so recomputing it from the
  rebuilt position answers a different question. Every instant cast into a
  response window carries it, so a residue rule that refused it would refuse the
  whole class this field exists for.
- A spell in flight and a same-named card in `cards` are TWO objects. The spec
  names cards, never instances, and the builder creates a fresh instance for a
  stack entry rather than consuming a `cards` one. This is the ordinary position
  — a caster still holding a second copy of what they just cast — and
  `specFromState` produces it verbatim, so a name-collision rule would be a
  round-trip failure rather than a guard.
- A `sacrifice`-cost ability whose source has left the battlefield is refused:
  the spec describes an ability BY its source, and there is none to name
  (CR 608.2h). So is a snapshot that has drifted from its still-present source,
  which the spec has one entry for, not two.
- `stack` joins `combat`, `manaPool`, `restrictedMana` and `continuousEffects`
  as `preserved` in the admin form and excluded from the LLM generator: it
  cross-references the card list by name and seat, and one entry points at
  another by index. It is captured or hand-written, never typed.

## Alternatives rejected

- **Keep replaying (issue #3480's journal, widened).** Fixing the coverage hole
  means feeding the recorder from every move site on the client — and the
  recorder can only ever be as complete as the surface driving it, which is a
  browser hook, not the engine. The gap is structural, not a missing call.
- **Seed the stack by re-running the moves through the engine at build time.**
  The same objection `seedDeclaredCombat` answers (ADR 0070 §4): the board being
  rebuilt is a CAPTURED one that already carries every consequence of the cast,
  so replaying the move applies them a second time and builds a position that
  never existed.
- **Invert to the pre-cast board and replay forward.** Impossible, for the
  reasons `verdicts/journal.ts` records: no event log, and `manaCommitted` is a
  bare boolean.

## Amendment: the third kind, and what a `GameEvent` costs to name (2026-09-13)

Issue #3516 added `trigger`, the kind decision §2 deferred. What it needed was
the EVENT vocabulary, and the measurement that justified building one: on the
issue #3480 protocol (robots vs erhnamgeddon, six games, seeds 1..6, 60
iterations), trigger fields blocked **111 of 423** decisions with a stack —
26.2%, the largest single share in the blocker table.

Three decisions, all following the ones above rather than extending them.

1. **The event is lowered WHOLE, or the trigger is refused.** A trigger's
   resolution reads its event at four sites — the CR 603.4 intervening-if
   re-check, `resolve(ctx, event)`, `$event.<field>` refs through
   `EVENT_FIELD_REGISTRY` (ADR 0049), and the branch guard in `resolveTopOfStack`
   that requires an event at all. "How much of the event does a trigger read"
   therefore has no safe partial answer: a subset is a board nobody played.

2. **Every field of every `GameEvent` member is classified**
   (`gre/triggerEventVocabulary.ts`): `scalar` (no identity in it — an amount,
   a phase, a type line, a card definition id), `player`, `object`,
   `objectList`, `target`, or `residue`. The table is a mapped type over the
   union with `-?` on each member's keys, so a new event member needs a row, a
   new FIELD on a member needs a cell, and `tsc` reds on either — the same
   "structurally impossible to drift" shape `PERSISTED_OPTIONAL_KEYS` has.

3. **An object an event names travels by ZONE, name, seat and `nth`** — wider
   than an announced target's four shapes, because an event names objects an
   announcement never can: the creature that just died (a graveyard), the card
   just discarded, the spell being cast (the stack). Three things are refused
   rather than approximated: an object in no zone the spec describes (a TOKEN
   that has ceased to exist, CR 111.7 — including one still lingering in a
   graveyard before the CR 704.5d sweep, which a rebuild would sweep away), a
   face-down object (CR 708.2), and an opaque hidden-hand placeholder.

What stays out, and is now counted rather than assumed: a trigger whose SOURCE
is not on the battlefield (a dies / leaves-the-battlefield trigger, sourced
from last known information — the spec has one `cards` entry per card, not one
per object CR 603.10 remembers), a `triggerEventBatch` (CR 603.3b), and
`sourceLki`. Each is a named blocker field in the sweep.

One fail-open closed in the same pass: `pendingTriggerBatch` — simultaneous
triggers parked off-stack while their controller orders them (CR 603.3b) — was
a `dropped` note, so those positions rebuilt with the triggers simply gone. It
is now a `stack-not-lowerable` blocker beside `pendingCast` /
`pendingActivation`, which is what `midFlightPaymentBlockers` becoming
`offStackObjectBlockers` records.

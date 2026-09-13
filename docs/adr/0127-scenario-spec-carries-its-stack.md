# A scenario spec carries its stack: the position is declared, not replayed

## Status

accepted (2026-09-12, verdict-quiz design session; PRD #3397, issue #3513)

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
   the residue rule below refuses.

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
   slots (CR 608.2b's Plague Spores ruling), and with two same-named permanents
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

8. **A spec carrying a stack is NOT loadable into a live game.**
   `assertLoadableIntoLiveGame` refuses it, exactly as it refuses `hiddenHand`:
   the objects were never announced, so no payment, target window or cast
   trigger behind them exists. The verdict and blade paths only EVALUATE a
   rebuilt position; playing one forward is a different contract and its own
   slice.

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

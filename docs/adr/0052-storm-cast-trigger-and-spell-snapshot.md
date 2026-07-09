# Storm as a cast-trigger over a spell snapshot

## Context

Storm (CR 702.40) is a keyword ability that reads: _"When you cast this spell,
copy it for each other spell cast before it this turn. You may choose new
targets for the copies."_ It is the engine's first **cast trigger** — a
triggered ability whose condition fires from the **stack** as the spell is
announced, rather than from a permanent on the battlefield.

Three facts about the existing engine shape the decision:

1. **No per-turn spell count exists.** `collectTriggers` (`gre/triggers.ts`)
   scans only battlefield sources (plus just-left graveyard/exile sources for
   CR 603.10). `SPELL_CAST` events are emitted fire-and-forget by
   `emitSpellCastEvent` (`gre/state.ts`) and dropped. The only per-turn cast
   state is the Arboria boolean `qualifyingActionThisTurn`, which saturates at
   `true` and counts nothing. Storm needs a real integer count of spells cast
   this turn, by any player.

2. **Cast triggers are not collectable the ordinary way.** The storm ability
   belongs to a spell that is _on the stack_, not a permanent. `collectTriggers`
   would never see it. A trigger placed by scanning the battlefield is the
   wrong mechanism.

3. **The copy machinery already exists and is CR-subtle.**
   `copyStackItem` / `copyResolvingSpell` / `requestCopyRetarget`
   (`gre/state.ts`, all built on `cloneSpellOntoStack`) ship and are exercised
   end-to-end (Fork `lea/red.ts`, Chain-Lightning family `leg/red.ts`, Onslaught
   `ons/blue.ts`, c19) — backend finalization, bot dispatch, and the frontend
   copy-retarget banner are all live. But every existing user makes **one**
   copy from a **live** source still on the stack. Two storm-specific subtleties
   are not covered:

   - **Count timing.** "each other spell cast _before it_ this turn" is fixed at
     the moment the storm spell is cast. Spells cast afterwards — while players
     hold priority before the storm trigger resolves — must not count. A live
     read of the counter at trigger resolution would over-count.
   - **Countered original.** Per the Grapeshot/Tendrils rulings, the storm
     copies are created **even if the original spell is countered** before the
     storm trigger resolves. `copyStackItem(sourceId)` reads `state.stack` and
     returns `null` when the source is gone, so it would silently produce zero
     copies — a CR deviation.

Storm has been a `status: "planned"` reservation in the Mechanics Registry
(`cards/mechanicsRegistry.ts`, `kind: "keyword-ability"`, CR 702.40) since the
census.

## Decision

Model storm as a **keyword-synthesized cast trigger that copies a snapshot of
the spell**, driven by a new per-turn spell counter. Storm itself is the only
new engine mechanism; the four launch cards (Brain Freeze, Grapeshot, Empty the
Warrens, Tendrils of Agony) are pure Effect Script cards reusing existing Ops
(`mill`, `dealDamage`, `createToken`, `loseLife`, `gainLife`) and existing
target types — no new Op, no new `TargetRequirement.type`.

1. **New `GameState.spellsCastThisTurn?: number`.** Reset in `advanceTurn`,
   incremented inside `emitSpellCastEvent`. Because a **spell copy** is put onto
   the stack by `cloneSpellOntoStack` and never passes through
   `emitSpellCastEvent`, copies never increment the count. Added to
   `PERSISTED_OPTIONAL_KEYS` with a serialize round-trip test (schema-drift
   guard). This is a general primitive — prowess, magecraft, Aetherflux and
   other "spells cast this turn" mechanics reuse it.

2. **Count snapshot rides on the cast event.** `emitSpellCastEvent` reads the
   count of spells cast _before_ this one, emits `SPELL_CAST` carrying it as
   `priorSpellCount`, then increments. Storm's copy count is
   `event.priorSpellCount`, so later spells (cast before the trigger resolves)
   are excluded by construction — no live read at resolution.

3. **New cast-trigger pass `collectCastTriggers(state, castSpell, event)`,**
   invoked on the cast path (where the spell enters the stack and `SPELL_CAST`
   is emitted), distinct from `collectTriggers`. It recognizes keyword-synthesized
   cast triggers (today only `staticAbilities: ["storm"]`) and returns
   `StackItem`s pushed **above** the spell so they resolve first. The synthesized
   storm trigger's resolve body is **engine code** — the keyword's implementation,
   like flying's combat handling — and so is exempt from the DSL-first card
   authoring mandate.

4. **The storm trigger carries a spell snapshot, not a stack reference.** When
   the trigger is built (at cast), it captures `priorSpellCount` and a snapshot
   of the spell's stack item (card id, `targets`, `chosenX`, `chosenModeId`). On
   resolution it loops `priorSpellCount` times, calling
   `cloneSpellOntoStack(state, snapshot, …)` + `requestCopyRetarget(copyId)` per
   copy. Because the source is the detached snapshot, copies are created even if
   the original has left the stack (countered) — CR-faithful. Retarget is the
   existing optional per-copy path, auto-resolved when there is no legal
   alternative (Arena-style zero-branch UX).

5. **Registry flip.** `storm` moves from `status: "planned"` to
   `"implemented"`. `gravestorm` (CR 702.69) stays a `planned` reservation and
   will attach to `collectCastTriggers` when demanded — the pass is built for
   the class, not the single keyword.

## Consequences

- The engine gains a general, reusable per-turn spell counter and a general
  cast-trigger collection pass — the two hard-to-reverse pieces. Adding
  gravestorm, or any future "when you cast this spell" trigger, is a new case in
  `collectCastTriggers`, not a new mechanism.
- Storm copies follow the rulings on both count timing and countered originals,
  at the cost of a snapshot-based copy path that diverges from the live-source
  `copyStackItem` the other copy cards use. The two paths coexist:
  `copyStackItem` for "copy target spell on the stack" (Fork), snapshot-clone for
  storm.
- Bot and frontend inherit the shipped copy-retarget wiring; the only new
  surface is the storm trigger rendering as a stack item and N sequential
  retarget prompts (N copies), which reuse the existing per-copy flow.

## Alternatives considered

- **Per-card `resolve()` or a `copySpell` Op.** Rejected: storm is a CR 702
  keyword, modelled like other keywords (engine-synthesized), not a
  resolution-time effect — it does not fit `effects[]`, and a `resolve()` closure
  per storm card would be an unjustified DSL-first violation.
- **Per-player spell counter.** Rejected: CR 702.40a counts spells cast by _any_
  player this turn; a per-player counter under-counts under an opponent's spells.
- **Live count read at trigger resolution (`counter - 1`).** Rejected:
  over-counts spells cast between the storm spell and the trigger's resolution,
  violating "before it".
- **`copyStackItem(sourceId)` live, like Fork.** Rejected: produces zero copies
  when the original is countered, contradicting the Grapeshot/Tendrils rulings.

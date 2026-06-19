# ADR 0030 — Legend rule as a pending-choice state-based action

**Status:** Accepted (2026-06-19)

## Context

The Legends (LEG) set is the engine's first "legendary matters" set: ~123 of
its cards carry the `Legendary` supertype (`convex/cards/sets/leg.ts`). Per the
modern Comprehensive Rules, **CR 704.5j** governs the legend rule:

> If a player controls two or more legendary permanents with the same name,
> that player chooses one of them, and the rest are put into their owners'
> graveyards. This is called the "legend rule".

Two properties of the rule shape the design:

1. **It is a state-based action** (CR 704.5). SBAs are checked whenever a
   player would receive priority, before any player actually does, and they
   repeat until no SBA applies (CR 704.3). They are not triggered abilities and
   do not use the stack.
2. **It requires a genuine player choice** (which duplicate to keep). The
   surviving copies can differ materially — counters, attached auras, marked
   damage, tap state — so "keep one" is a real tactical decision, not a forced
   outcome. Per ADR 0003 (auto-resolve trivial choices, Arena-style), a choice
   with more than one distinct legal answer must be **prompted**, never
   auto-resolved.

The engine already has a generic mid-resolution choice mechanism
(`state.pendingChoices`, a FIFO queue of `PendingChoice`; ADR 0007 covers the
client-buffered submit). It is normally raised by a spell/ability's resolve
step and keyed to a stack item (`stackItemId`). Three existing choices, however,
are **phase-level**: they are raised outside stack resolution and carry the
sentinel `stackItemId: ""` with a dedicated finalizer that does NOT touch the
stack — the untap-step pick (CR 502.1), the cleanup discard (CR 514.1), and
Aladdin's Lamp's draw-look-keep (CR 614). The legend rule is the same shape: an
SBA-level choice with no owning stack item.

## Decision

Implement the legend rule as a **state-based action that enqueues a phase-level
`pending-choice`**, reusing the existing `pendingChoices` infrastructure rather
than inventing a new prompt mechanism.

### New choice kind

Add `legend-keep` to `ZonePickKind` (`convex/gre/types.ts`). It is a
battlefield zone-pick of exactly one permanent (`count: 1`) whose eligible set
is the precomputed `candidateIds` allow-list (the same-name legendary group).

### SBA: `checkLegendRuleSBA` (`convex/gre/sba.ts`)

Runs inside `checkStateBasedActions`. For each player, it groups that
controller's legendary permanents by effective name and, on finding the first
group of size ≥ 2, enqueues one `legend-keep` `PendingChoice`:

```ts
{
    stackItemId: "",            // SBA-level — no owning stack item
    step: 0,
    choiceId: `legend-keep-${player.id}-${name}`,
    playerId: player.id,        // the controller chooses
    zoneOwnerId: player.id,
    kind: "legend-keep",
    zone: "battlefield",
    count: 1,                   // keep exactly one
    candidateIds: [...sameNameIds],
    prompt: "Choose which <name> to keep …",
}
```

It enqueues **at most one** prompt per call and freezes priority on the chooser.
A board with several simultaneous violations (multiple controllers, or multiple
names) is drained one prompt at a time: the submit handler re-runs the full SBA
sweep, so the next violation surfaces after the previous one is committed
(CR 704.3 — repeat until stable).

Both the **effective name** and the **Legendary supertype** are read from the
permanent's (possibly copied) card definition via `tryGetCardById(card.card.id)`.
Copy effects (Clone, Vesuvan Doppelganger — CR 707.2) overwrite `card.card.id`,
so a copy of a legendary creature correctly groups with the original by the
copied name. A token whose synthesized definition carries `Legendary` is treated
like any other legendary permanent.

### Commit: `finalizeLegendKeep` (`convex/gre/sba.ts`)

Dispatched from `applyPendingChoiceSubmit` when the head is a `legend-keep`
phase-level choice (alongside the existing `untap-pick` / `draw-look-keep` /
cleanup-discard finalizers). It puts every candidate **except** the kept one
into its **owner's** graveyard via `removePermanentTo(…, "graveyard")` — a zone
change, not a destroy, so indestructible / regeneration do not apply
(CR 704.5j). It then re-runs `checkStateBasedActions` and restores priority to
the active player once the sweep settles.

### Reuse, end to end

No new mutation is added — the choice flows through the existing
`submitResolutionChoice` mutation (`convex/game.ts`) and `applyPendingChoiceSubmit`
validation. No new `GameState` field is added — `pendingChoices` is already in
`PERSISTED_OPTIONAL_KEYS` (`serialize.ts`) and already survives projection
(`gameProjections.ts`), so the choice persists across DB writes and reaches both
clients. The UI renders the prompt through the generic zone-pick path
(`pending-choice-prompt.tsx`); a `legend-keep` label is added to the exhaustive
`Record<PendingChoiceKind, …>` (`pending-choice-labels.ts`), `legend-keep` joins
`CLIENT_BUFFERED_KINDS`, and battlefield clickability honors `candidateIds`. The
bot's exhaustive `chooseResolution` switch (`src/lib/ai/brain.ts`) gains a
`legend-keep` case that keeps the highest-value duplicate (ADR 0016 minimal-legal
default).

## Consequences

- The legend rule is fully CR-correct: per-controller, by name, owner's
  graveyard, repeats until stable, always prompts (never auto-resolves a real
  choice).
- A legendary vanilla/keyword creature is playable before this SBA and fully
  correct after — legendary-ness never gated a card's release (PRD #369).
- Adding `legend-keep` to the `PendingChoiceKind` union forces every exhaustive
  consumer (UI label record, bot `chooseResolution`) to handle it at compile
  time — the taxonomy stays in lockstep with the engine.
- The same phase-level `stackItemId: ""` pattern is now used by four distinct
  SBA/phase choices; it is the established idiom for "a choice the rules require
  outside stack resolution".
- **Deferred:** smart bot keep-which (it keeps by raw card value, ignoring
  attached auras / counters); text-changing name effects (Magical Hack on a
  name, layer 3) are not factored into the grouping key, as there is no
  effective-name helper and no LEG card needs one — flagged for a future ADR if
  such a card ships.

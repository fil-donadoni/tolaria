# ADR 0001 — One trigger factory per zone-of-origin (no unified `zoneChangeTrigger`)

**Status:** Accepted (2026-05-22)

## Context

The GRE emits `PERMANENT_LEFT` events for battlefield-exit transitions. A future
need will arise for triggers anchored to other zone transitions:

- "When ~ is discarded" (CR 701.7) — hand → graveyard or hand → exile
- "When ~ is milled" (CR 701.13) — library → graveyard
- "When ~ is put into a graveyard from anywhere" (CR 603.6c) — any zone → graveyard
- "When ~ is exiled from your library" — library → exile
- Etc.

Two structural options were considered:

1. **Unified factory** — `zoneChangeTrigger({ fromZone, toZone, ... })`, with a
   single engine event `ZONE_CHANGED` carrying both fromZone and toZone fields.
2. **Per-origin factory** — one dedicated factory per zone-of-origin (or zone
   transition family): `leftTrigger` for battlefield exits, `discardedTrigger`
   for hand exits, `milledTrigger` for library exits, etc. Each factory listens
   to its own engine event.

## Decision

**Option 2 — one factory per zone-of-origin, deferred until first use.**

`leftTrigger` covers `PERMANENT_LEFT` (battlefield exits) and is in scope for the
initial trigger-factory work. Other zone transitions get dedicated factories
when the first card needing them ships:

- First madness card → `discardedTrigger` + engine `CARD_DISCARDED` event
- First mill-trigger card → `milledTrigger` + engine `CARD_MILLED` event
- First "from anywhere into graveyard" card → `enteredGraveyardTrigger` (or
  similar) + engine `CARD_PUT_INTO_GRAVEYARD_FROM_ANYWHERE` event

Each event is emitted from the specific code site that performs the transition.
No god event with optional fields.

## Rationale

1. **CR taxonomy diverges.** "Leaves the battlefield" (CR 603.10), "is
   discarded" (CR 701.7), "is put into a graveyard from anywhere" (CR 603.6c)
   and "is milled" (CR 701.13) are distinct triggered ability conditions in the
   Comprehensive Rules. Oracle text uses different formulations. Collapsing them
   into a single `zoneChangeTrigger` erases the CR-level semantic distinction
   and forces card authors to reverse-engineer which `fromZone`/`toZone`
   combination corresponds to which oracle phrasing.

2. **Engine emit sites are distinct.** Battlefield exits run through
   `removePermanentTo`. Discards happen from hand inside cost-paying
   (`payDiscardCost`, CR 701.7c) and effect-induced discard (e.g. Hymn to
   Tourach). Milling happens inside the library-to-graveyard primitive. Each
   site has different state to snapshot (e.g. discard tracks "was this discard
   cost-paid?" — relevant for madness). Forcing one god-event means every emit
   site has to populate every field correctly: high bug surface.

3. **Last-known-information payload shapes are incompatible.**
   `PERMANENT_LEFT` carries `attachedToBeforeLeave`, P/T snapshot, types
   snapshot (CR 603.10) — battlefield-anchored info. `CARD_DISCARDED` needs
   `wasCostPaid: boolean` (CR 701.7c) for madness interaction. `CARD_MILLED`
   has no host-attachment data. Unifying produces a payload where most fields
   are null for any given transition.

4. **Trigger frequency divergence.** Battlefield exits are ubiquitous. Mill
   triggers are rare (Future Sight cycle, Spider Spawning style). Cost of
   emitting `CARD_MILLED` on every mill operation is justified only when 2+
   cards listen. Defer the emit cost until the listener exists.

5. **Refactor cost low if we change our mind.** Unifying separate events into
   one later is mechanical — replace per-factory matches with a generic event
   reader. The reverse (splitting a god event back into per-origin events) is
   harder because every emit site has already been written against the unified
   shape.

## Consequences

- Per-zone factory list will grow over time. Acceptable: each factory is small
  (~50 LOC) and dedicated.
- Card authors must pick the factory matching the oracle phrasing. Documented
  in `convex/cards/abilities/triggers/README.md` (to be written when the
  directory is created).
- The unified `zoneChangeTrigger` is NOT to be added speculatively. If future
  experience reveals a pattern across 3+ factories that genuinely shares
  behavior, a follow-up ADR can revisit unification with concrete data.

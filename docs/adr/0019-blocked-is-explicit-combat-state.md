# ADR 0019 — Blocked is explicit combat state, not blocker count

**Status:** Accepted (2026-06-16)

## Context

The combat damage step inferred whether an attacker was blocked from the
**live blocker count**: `applyAllCombatDamage` treated `blockersByAttacker[id]`
being empty as "unblocked" and sent the attacker's damage to the defender.

This is wrong (CR 509.1h). Once an attacker **becomes blocked**, it stays
blocked for the rest of combat even if every creature blocking it leaves —
killed, bounced, or removed from combat. A blocked creature with no blockers
left deals **no** combat damage to the defending player (CR 510.1c), unless it
has trample, in which case (no blocker to absorb lethal) it tramples its full
power through.

The count-based inference produced two concrete bugs:

1. **Removal un-blocks the attacker.** Kill the sole blocker after blocks are
   declared and the attacker would wrongly connect with the defender.
2. **It blocks Ninjutsu-style cards** and any future effect whose semantics
   depend on "this creature is blocked" being durable.

Removing a blocker was also entangled with un-blocking: `ctx.removeFromCombat`
deleted the blocker's assignment, and the damage step then read the now-empty
count as "unblocked". **False Orders** (LEA) leaned on exactly this accident —
its oracle text un-blocks attackers blocked _only_ by the removed creature, but
the engine got that for free from the count, and would also wrongly un-block an
attacker that still had a second blocker.

## Decision

### "Blocked" is recorded state on `combat`

A new combat-scoped field:

```ts
combat: {
    /* … */
    blockedAttackerIds?: string[];
};
```

It lives **inside** `combat`, next to `blockerAssignments` and `bands` — the
same category of intrinsic combat bookkeeping — rather than as a top-level
transient store. `combat` is already serialized wholesale
(`PERSISTED_OPTIONAL_KEYS`), so the nested field round-trips with no extra
serialize wiring. It is set once when blockers lock in and cleared when
declare-blockers re-enters.

### Recorded once, at declare-blockers

`recordBlockedAttackers(state)` (in `banding.ts`, beside
`getEffectiveBlockGraph`) records the attackers that have ≥1 blocker in the
**band-expanded** block graph at the moment blocks are confirmed. It is called
at every site that locks blockers in: the real `confirmBlockers` mutation, the
auto-skip-unblockable and auto-pass paths in `phases.ts`, and the AI
search/apply paths (`search.ts`, `applyMove.ts`).

### The damage step reads state, not count

An attacker is blocked iff it has a **live** blocker now **or** it was recorded
as blocked this combat:

```ts
const becameBlocked = combat.blockedAttackerIds?.includes(id) ?? false;
const isBlocked = liveBlockers.length > 0 || becameBlocked;
```

- never blocked → hits the defender (Forcefield cap still applies);
- blocked, blockers all gone → no damage to the defender, or full power on
  trample (CR 510.1c);
- blocked, live blocker(s) remain → damage per the assignment (unchanged).

`liveBlockers` filters out blockers no longer on the battlefield — removal does
not prune `blockerAssignments`, so a dead blocker can still be listed there.

The `live-blocker OR recorded` disjunction keeps every existing call site
backward-compatible: tests and paths that set `blockerAssignments` without
`blockedAttackerIds` still behave exactly as before.

### `removeFromCombat` no longer un-blocks; `becomeUnblocked` is explicit

`ctx.removeFromCombat` on a blocker now only drops that blocker's assignment —
the attackers it was blocking **stay blocked**. A new
`ctx.becomeUnblocked(attackerId)` is the single explicit override that makes a
blocked attacker count as unblocked (drops it from `blockedAttackerIds` and
from every blocker's assignment). It is the primitive Ydwen Efreet's coin-flip
removal will use.

**False Orders** is rewired onto these primitives: it reads the block graph via
the new `ctx.getBlockersByAttacker()`, records which attackers it blocks
**solely**, removes the blocker, then `becomeUnblocked`s exactly those — so a
sole-blocked attacker is freed while a doubly-blocked one stays blocked. This
both preserves its prior behavior and fixes the multi-blocker case the count
inference got wrong.

## Consequences

- New `combat.blockedAttackerIds`; serialize round-trips via the existing
  `combat` key; cleared at declare-blockers entry.
- New `recordBlockedAttackers` called at all five blocker-confirm sites.
- Damage step keyed on recorded blocked-state + live blocker count.
- New `SpellContext` primitives `becomeUnblocked(attackerId)` and
  `getBlockersByAttacker()`; `removeFromCombat` no longer auto-unblocks (doc
  updated).
- False Orders moves onto the explicit un-block path; multi-blocker correctness
  gained.
- Unblocks Ydwen Efreet (#191) and Ninjutsu-style "stays blocked" effects.

## Out of scope

- Pruning dead blockers from `blockerAssignments` at removal time — the damage
  step filters live blockers instead, which is sufficient and localized.
- CR 506.4d cascade ("creatures stop being blocking" when an attacker leaves) —
  unchanged; rare and out of scope here.

# ADR 0032 — Poison as a player-level resource with its own loss SBA

**Status:** Accepted (2026-06-21)

## Context

The Dark (DRK) set introduces the engine's first **poison** card —
**Marsh Viper** (`convex/cards/sets/drk.ts`), issue #418, cluster C1 of PRD #409.
Its modern Oracle text (ADR 0004 — modern Oracle + current CR) reads:

> Whenever this creature deals damage to a player, that player gets two poison
> counters. (A player with ten or more poison counters loses the game.)

Two rules govern the mechanic:

- **CR 122** — counters can sit on **players**, not only on objects. A poison
  counter is a counter kept on a player.
- **CR 704.5c** — a player with ten or more poison counters loses the game. This
  is a state-based action, checked alongside the other player-loss conditions
  (life ≤ 0 at CR 704.5a, decked at CR 704.5b).

Poison is therefore a **new player-level resource** plus a **new loss
condition** — the first DRK slice to mutate the player-state seam (precedent:
`maxHandSizeOverride`, `skipNextTurn`).

Two design forks needed a deliberate choice, each hard to walk back once cards
and tests depend on the shape:

1. **Where do poison counters live?** The engine already has a named-counter map
   on `CardInstanceState` (`counters[type]`, e.g. `+1/+1`, `doom`). Reusing it
   for poison would mean teaching every counter helper to accept a *player* as
   well as an object — polymorphism the helpers don't have and don't want. The
   alternative is a dedicated scalar on `PlayerState`.
2. **How does the loss interact with the existing player-loss SBAs?** It must be
   evaluated in the same sweep as life-zero and decking, and — for parity with
   the life-zero path — be interceptable by loss replacements (CR 614, e.g. a
   Lich-style "you don't lose the game").

## Decision

### Poison is a dedicated player-state scalar

Add `poisonCounters?: number` to `PlayerState` (`convex/gre/state.ts`),
optional, omitted meaning zero. It is **not** an entry in the object
`counters[type]` map: CR 122 counters on a player are a different domain object
from counters on a permanent (see CONTEXT.md → _Poison Counter_), and conflating
them would force player/object polymorphism into the counter helpers for no
benefit. The field has no cap — it can exceed ten; the threshold lives in the
SBA, not in the mutation.

Mutation is a small pure primitive `addPoisonCounters(playerId, n)` on
`SpellContext` (`player.poisonCounters = (player.poisonCounters ?? 0) + n`). No
`removePoisonCounters` ships in this slice — no DRK card removes poison; it is
added when a card needs it.

Serialization: `poisonCounters` is registered in `PERSISTED_OPTIONAL_KEYS`
(`serialize.ts`) with a round-trip smoke test, so it survives DB writes. It
crosses the wire automatically — `projectPublicState` spreads `...player`, and
`PublicPlayer = Omit<PlayerState, …zones>` carries every non-zone field — so no
projection change is required beyond a wire-format test re-asserting it.

### The loss is a new SBA reason in the existing loop

Extend `gameOver.reason` (`state.ts`) with `"poison"` and add the check to the
existing `checkGameOverSBA` loop (`convex/gre/sba.ts`), after life-zero and
decking. A player with `poisonCounters >= 10` loses (CR 704.5c). The check is
routed through `applyLoseGameReplacements` with `{ kind: "lose-game", reason:
"poison" }`, exactly like the life-zero path, so a future "you don't lose the
game" replacement can intercept it.

### The trigger reuses existing plumbing

Marsh Viper's ability is a `damageDealtTrigger` (the same factory Nafs Asp uses,
`convex/cards/sets/arn.ts`) with a player target, whose `resolve` calls
`ctx.addPoisonCounters(event.target.id, 2)`. Per the Oracle wording it fires on
**any** damage to a player, not combat damage only — no new trigger machinery is
introduced.

## Consequences

- Poison is CR-correct: a player-level resource (CR 122), lost-at-ten SBA
  (CR 704.5c), Oracle-faithful "any damage" trigger.
- The poison total is visible on `PlayerNameplate` (the shared life/name chrome)
  via a dedicated `player-poison-counters.tsx` component, rendered only when the
  count is > 0, using the official poison glyph and the semantic `danger` token
  (ADR 0007 — no chromatic Tailwind).
- Adding `"poison"` to `gameOver.reason` keeps the loss taxonomy explicit; the
  game-over UI already handles arbitrary reasons.
- **Known gap (inherited, not introduced):** `checkGameOverSBA` sets `gameOver`
  on the *first* player in array order that meets a loss condition and returns —
  it does not detect simultaneous double-loss → draw (CR 104.4a). Poison inherits
  this first-loser semantics, same as life-zero and decking. The fix (collect all
  losers in one sweep → `isDraw` when more than one) is tracked as a separate bug,
  **#451** (e.g. Hurricane killing both players should be a draw). This slice does
  not regress the gap and explicitly defers it.
- **Deferred:** infect / toxic / proliferate and poison *removal* — no DRK card
  needs them; they compose onto `poisonCounters` + `addPoisonCounters` when a
  card ships that requires them.

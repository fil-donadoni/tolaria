# Acting Player: deciding a cast on another player's behalf

## Status

accepted

## Context

Word of Command (CR-templated) lets one player choose a card from a target
opponent's hand and **play it during Word of Command's resolution**, making all
of that card's decisions (targets, X, mode, additional-cost picks, which lands
to tap) while the card is still **cast by the opponent** — the opponent remains
the resulting spell's controller and supplies its resources ("mana abilities
only from lands that player controls"). Control extends onto the cast spell's
own resolution.

The engine's cast pipeline conflates two roles into a single `controllerId`:
_whose object/resources it is_ and _who answers the prompts_. It is also a
priority-gated mutation state machine (`announceCast` → `selectTarget` → pay →
`resolveTopOfStack`), and priority is frozen during a resolution — so the chosen
card's cast cannot reuse those mutations as-is.

## Decision

Split the two roles. Introduce **`actingPlayerId`** alongside `controllerId` on
the cast state (`pendingCast` / `pendingTarget` / `PendingChoice`) and on the
resulting `StackItem`:

- **`controllerId`** — whose spell/resources/zone it is. For a controlled cast
  this is the **opponent** (the controlled player is the caster, CR 601).
  Auto-tap, ownership, and zone reads use it — which makes the oracle's
  "mana only from lands that player controls" fall out for free.
- **`actingPlayerId`** — who is prompted for every choice. For a controlled cast
  this is **Word of Command's controller**. Defaults to `controllerId` when
  absent, so all existing casts are unaffected.

The chosen card runs through the resolve-time suspension machinery
(`PendingChoice`), not the priority-gated mutations. The override rides onto the
resulting `StackItem` so that spell's _resolution_ choices also route to the
acting player, and clears when the item leaves the stack ("you control the
player while that spell is resolving"). `getLegalTargets`, `autoTap`, and the
additional-cost validators are reused unchanged.

## Considered options

- **General "one player controls another" subsystem** (a player-level control
  layer that reroutes _every_ decision the controlled player would make).
  Rejected: large, reusable surface that no other card in scope needs — the only
  decisions occurring during Word of Command's resolution are the playing of the
  chosen card, which `actingPlayerId` covers exactly.
- **Parallel re-entrant cast pipeline** dedicated to controlled casts. Rejected:
  duplicates target/mana/cost validation and drifts from the real cast flow.

## Consequences

- Every site that reads `controllerId` to decide _who is prompted_ must instead
  read `actingPlayerId` (falling back to `controllerId`). The two are equal for
  all normal play, so the risk is a missed site, not a behavior change — covered
  by exhaustive routing tests.
- A `StackItem` can now resolve with its prompts answered by a player other than
  its controller. Card knowledge follows: the acting player looks at the
  controlled player's hand (`knownTo` the acting player).

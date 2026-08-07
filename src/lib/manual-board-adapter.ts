// Manual state → board player view adapter (PRD #2162, ADR 0080).
//
// The shared board surface renders a `Player` (`~/types/game`); a Manual Game
// only ever produces a `ProjectedManualGameState` (`convex/manual.ts`). This
// module is the seam between the two, and it is deliberately thin: ADR 0080
// shaped `ManualCardInstance` as a subset of `CardInstance` on purpose, so a
// projected manual card already satisfies every REQUIRED field of the board's
// card type (`id`, `card`, `controllerId`, `ownerId`, `zone`, `isTapped`) and
// every optional field the two share (`counters`, `attachedTo`) lines up too.
// The manual-only fields (`lane`, `note`, `arrows`, `faceDown`) simply ride
// along — the board's `CardInstance` type doesn't name them, but nothing here
// strips them, so no projection field is lost in the trip.
//
// The one field the board's `Player` requires that Manual Mode has no concept
// of is `manaPool` (ADR 0080 explicitly rules out an inferred mana pool) — an
// empty one is the only invented field this adapter adds.
//
// Pure: no Convex, no React, no DOM.

import type {
    ProjectedManualGameState,
    ProjectedManualPlayer,
} from "@convex/manual";
import { emptyManaPool, type Player } from "~/types/game";

/** Adapts one projected manual seat to the board's player view type. The
 *  opponent's hand is already `null[]` and the library already `{ count }`
 *  courtesy of `projectManualState` (`convex/manual.ts`) — this function does
 *  not re-derive either, it only supplies the field the manual side has none
 *  of. */
export function adaptManualPlayer(player: ProjectedManualPlayer): Player {
    return {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: player.life,
        hand: player.hand,
        library: player.library,
        graveyard: player.graveyard,
        exile: player.exile,
        battlefield: player.battlefield,
        manaPool: emptyManaPool,
    };
}

/** Adapts every seat in a projected manual game state, in roster order. */
export function adaptManualPlayers(state: ProjectedManualGameState): Player[] {
    return state.players.map(adaptManualPlayer);
}

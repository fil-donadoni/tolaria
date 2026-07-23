// City's Blessing designation (Ascend, CR 702.131 — issue #1460).
//
// Ascend grants a player the CITY'S BLESSING, a game-state player designation
// modeled directly on the Monarch precedent (`GameState.monarchId`,
// `becomeMonarch`) — a status a player HOLDS, tracked in game state rather than
// on any object. Two CR-driven differences from the monarch:
//
//   1. NON-EXCLUSIVE. Both players can hold the blessing at once, so storage is
//      a SET (`GameState.cityBlessingIds`), not a single scalar.
//   2. MONOTONIC. "You have the city's blessing for the rest of the game"
//      (CR 702.131b): once obtained it is NEVER lost — dropping below ten
//      permanents does not revoke it. `grantCityBlessing` only ever ADDS; there
//      is deliberately no revoke primitive.
//
// Ascend has two forms (CR 702.131a/c), wired at two different moments:
//
//   * PERMANENT (static ability). "As long as you control ten or more
//     permanents, you have the city's blessing for the rest of the game." A
//     continuous check — `checkAscendCityBlessing` runs in the state-based
//     action sweep (`sba.ts`), so the instant a controller of an Ascend
//     permanent reaches ten permanents they are granted the blessing.
//   * INSTANT / SORCERY. Ascend is part of the spell's resolution: "if you
//     control ten or more permanents, you get the city's blessing." Checked
//     ONCE, on resolution — `finalizeSpellResolution` (`state.ts`) calls
//     `grantCityBlessingIfThreshold` for a resolving non-permanent spell whose
//     card declares the `ascend` keyword.
//
// The threshold count is "permanents you CONTROL" (CR 702.131), so it counts by
// `controllerId` across every battlefield, not by whose battlefield array the
// card sits in.

import type { CardInstanceState, GameState } from "./state";

/** The `staticAbilities[]` keyword string that carries Ascend (Mechanics
 *  Registry id `ascend`, CR 702.131). */
export const ASCEND_KEYWORD = "ascend";

/** CR 702.131 — ten permanents is the threshold for the city's blessing. */
export const CITY_BLESSING_THRESHOLD = 10;

/** True iff `playerId` currently holds the city's blessing (CR 702.131b — once
 *  true, stays true for the rest of the game). */
export function hasCityBlessing(state: GameState, playerId: string): boolean {
    return state.cityBlessingIds?.includes(playerId) ?? false;
}

/** Grants `playerId` the city's blessing (CR 702.131). Idempotent: a player who
 *  already holds it is unchanged, and there is no inverse — the designation is
 *  monotonic (CR 702.131b). Returns true iff this call newly granted it. */
export function grantCityBlessing(state: GameState, playerId: string): boolean {
    if (hasCityBlessing(state, playerId)) return false;
    state.cityBlessingIds = [...(state.cityBlessingIds ?? []), playerId];
    return true;
}

/** CR 702.131 — the number of permanents `playerId` controls, counted by
 *  `controllerId` across every player's battlefield (a control-changed
 *  permanent counts for its current controller). */
export function countControlledPermanents(
    state: GameState,
    playerId: string
): number {
    let count = 0;
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.controllerId === playerId) count++;
        }
    }
    return count;
}

/** Grants the city's blessing to `playerId` iff they control ten or more
 *  permanents (CR 702.131). The shared threshold check behind BOTH Ascend
 *  forms. Returns true iff it newly granted the blessing. */
export function grantCityBlessingIfThreshold(
    state: GameState,
    playerId: string
): boolean {
    if (hasCityBlessing(state, playerId)) return false;
    if (countControlledPermanents(state, playerId) < CITY_BLESSING_THRESHOLD) {
        return false;
    }
    return grantCityBlessing(state, playerId);
}

/** True iff this permanent carries the Ascend keyword (CR 702.131a) — read off
 *  the live instance `staticAbilities` array (so a dynamically granted Ascend
 *  would count too), matching how every other keyword check reads. */
function permanentHasAscend(card: CardInstanceState): boolean {
    return card.staticAbilities.includes(ASCEND_KEYWORD);
}

/** CR 702.131a — the PERMANENT form of Ascend, evaluated continuously. For
 *  every player who controls at least one Ascend permanent AND controls ten or
 *  more permanents, grants the city's blessing (idempotent, never revoked).
 *  Runs inside the SBA sweep (`checkStateBasedActions`). Pure state-mutation,
 *  no events; the grant is a silent designation change, so it does not gate the
 *  SBA fixpoint. */
export function checkAscendCityBlessing(state: GameState): void {
    for (const player of state.players) {
        if (hasCityBlessing(state, player.id)) continue;
        // Does this player control any Ascend permanent? (Scan by controllerId
        // across all battlefields — an Ascend permanent stolen from an opponent
        // grants ITS controller, per "you get the city's blessing".)
        let controlsAscend = false;
        for (const p of state.players) {
            for (const card of p.battlefield) {
                if (
                    card.controllerId === player.id &&
                    permanentHasAscend(card)
                ) {
                    controlsAscend = true;
                    break;
                }
            }
            if (controlsAscend) break;
        }
        if (!controlsAscend) continue;
        grantCityBlessingIfThreshold(state, player.id);
    }
}

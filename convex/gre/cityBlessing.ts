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
// Ascend has two forms (CR 702.131a/b), wired at two different moments:
//
//   * PERMANENT (static ability). "ANY TIME you control ten or more permanents
//     and you don't have the city's blessing, you get the city's blessing for
//     the rest of the game" (CR 702.131b). A static ability is simply true at
//     all times (CR 604.1) — it is NOT a state-based action, so it must NOT be
//     evaluated only in the SBA sweep, which by CR 704.3 runs solely when a
//     player would receive priority. `checkAscendCityBlessing` therefore runs
//     BOTH in the SBA sweep (`sba.ts`, the stable-point backstop) AND eagerly
//     at every site where a player's permanent count can RISE: a permanent
//     spell resolving, a token created, a permanent put onto the battlefield by
//     an effect, a land played, a control change, a phase-in (`state.ts` /
//     `playLand.ts` — grep `checkAscendCityBlessing`). Without the eager calls
//     the blessing arrives one priority-check too late, and an effect creating a
//     permanent and then reads the designation in the same resolution reads a
//     stale `false`:
//         Ocelot Pride — "create a 1/1 white Cat creature token. THEN if you
//         have the city's blessing, for each token you control that entered
//         this turn, create a token that's a copy of it." Gatherer ruling: "If
//         the creature token created by Ocelot Pride's last ability is your
//         tenth permanent, you'll get the city's blessing BEFORE the ability
//         would check to see if you have the city's blessing."
//     The same eagerness is what makes the CR-ruling case work where the tenth
//     permanent enters and immediately leaves (legend rule, 0 toughness): the
//     grant happens at entry, before the SBA sweep removes it.
//   * INSTANT / SORCERY. Ascend is part of the spell's resolution: "if you
//     control ten or more permanents, you get the city's blessing." Checked
//     ONCE, on resolution, and FIRST (CR 702.131a: it is the spell's first
//     spell ability, so the spell's own later clauses observe the blessing it
//     just granted — Golden Demise, Secrets of the Golden City).
//     `resolveTopOfStackInner` (`state.ts`) calls
//     `grantCityBlessingIfThreshold` for a resolving non-permanent spell whose
//     card declares the `ascend` keyword, BEFORE dispatching the spell's
//     Effect Script / `resolve` / `resolveSteps`.
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

/** True iff this permanent carries the Ascend keyword (CR 702.131b) — read off
 *  the live instance `staticAbilities` array (so a dynamically granted Ascend
 *  would count too), matching how every other keyword check reads. */
function permanentHasAscend(card: CardInstanceState): boolean {
    return card.staticAbilities.includes(ASCEND_KEYWORD);
}

/** CR 702.131b — the PERMANENT form of Ascend, evaluated continuously ("any
 *  time you control ten or more permanents"). For every player who controls at
 *  least one Ascend permanent AND controls ten or more permanents, grants the
 *  city's blessing (idempotent, never revoked). Pure state-mutation, no events;
 *  the grant is a silent designation change, so it never gates the SBA
 *  fixpoint.
 *
 *  Called from TWO kinds of site (see the header note):
 *    - the SBA sweep (`checkStateBasedActions`) — the stable-point backstop;
 *    - every battlefield-ENTRY site in `state.ts`, eagerly, because a static
 *      ability is not an SBA (CR 604.1 / 704.3) and the count can only RISE
 *      when a permanent enters.
 *
 *  One O(battlefield) pass: tallies per-controller permanent counts and the set
 *  of controllers holding an Ascend permanent together, so calling it on every
 *  permanent entry stays cheap. */
export function checkAscendCityBlessing(state: GameState): void {
    // Scan by controllerId across ALL battlefields — an Ascend permanent stolen
    // from an opponent grants ITS controller, per "you get the city's blessing"
    // (CR 702.131), and a control-changed permanent counts for its current
    // controller.
    const counts = new Map<string, number>();
    const ascendControllers = new Set<string>();
    for (const p of state.players) {
        for (const card of p.battlefield) {
            counts.set(
                card.controllerId,
                (counts.get(card.controllerId) ?? 0) + 1
            );
            if (permanentHasAscend(card))
                ascendControllers.add(card.controllerId);
        }
    }
    for (const playerId of ascendControllers) {
        if (hasCityBlessing(state, playerId)) continue;
        if ((counts.get(playerId) ?? 0) < CITY_BLESSING_THRESHOLD) continue;
        grantCityBlessing(state, playerId);
    }
}

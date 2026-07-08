// Alternative casting costs — the return-N-lands / sacrifice-N-lands cost
// variants (CR 118.9). An alternative cost is paid INSTEAD of a spell's mana
// cost: the caster opts into one at announcement, its mana cost is zeroed for
// that cast, and the chosen permanents are returned / sacrificed at cast commit
// (CR 601.2h). See `AlternativeCost` in convex/cards/types.ts.
//
// The permanents paid are AUTO-SELECTED from the caster's matching permanents.
// The cards that use these variants name fungible basics (any two Islands,
// any two Mountains), so which specific permanents are chosen is immaterial —
// this follows the project's "auto-resolve a choice with no real option"
// policy. If a future card attaches a per-permanent decision to the cost, this
// is the seam to grow into an interactive picker.
import type { AlternativeCost, CardDefinition } from "../cards/types";
import { matchesPermanentFilter } from "../cards/filters";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { getPlayer, removePermanentTo } from "./state";
import { liveSupertypesOf } from "./snow";
import { STATIC_EFFECT_CTX } from "./layers";
import { tryGetDefinition } from "../cards";

/** The caster's own permanents that satisfy an alternative cost's filter
 *  (CR 118.9 — "permanents you control"). Derived colours are folded in via
 *  `STATIC_EFFECT_CTX.getColors` so a `colors` filter reads the same colour the
 *  rest of the engine sees. */
export function matchingPermanentsForAltCost(
    player: PlayerState,
    altCost: AlternativeCost
): CardInstanceState[] {
    return player.battlefield.filter((c) => {
        const view = { ...c, colors: STATIC_EFFECT_CTX.getColors(c) };
        return matchesPermanentFilter(view, altCost.filter, {
            selfControllerId: player.id,
            supertypesOf: liveSupertypesOf,
        });
    });
}

/** Whether the caster controls enough matching permanents to pay this
 *  alternative cost (CR 118.9). */
export function canPayAlternativeCost(
    state: GameState,
    playerId: string,
    altCost: AlternativeCost
): boolean {
    const player = getPlayer(state, playerId);
    return (
        matchingPermanentsForAltCost(player, altCost).length >= altCost.count
    );
}

/** Look up a card's alternative cost by id, or `undefined` if the card has no
 *  such variant. */
export function getAlternativeCost(
    def: CardDefinition | undefined,
    altCostId: string
): AlternativeCost | undefined {
    return def?.alternativeCosts?.find((a) => a.id === altCostId);
}

/** The alternative costs of a hand card the caster can currently AFFORD
 *  (CR 118.9). Used to keep "cast" legal (and to drive the client cast-option
 *  picker) when the mana cost can't be paid but a land cost can. */
export function affordableAlternativeCosts(
    player: PlayerState,
    card: CardInstanceState
): AlternativeCost[] {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def?.alternativeCosts || def.alternativeCosts.length === 0) return [];
    return def.alternativeCosts.filter(
        (a) => matchingPermanentsForAltCost(player, a).length >= a.count
    );
}

/** Pay an alternative cost at cast commit (CR 601.2h) by auto-selecting the
 *  required number of matching permanents and returning / sacrificing them.
 *  Throws if the caster no longer controls enough matching permanents (the
 *  cost is checked for affordability at announcement, but the world can change
 *  between announcement and commit for a targeted spell). */
export function payAlternativeCost(
    state: GameState,
    playerId: string,
    altCost: AlternativeCost
): void {
    const player = getPlayer(state, playerId);
    const candidates = matchingPermanentsForAltCost(player, altCost);
    if (candidates.length < altCost.count) {
        throw new Error(
            "Can't pay the alternative cost (not enough permanents)"
        );
    }
    // Auto-select the first N matching permanents (fungible — the choice is
    // immaterial for the basics these cards name; CR 118.9).
    const chosen = candidates.slice(0, altCost.count);
    for (const perm of chosen) {
        if (altCost.action === "return") {
            // CR 701.24 — return to owner's hand (a bounce, not a sacrifice).
            removePermanentTo(state, perm.id, "hand");
        } else {
            // CR 701.16 — sacrifice to the graveyard.
            removePermanentTo(state, perm.id, "graveyard", "sacrifice");
        }
    }
}

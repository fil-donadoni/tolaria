// Alternative casting costs — the return-N-lands / sacrifice-N-lands cost
// variants (CR 118.9). An alternative cost is paid INSTEAD of a spell's mana
// cost: the caster opts into one at announcement, its mana cost is zeroed for
// that cast, and the chosen permanents are returned / sacrificed at cast commit
// (CR 601.2h). See `AlternativeCost` in convex/cards/types.ts.
//
// WHICH permanents pay the cost is the player's choice (CR 118.9 — "return two
// Islands you control", "sacrifice two Mountains"): the cost is built as a
// `SacrificeSelection` and routed through the one unified choice layer
// (`sacrificeChoice.ts`), exactly like every other filtered sacrifice/return.
// `autoResolveFungible` collapses it inline only when the choice isn't real
// (the caster controls exactly the required count, or the candidates are
// indistinguishable); otherwise it parks for an explicit pick. This module NEVER
// silently slices the first N — that seam was the bug (#983 follow-up).
import type { AlternativeCost, CardDefinition } from "../cards/types";
import { matchesPermanentFilter } from "../cards/filters";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { getPlayer } from "./state";
import { liveSupertypesOf } from "./snow";
import { STATIC_EFFECT_CTX } from "./layers";
import { tryGetDefinition } from "../cards";
import type { SacrificeSelection } from "./sacrificeChoice";
import { autoResolveFungible } from "./sacrificeChoice";

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

/** Build the player-chosen permanent-cost selection for an alternative cost at
 *  cast commit (CR 601.2h / 118.9). The single requirement is the alt cost's
 *  filter × count, tagged with its terminal `action` (return → hand /
 *  sacrifice → graveyard). `autoResolveFungible` pre-fills the picks when the
 *  choice isn't real; otherwise the returned selection is incomplete and the
 *  caller parks the cast until the player picks (via `selectSacrifice`).
 *  Affordability is validated at announcement and re-checked by the caller. */
export function buildAlternativeCostChoice(
    state: GameState,
    playerId: string,
    altCost: AlternativeCost,
    reason: string
): SacrificeSelection {
    const selection: SacrificeSelection = {
        playerId,
        reason,
        requirements: [{ filter: altCost.filter, count: altCost.count }],
        picked: [],
        action: altCost.action === "return" ? "return" : "sacrifice",
    };
    autoResolveFungible(state, selection);
    return selection;
}

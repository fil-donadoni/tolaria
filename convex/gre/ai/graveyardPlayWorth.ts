// What a graveyard play permission UNLOCKS on a board (issue #10401).
//
// "Until end of turn, you may play lands and cast spells from your graveyard"
// (CR 601.3: a player may cast a spell only if a rule or effect allows it) is
// worth what the graveyard holds and what the turn's mana can still pay for.
// A flat price reads an empty graveyard and one holding the whole game's
// spells as the same card, so the permission was held or spent on noise.
//
// The reading is the permission's own turn, nothing later: the cards its
// holder could play before it lapses at cleanup (CR 514.2), each at the
// latent worth a card in hand carries. Per-card-agnostic (ADR 0102).

import type { GraveyardPlayAction } from "../../cards/types";
import { getInstanceManaCost, tryGetDefinition } from "../../cards";
import { canPayAlternativeCost } from "../alternativeCost";
import { LAND_DROPS_PER_TURN, isLand, manaValue } from "../constants";
import { canPayCost, manaCensusFor } from "../manaAvailability";
import type { CardInstanceState, GameState, PlayerState } from "../state";

/** The grant a `grantGraveyardPlay` Op states: which actions, and the mana
 *  value its cast half stops at. Omitted actions are both. */
export type GraveyardPlayGrant = {
    actions?: readonly GraveyardPlayAction[];
    maxManaValue?: number;
};

/** What casting `card` out of the graveyard takes from the turn's mana:
 *  nothing when one of its own alternative costs asks for no mana and is
 *  payable now (CR 118.9 — Fireblast's two Mountains), its mana value when
 *  `units` pay its mana cost, `undefined` when neither does. An {X} is read
 *  at 1 per symbol, the least a cast for value announces. */
function castPrice(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    units: ReturnType<typeof manaCensusFor>["now"]
): number | undefined {
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    const free = (def?.alternativeCosts ?? []).some(
        (alt) =>
            manaValue(alt.mana) === 0 &&
            canPayAlternativeCost(state, player.id, alt, card.id)
    );
    if (free) return 0;
    const cost = getInstanceManaCost(card);
    // CR 118.6 — a card with no mana cost has a cost that cannot be paid.
    if (!cost) return undefined;
    return canPayCost(units, cost, { life: player.life })
        ? manaValue(cost)
        : undefined;
}

/** The latent worth, in points, of the cards `player` could play out of its
 *  own graveyard this turn under `grant`.
 *
 *  The mana is what the player can make now, less what the card carrying the
 *  grant still costs (`grantingCard`, absent once it is paid for). Spells are
 *  taken best-first while the mana left covers them, each priced by
 *  `castPrice`; a land joins while the turn's land drop is open (CR 305.2).
 *  Coarse by design: one mana budget counted in units, colours checked per
 *  card against the whole census, an extra land drop not added, and a land an
 *  alternative cost sacrifices not taken off the budget.
 *  `worthOf` is the caller's price of one graveyard card. */
export function graveyardPlayUnlockWorth(
    state: GameState,
    player: PlayerState,
    grant: GraveyardPlayGrant,
    grantingCard: CardInstanceState | undefined,
    worthOf: (card: CardInstanceState) => number
): number {
    const actions = grant.actions ?? ["play-land", "cast"];
    const units = manaCensusFor(state, player).now;
    let budget = Math.max(
        0,
        units.length -
            manaValue(
                grantingCard ? getInstanceManaCost(grantingCard) : undefined
            )
    );
    let worth = 0;
    if (actions.includes("cast")) {
        const castable: { price: number; worth: number }[] = [];
        const cardList = player.graveyard;
        for (let i = 0; i < cardList.length; i++) {
            const card = cardList[i];
            if (isLand(card)) continue;
            if (
                grant.maxManaValue !== undefined &&
                manaValue(getInstanceManaCost(card)) > grant.maxManaValue
            ) {
                continue;
            }
            const price = castPrice(state, player, card, units);
            if (price === undefined) continue;
            castable.push({ price, worth: worthOf(card) });
        }
        castable.sort((a, b) => b.worth - a.worth || a.price - b.price);
        for (let i = 0; i < castable.length; i++) {
            const spell = castable[i];
            if (spell.price > budget) continue;
            budget -= spell.price;
            worth += spell.worth;
        }
    }
    if (
        actions.includes("play-land") &&
        (player.landsPlayedThisTurn ?? 0) < LAND_DROPS_PER_TURN
    ) {
        let bestLand = 0;
        const cardList = player.graveyard;
        for (let i = 0; i < cardList.length; i++) {
            const card = cardList[i];
            if (isLand(card)) bestLand = Math.max(bestLand, worthOf(card));
        }
        worth += bestLand;
    }
    return worth;
}

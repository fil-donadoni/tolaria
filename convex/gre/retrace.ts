// Retrace (CR 702.81) — a keyword-cast capability that lets a card be cast from
// its owner's graveyard for its NORMAL cost plus one ADDITIONAL cost: discard a
// land card.
//
// 702.81a Retrace is a static ability that functions while the card with
//         retrace is in a player's graveyard. "Retrace" means "You may cast
//         this card from your graveyard by discarding a land card as an
//         additional cost to cast it." Casting a spell using its retrace
//         ability follows the rules for paying additional costs in rules 601.2b
//         and 601.2f–h.
//
// That single subrule is the whole keyword, and three things follow from it
// that separate retrace from the other graveyard-cast mechanisms already in the
// engine:
//
//   1. **ADDITIONAL, not alternative.** The spell's own mana cost is still paid
//      in full (contrast Escape, CR 702.138a, and Flashback, CR 702.34a, which
//      both REPLACE the mana cost). So there is no `castRawManaCost` override
//      for retrace — the printed cost is already right.
//   2. **No exile on resolution.** CR 702.81a says nothing about exiling, so a
//      retraced spell resolves and goes wherever it normally would (CR 608.2m /
//      608.3 — a permanent card becomes a permanent, an instant/sorcery card
//      goes to its owner's graveyard). This is the key divergence from
//      Flashback, whose CR 702.34a explicitly exiles: `graveyardCastStackFlags`
//      (convex/game.ts) must NOT set `exileOnResolve` for a retrace cast.
//   3. **The additional cost is a HAND cost with a filter**, which is exactly
//      the shipped `CostLegs.hand` vocabulary (ADR 0079, issue #1933):
//      `{ action: "discard", requirements: [{ filter: { type: "Land" }, count: 1 }] }`.
//      It is paid at commit through the cast's `alternativeCostHandChoice`
//      picker like every other hand-leg cost, so no new payment machinery
//      exists here.
//
// Retrace is engine/cost-system infrastructure, NOT an Effect Script Op — a
// card's on-resolution effect stays DSL; only the CAST permission and the
// additional cost live here.
import type { CardDefinition, CostLegs } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { canPayHandCost } from "./alternativeCost";
import { isLand, PERMANENT_TYPES } from "./constants";
import type { CardInstanceState, GameState, PlayerState } from "./state";

/** CR 702.81a — the retrace additional cost, as the shared `CostLegs` hand leg
 *  every other filtered give-up-from-hand cost already uses (ADR 0079). One
 *  land card, discarded (not exiled): the discard goes to the graveyard the
 *  ordinary way, so it can itself feed a later retrace. */
export const RETRACE_COST_LEGS: CostLegs = {
    hand: {
        action: "discard",
        requirements: [{ filter: { type: "Land" }, count: 1 }],
    },
};

function definitionOf(card: CardInstanceState): CardDefinition | undefined {
    const id = (card.card as { id?: string }).id;
    return id ? tryGetDefinition(id) : undefined;
}

/** CR 702.81a — retrace PRINTED on `card`'s definition. No card in the current
 *  pool prints retrace (Six grants it), but the printed half is what the
 *  keyword itself means, and the grant below is defined in terms of it. */
export function hasPrintedRetrace(card: CardInstanceState): boolean {
    return definitionOf(card)?.retrace === true;
}

/** CR 702.81 — retrace GRANTED to `card` by a permanent on the battlefield of
 *  the player whose graveyard it sits in (Six: "During your turn, nonland
 *  permanent cards in your graveyard have retrace").
 *
 *  A grant carries its granting card's own printed restrictions:
 *  `permanentCardsOnly` (Six's "permanent cards") and
 *  `duringControllerTurnOnly` (Six's "During your turn" — the grant is simply
 *  absent on the opponent's turn, so nothing downstream has to re-derive a turn
 *  gate). Lands NEVER receive the grant: every printed granter says "nonland",
 *  and a land in the graveyard is reached by the play-lands-from-graveyard
 *  permission instead (CR 305.1-analog), never by a cast. */
export function hasGrantedRetrace(
    state: GameState,
    card: CardInstanceState
): boolean {
    if (isLand(card)) return false; // "NONLAND ... cards"
    const owner = state.players.find((p) => p.id === card.ownerId);
    if (!owner) return false;
    const isPermanentCard = card.types.some((t) =>
        (PERMANENT_TYPES as readonly string[]).includes(t)
    );
    for (const perm of owner.battlefield) {
        const grant = definitionOf(perm)?.grantsRetraceToOwnGraveyard;
        if (!grant) continue;
        if (grant.permanentCardsOnly && !isPermanentCard) continue;
        // "During YOUR turn" — the granting permanent's controller must be the
        // active player. The grant reaches only its own controller's graveyard,
        // so `owner.id` is that controller.
        if (grant.duringControllerTurnOnly && state.activePlayerId !== owner.id)
            continue;
        return true;
    }
    return false;
}

/** True iff `card` currently has retrace (printed or granted), CR 702.81a. */
export function hasRetrace(state: GameState, card: CardInstanceState): boolean {
    return hasPrintedRetrace(card) || hasGrantedRetrace(state, card);
}

/** CR 702.81a — the card in `player`'s graveyard with `instanceId` that can be
 *  cast via retrace right now, or undefined. Only the graveyard zone is a legal
 *  retrace source. */
export function findRetraceCastable(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return hasRetrace(state, card) ? card : undefined;
}

/** CR 702.81a / 601.2f — whether `player` can actually pay the retrace
 *  additional cost right now: at least one LAND card in hand other than the
 *  card being cast (which is in the graveyard anyway, so the exclusion is
 *  defence in depth). Gates the `cast` action in `getLegalActions`, exactly as
 *  `hasPayableFlashbackAdditionalCost` gates a flashback cast. */
export function canPayRetraceDiscard(
    player: PlayerState,
    castInstanceId: string
): boolean {
    return canPayHandCost(player, RETRACE_COST_LEGS, castInstanceId);
}

// Jump-start (CR 702.133) — a keyword-cast capability that lets an instant or
// sorcery card be cast from its owner's graveyard for its NORMAL cost plus one
// ADDITIONAL cost, discarding a card, and exiles it whenever it leaves the stack.
//
// CR 702.133a is the whole keyword (the section has no second subrule). Its two
// static abilities are the two halves of this module:
//
//   1. **The graveyard half: an ADDITIONAL cost, not an alternative one.** The
//      spell's own mana cost is still paid, so there is no `castRawManaCost`
//      branch. The discard is the shared `CostLegs` hand leg, paid through the
//      cast's one `alternativeCostHandChoice` picker (ADR 0079).
//   2. **The stack half: exile "any time it would leave the stack".** Not just
//      on resolution: a countered, fizzled, or bounced jump-start spell is
//      exiled too. That is the `exileAnyTimeLeavesStack` stack flag, stamped at
//      commit only when `locateCastSource` says jump-start licensed this cast.
//      A jump-start card cast under another permission (Yawgmoth's Will) paid
//      no discard and owes no exile, so the keyword alone does not decide it.
//
// Jump-start is engine/cost-system infrastructure, NOT an Effect Script Op: a
// card's on-resolution effect stays DSL; only the cast permission, the
// additional cost and the stack flag live here.
import type { CostLegs } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { canPayHandCost } from "./alternativeCost";
import type { CardInstanceState, PlayerState } from "./state/declarations";

/** CR 702.133a — the additional cost: discard one card, of any kind. */
export const JUMP_START_COST_LEGS: CostLegs = {
    hand: {
        action: "discard",
        requirements: [{ filter: {}, count: 1 }],
    },
};

/** The keyword string a card prints in `staticAbilities[]` to have jump-start.
 *  Matches the Mechanics Registry row `jump-start`. */
export const JUMP_START_KEYWORD = "jump-start";

/** True iff `card` has jump-start in a form that can license a cast.
 *
 *  CR 702.133a — only "if the resulting spell is an instant or sorcery spell".
 *
 *  DOCUMENTED DEVIATION: every graveyard chain asks retrace first, so a card
 *  that ALSO has retrace (a printed jump-start card under Wrenn and Six's emblem)
 *  is cast under retrace, never jump-start. By the rules the caster picks, but
 *  cast mechanisms here are a fixed precedence with no picker. Retrace wins
 *  because it does not exile the card; the cost is that such a card cannot be
 *  cast with no land in hand. */
export function hasJumpStart(card: CardInstanceState): boolean {
    const types = card.types as readonly string[];
    if (!types.includes("Instant") && !types.includes("Sorcery")) return false;
    return (
        card.staticAbilities?.includes(JUMP_START_KEYWORD) === true ||
        tryGetDefinition(
            (card.card as { id?: string }).id ?? ""
        )?.staticAbilities?.includes(JUMP_START_KEYWORD) === true
    );
}

/** CR 702.133a — the card in `player`'s graveyard with `instanceId` that can be
 *  cast via jump-start right now, or undefined. */
export function findJumpStartCastable(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return hasJumpStart(card) ? card : undefined;
}

/** CR 702.133a / 601.2f — whether `player` holds a card to discard. Gates the
 *  `cast` action in `getLegalActions`, the way `canPayRetraceDiscard` does. */
export function canPayJumpStartDiscard(
    player: PlayerState,
    castInstanceId: string
): boolean {
    return canPayHandCost(player, JUMP_START_COST_LEGS, castInstanceId);
}

// Plot (CR 702.170) — the plot special action and the plotted designation.
//
// 702.170a "Plot [cost]" means "Any time you have priority during your main
//          phase while the stack is empty, you may exile this card from your
//          hand and pay [cost]. It becomes a plotted card."
// 702.170b Exiling a card using its plot ability is a special action, which
//          doesn't use the stack. See rule 116.
// 702.170c In addition to the plot special action, some spells and abilities
//          cause a card in exile to become plotted.
// 702.170d A plotted card's owner may cast it from exile without paying its
//          mana cost during their main phase while the stack is empty during
//          any turn after the turn in which it became plotted. Casting a spell
//          this way follows the rules for paying alternative costs in rules
//          601.2b and 601.2f-h. A plotted card may be cast this way even if it
//          doesn't have the plot ability while in exile.
// 702.170e If an effect refers to plotting a card, it means performing the
//          special action associated with a plot ability.
// 702.170f An effect may allow the plot ability of a card to function in a
//          zone other than a player's hand. In that case, the card is exiled
//          from the zone it is in as the action is taken rather than from its
//          owner's hand.
//
// Two halves, two homes, mirroring Warp (`gre/warp.ts`):
//   1. The SPECIAL ACTION (702.170a/b, CR 116.2k) is this module: the cost is
//      `CardDefinition.plot`, legality is {@link canPlot}, the commit is
//      {@link applyPlot} (the `plotCard` mutation, `convex/game.ts`) and
//      {@link plotInSearch} (the Bot's sandboxes). Like the morph turn-up the
//      cost is auto-tapped and paid in the one call that takes the action.
//   2. The PLOTTED designation (702.170c/d) is {@link becomePlotted}: a marker
//      on the exiled card plus the GENERAL cast-from-exile record every exile
//      cast already reads — `castableFromExileBy` (the owner),
//      `castableFromExileFromTurn` (the lower turn bound Warp introduced: "any
//      turn AFTER the turn in which it became plotted"),
//      `castFromExileWithoutPayingManaCost` (the alternative-cost waiver, CR
//      118.9) and `castableFromExileSorceryTiming` ("during their main phase
//      while the stack is empty"). The record is independent of the plot
//      ability, which is what 702.170c and 702.170d's last sentence require,
//      and it is the same "exiled now, cast later" record Foretell (CR
//      702.143) and Suspend need: they stamp their own riders onto it rather
//      than growing a second permission store.
//
// KNOWN BOUNDARY: the exile-cast record is ONE slot per card, so the plotted
// permission and another effect's exile grant overwrite each other where the
// CR has them coexist (`becomePlotted` drops a prior grant; a later grant
// replaces the plot window while `plotted` stays set). No shipped card reaches
// either. tracked-by: #7586
//
// 702.170e/f need no code: no shipped card refers to plotting, and no effect
// lets plot function outside the hand. The action reads the hand only.
import { tryGetDefinition } from "../cards";
import type { ManaCost } from "../cards/types";
import type { AutoTapPlan } from "./autoTap";
import { isSorceryTimingFor } from "./phases";
import { checkStateBasedActionsAfterSpecialAction } from "./sba";
import {
    paySpecialActionManaCost,
    specialActionPaymentPlan,
} from "./specialActionPayment";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { emitCardsExiled, getPlayer, moveCard } from "./state";

/** CR 702.170a — the plot cost of `card`, read off its definition, or
 *  `undefined` for a card without plot. */
export function getPlotCost(card: CardInstanceState): ManaCost | undefined {
    return tryGetDefinition((card.card as { id?: string }).id ?? "")?.plot;
}

/** The auto-tap plan that pays `card`'s plot cost, or `null` when it cannot be
 *  paid. Shared by {@link canPlot} and {@link applyPlot} so "the action is
 *  offered" and "the payment succeeds" are one decision. */
export function plotPaymentPlan(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): AutoTapPlan | null {
    const cost = getPlotCost(card);
    if (!cost) return null;
    return specialActionPaymentPlan(state, player, cost);
}

/** CR 702.170a / 116.2k — true iff `player` may plot `card` right now: a card
 *  with plot in their own hand, while they hold priority during a main phase
 *  of their own turn with the stack empty (exactly the sorcery window, CR
 *  117.1a), outside any pending payment or choice, with the cost affordable.
 *
 *  Single source of truth for the Bot enumerator (`moves.ts`), the wire
 *  affordance (`canPlot` on the hand card, `gameProjections.ts`) and the
 *  `plotCard` mutation. */
export function canPlot(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    if (!isSorceryTimingFor(state, player.id)) return false;
    if (!player.hand.some((c) => c.id === card.id)) return false;
    if (
        state.pendingCast ||
        state.pendingActivation ||
        state.pendingCompanionPay ||
        state.pendingTarget ||
        (state.pendingChoices && state.pendingChoices.length > 0)
    ) {
        return false;
    }
    return plotPaymentPlan(state, player, card) !== null;
}

/** Every card in `player`'s hand they may plot right now (CR 702.170a). */
export function plottableHandCards(
    state: GameState,
    player: PlayerState
): CardInstanceState[] {
    return player.hand.filter((c) => canPlot(state, player, c));
}

/** CR 702.170c/d — `card`, already in exile, becomes plotted: the designation
 *  plus the owner's cast permission it carries. The permission REPLACES any
 *  grant the card had (a new window, not a second one), so every upper bound
 *  and rider of the old window is dropped. Exiled face up (CR 406.3): the
 *  designation is public. */
export function becomePlotted(state: GameState, card: CardInstanceState): void {
    card.plotted = true;
    // CR 702.170d — "a plotted card's OWNER may cast it".
    card.castableFromExileBy = card.ownerId;
    // CR 702.170d — "during any turn AFTER the turn in which it became plotted".
    card.castableFromExileFromTurn = state.turn + 1;
    // CR 702.170d / 118.9 — "without paying its mana cost", an alternative
    // cost: additional costs and cost increases still apply.
    card.castFromExileWithoutPayingManaCost = true;
    // CR 702.170d — "during their main phase while the stack is empty".
    card.castableFromExileSorceryTiming = true;
    delete card.castableFromExileUntilTurn;
    delete card.castableFromExileUntilOwnTurn;
    delete card.castableFromExileUntilOwnUpkeep;
    delete card.castableFromExileIncludesLand;
    delete card.castFromExileManaSubstitution;
    delete card.castFromExileCostIncrease;
    delete card.castableFromExileCondition;
    delete card.castFromExileNotAsAdventure;
    delete card.faceDown;
    delete card.faceDownBy;
}

/** The hand → exile move and the designation, shared by the real commit and
 *  the search sandbox. Returns the exiled card. */
function exileAsPlotted(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): CardInstanceState {
    const exiled = moveCard(player, cardInstanceId, "hand", "exile");
    becomePlotted(state, exiled);
    // CR 603.2 — "whenever one or more cards are put into exile" watchers see
    // the plot exile like any other.
    emitCardsExiled(state, [
        {
            cardInstanceId: exiled.id,
            cardId: (exiled.card as { id?: string }).id,
            fromZone: "hand",
            ownerId: exiled.ownerId,
        },
    ]);
    return exiled;
}

/** The whole CR 116.2k / 702.170a special action as a PURE state transition:
 *  re-check legality, pay the plot cost, exile the card as plotted, restart
 *  the pass cycle and keep priority with the actor (CR 116.3). Throws on every
 *  illegal input; the `plotCard` mutation adds only auth, the clone and the
 *  save. */
export function applyPlot(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): void {
    const player = getPlayer(state, playerId);
    const card = player.hand.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not found in hand");
    if (!canPlot(state, player, card)) {
        throw new Error("Can't plot that card right now");
    }
    const plan = plotPaymentPlan(state, player, card);
    const cost = getPlotCost(card);
    if (plan === null || cost === undefined) {
        throw new Error("Can't afford the plot cost");
    }
    paySpecialActionManaCost(state, player, cost, plan);
    exileAsPlotted(state, player, cardInstanceId);
    checkStateBasedActionsAfterSpecialAction(state, playerId);
}

/** CR 116.2k — the plot special action inside a search sandbox. The coarse
 *  mana model every sandboxed special action uses (`turnFaceUpInSearch`,
 *  `gre/applyMove.ts`): taps the planned sources without draining the pool —
 *  legality and affordability were established by {@link canPlot} at
 *  enumeration time. The caller owns the priority bookkeeping. */
export function plotInSearch(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): void {
    const card = player.hand.find((c) => c.id === cardInstanceId);
    if (!card) return;
    const plan = plotPaymentPlan(state, player, card);
    if (plan) {
        const tapped = new Set(plan.map((step) => step.cardId));
        for (const src of player.battlefield) {
            if (tapped.has(src.id)) src.isTapped = true;
        }
    }
    exileAsPlotted(state, player, cardInstanceId);
}

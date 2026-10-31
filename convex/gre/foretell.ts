// Foretell (CR 702.143) — the foretell special action and the foretold
// designation.
//
// 702.143a Foretell is a keyword that functions while the card with foretell
//          is in a player's hand. Any time a player has priority during their
//          turn, that player may pay {2} and exile a card with foretell from
//          their hand face down. That player may look at that card as long as
//          it remains in exile. They may cast that card after the current turn
//          has ended by paying any foretell cost it has rather than paying that
//          spell's mana cost. Casting a spell this way follows the rules for
//          paying alternative costs in rules 601.2b and 601.2f–h.
// 702.143b Exiling a card using its foretell ability is a special action,
//          which doesn't use the stack. See rule 116, "Special Actions."
// 702.143c If an effect refers to foretelling a card, it means performing the
//          special action associated with a foretell ability. If an effect
//          refers to a card or spell that was foretold, it means a card put in
//          the exile zone as a result of the special action associated with a
//          foretell ability, or a spell that was a foretold card before it was
//          cast, even if it was cast for a cost other than a foretell cost.
// 702.143d If an effect states that a card in exile becomes foretold, that
//          card becomes a foretold card. That effect may give the card a
//          foretell cost. That card's owner may look at that card as long as it
//          remains in exile and it may be cast for any foretell cost it has
//          after the turn it became a foretold card has ended, even if the
//          resulting spell doesn't have foretell.
// 702.143e If a player owns multiple foretold cards in exile, they must ensure
//          that those cards can be easily differentiated from each other and
//          from any other face-down cards in exile which that player owns. This
//          includes knowing both the order in which those cards were put into
//          exile and any foretell costs other than their printed foretell costs
//          those cards may have.
// 702.143f If a player leaves the game, all face-down foretold cards that
//          player owns must be revealed to all players. At the end of each
//          game, all face-down foretold cards must be revealed to all players.
//
// Two halves, mirroring Plot (`gre/plot.ts`):
//   1. The SPECIAL ACTION (702.143a/b, CR 116.2h) is this module: the cost is
//      the rule's fixed {2} ({@link FORETELL_ACTION_COST}), legality is
//      {@link canForetell} — any priority of the player's OWN turn, stack
//      empty or not, no main-phase restriction (contrast plot, CR 116.2k) —
//      the commit is {@link applyForetell} (the `foretellCard` mutation,
//      `convex/game.ts`) and {@link foretellInSearch} (the Bot's sandboxes).
//      The {2} is paid BEFORE the card leaves the hand: it is a cost of the
//      action, and an unpayable cost leaves the card where it was.
//   2. The FORETOLD designation (702.143a/c/d) is {@link makeForetold}: the
//      marker plus the owner's cast permission on the GENERAL exile-cast record
//      every exile cast already reads — `castableFromExileBy` (the owner) and
//      the lower turn bound `castableFromExileFromTurn` ("after the current
//      turn has ended": every later turn, the opponent's included). No upper
//      bound and no timing rider: the cast follows the card's own timing (a
//      foretold instant is held up through the opponent's turn). The cost is
//      the card's foretell cost, substituted at the one cast-cost chokepoint
//      (`castRawManaCost`, `gre/castCost.ts`) and probed by `getLegalActions`
//      (`gre/rules.ts`).
//
// 702.143c on the STACK: the Cast Commit kernel (`gre/castCommit.ts`) and the
// search kernel (`commitCastInSearch`, `gre/applyMove.ts`) read the card's
// `foretold` before it leaves exile and stamp it on the stack item, whatever
// cost the cast paid.
//
// 702.143e: every foretold card is its own exile instance, in exile order,
// with its own `grantedForetellCost`; the owner's projection shows each
// (`knownTo`), and the `foretold` marker is public on the wire.
// 702.143f: a player leaving the game ends a two-player game, so the
// end-of-game reveal covers both sentences here.
// 702.143f: `endGame` (`gre/state.ts`, `revealForetoldCards`) widens `knownTo`
// to every player on each foretold card still in exile.
//
// KNOWN BOUNDARY: the exile-cast record is ONE slot per card (see `plot.ts`);
// `makeForetold` replaces any prior grant, and a later unrelated grant would
// replace the foretell window while `foretold` stays set. No shipped card
// reaches either. tracked-by: #7586
import { tryGetDefinition } from "../cards";
import type { ManaCost } from "../cards/types";
import type { AutoTapPlan } from "./autoTap";
import { computeExpectedInput } from "./expectedInput";
import { checkStateBasedActionsAfterSpecialAction } from "./sba";
import {
    paySpecialActionManaCost,
    specialActionPaymentPlan,
} from "./specialActionPayment";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { emitCardsExiled, exileFaceDownCard, getPlayer } from "./state";

/** CR 702.143a — the cost of the foretell special action: always {2},
 *  whatever the card. */
export const FORETELL_ACTION_COST: ManaCost = { X: 2 };

/** CR 702.143a — `card` has foretell: its definition prints a foretell cost.
 *  The keyword functions while the card is in its owner's hand. */
export function hasForetell(card: CardInstanceState): boolean {
    return (
        tryGetDefinition((card.card as { id?: string }).id ?? "")?.foretell !==
        undefined
    );
}

/** CR 702.143a/d — the foretell cost a foretold `card` is cast for: the one an
 *  effect gave it (CR 702.143d) or else the one printed on it, `undefined`
 *  when it has none (a foretold card with no foretell cost has no foretell
 *  cast). */
export function getForetellCost(card: CardInstanceState): ManaCost | undefined {
    return (
        card.grantedForetellCost ??
        tryGetDefinition((card.card as { id?: string }).id ?? "")?.foretell
    );
}

/** True iff `card` is a FORETOLD card in exile whose foretell cast is the one
 *  its exile permission licenses: the designation, a foretell cost to pay,
 *  and no free-cast waiver on the same record (a waiver wins, CR 118.9 —
 *  "no cost" is stronger than any alternative cost). Shared by
 *  `castRawManaCost` and `getLegalActions` so the price the gate probes and
 *  the price the commit charges are one decision. */
export function isForetellCast(card: CardInstanceState): boolean {
    return (
        card.foretold === true &&
        card.castFromExileWithoutPayingManaCost !== true &&
        getForetellCost(card) !== undefined
    );
}

/** The auto-tap plan that pays the {2}, or `null` when it cannot be paid.
 *  Shared by {@link canForetell} and {@link applyForetell}. */
export function foretellPaymentPlan(
    state: GameState,
    player: PlayerState
): AutoTapPlan | null {
    return specialActionPaymentPlan(state, player, FORETELL_ACTION_COST);
}

/** CR 702.143a / 116.2h — true iff `player` may foretell `card` right now: a
 *  card with foretell in their own hand, while they hold priority during
 *  THEIR OWN turn — any step, stack empty or not — outside any pending payment
 *  or choice, with {2} affordable.
 *
 *  Single source of truth for the Bot enumerator (`moves.ts`), the wire
 *  affordance (`canForetell` on the hand card, `gameProjections.ts`) and the
 *  `foretellCard` mutation. */
export function canForetell(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    if (state.gameOver || state.phase === "MULLIGAN") return false;
    if (state.priorityPlayerId !== player.id) return false;
    // CR 702.143a — "during their turn". Not a sorcery window: no phase and
    // no empty-stack requirement.
    if (state.activePlayerId !== player.id) return false;
    if (!player.hand.some((c) => c.id === card.id)) return false;
    if (!hasForetell(card)) return false;
    if (
        state.pendingCast ||
        state.pendingActivation ||
        state.pendingCompanionPay ||
        state.pendingTarget ||
        (state.pendingChoices && state.pendingChoices.length > 0)
    ) {
        return false;
    }
    if (computeExpectedInput(state)?.kind !== "priority") return false;
    return foretellPaymentPlan(state, player) !== null;
}

/** Every card in `player`'s hand they may foretell right now (CR 702.143a). */
export function foretellableHandCards(
    state: GameState,
    player: PlayerState
): CardInstanceState[] {
    return player.hand.filter((c) => canForetell(state, player, c));
}

/** CR 702.143a/c/d — `card`, already in exile, becomes foretold: the
 *  designation plus its owner's cast permission. The permission REPLACES any
 *  grant the card had (a new window, not a second one), so every bound and
 *  rider of the old window is dropped. `opts.foretellCost` is the foretell
 *  cost an effect gives the card (CR 702.143d); the special action passes
 *  none, so the printed cost applies.
 *
 *  The seam a future "becomes foretold" effect calls. */
export function makeForetold(
    state: GameState,
    card: CardInstanceState,
    opts?: { foretellCost?: ManaCost }
): void {
    card.foretold = true;
    if (opts?.foretellCost !== undefined) {
        card.grantedForetellCost = opts.foretellCost;
    } else {
        delete card.grantedForetellCost;
    }
    // CR 702.143a — "THEY may cast that card": the player who foretold it,
    // its owner (the card came from their hand).
    card.castableFromExileBy = card.ownerId;
    // CR 702.143a — "after the current turn has ended": any later turn.
    card.castableFromExileFromTurn = state.turn + 1;
    delete card.castableFromExileUntilTurn;
    delete card.castableFromExileUntilOwnTurn;
    delete card.castableFromExileUntilOwnUpkeep;
    delete card.castableFromExileIncludesLand;
    delete card.castableFromExileSorceryTiming;
    delete card.castFromExileWithoutPayingManaCost;
    delete card.castFromExileManaSubstitution;
    delete card.castFromExileCostIncrease;
    delete card.castableFromExileCondition;
    delete card.castFromExileNotAsAdventure;
    // Other mechanics' exile-cast riders: each would otherwise win the
    // price at `castRawManaCost` (madness) or mislabel the card.
    delete card.plotted;
    delete card.warpExiled;
    delete card.madnessExiled;
}

/** The hand → face-down exile move and the designation, shared by the real
 *  commit and the search sandbox. */
function exileAsForetold(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): void {
    // CR 702.143a — "exile a card with foretell from their hand face down.
    // That player may look at that card as long as it remains in exile."
    const exiled = exileFaceDownCard(
        player,
        cardInstanceId,
        "hand",
        player.id,
        "face-down-exile"
    );
    if (!exiled) throw new Error("Card not found in hand");
    makeForetold(state, exiled);
    // CR 603.2 — "whenever one or more cards are put into exile" watchers see
    // the foretell exile like any other.
    emitCardsExiled(state, [
        {
            cardInstanceId: exiled.id,
            cardId: (exiled.card as { id?: string }).id,
            fromZone: "hand",
            ownerId: exiled.ownerId,
        },
    ]);
}

/** The whole CR 116.2h / 702.143a special action as a PURE state transition:
 *  re-check legality, pay {2}, THEN exile the card face down as foretold,
 *  restart the pass cycle and keep priority with the actor (CR 116.3). Throws
 *  on every illegal input; the `foretellCard` mutation adds only auth, the
 *  clone and the save. */
export function applyForetell(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): void {
    const player = getPlayer(state, playerId);
    const card = player.hand.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not found in hand");
    if (!canForetell(state, player, card)) {
        throw new Error("Can't foretell that card right now");
    }
    const plan = foretellPaymentPlan(state, player);
    if (plan === null) throw new Error("Can't afford the foretell cost");
    // CR 702.143a / 601.2h-analog — the {2} is a cost of the action: paid
    // first, and the card leaves the hand only once it is paid.
    paySpecialActionManaCost(state, player, FORETELL_ACTION_COST, plan);
    exileAsForetold(state, player, cardInstanceId);
    checkStateBasedActionsAfterSpecialAction(state, playerId);
}

/** CR 116.2h — the foretell special action inside a search sandbox. The
 *  coarse mana model every sandboxed special action uses (`plotInSearch`):
 *  taps the planned sources without draining the pool — legality and
 *  affordability were established by {@link canForetell} at enumeration time.
 *  The caller owns the priority bookkeeping. */
export function foretellInSearch(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): void {
    if (!player.hand.some((c) => c.id === cardInstanceId)) return;
    const plan = foretellPaymentPlan(state, player);
    if (plan) {
        const tapped = new Set(plan.map((step) => step.cardId));
        for (const src of player.battlefield) {
            if (tapped.has(src.id)) src.isTapped = true;
        }
    }
    exileAsForetold(state, player, cardInstanceId);
}

/** CR 702.143c — "a spell that was a foretold card before it was cast, even if
 *  it was cast for a cost other than a foretell cost": read off the card in
 *  `owner`'s exile BEFORE the cast removes it (the removal clears the
 *  designation). Both cast commit kernels — the server's (`castCommit.ts`) and
 *  the search's (`commitCastInSearch`, `applyMove.ts`) — spread the result
 *  onto the stack item they build, so the two cannot disagree. */
export function foretoldCastStackFlags(
    owner: PlayerState,
    cardInstanceId: string,
    castFromZone: string
): { foretold?: true } {
    if (castFromZone !== "exile") return {};
    const card = owner.exile.find((c) => c.id === cardInstanceId);
    return card?.foretold === true ? { foretold: true } : {};
}

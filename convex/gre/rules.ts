import type { CardInstanceState, GameState, PlayerState } from "./state";

export type CardAction =
    | "play"
    | "cast"
    | "discard"
    | "putToGraveyard"
    | "putToExile"
    | "putToLibrary"
    | "putToHand";

/** Returns the list of legal actions for a card in a player's hand. */
export function getLegalActions(
    _state: GameState,
    _player: PlayerState,
    card: CardInstanceState
): CardAction[] {
    const actions: CardAction[] = [];
    const types = (card.card as { types?: string[] }).types ?? [];

    // "Play" is for lands only (no mana cost, no stack)
    if (types.includes("Land")) {
        actions.push("play");
    }

    return actions;
}

/** Validates that a specific action is legal for a card. Throws if not. */
export function assertLegalAction(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    action: CardAction
): void {
    const legal = getLegalActions(state, player, card);
    if (!legal.includes(action)) {
        const cardName = (card.card as { name?: string }).name ?? card.id;
        throw new Error(
            `Illegal action "${action}" on "${cardName}". Legal actions: ${legal.join(", ") || "none"}`
        );
    }
}

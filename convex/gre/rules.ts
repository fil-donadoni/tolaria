import type { CardInstanceState, GameState, PlayerState } from "./state";

export type CardAction =
    | "play"
    | "cast"
    | "discard"
    | "putToGraveyard"
    | "putToExile"
    | "putToLibrary"
    | "putToHand";

const ALL_HAND_ACTIONS: CardAction[] = [
    "play",
    "cast",
    "discard",
    "putToGraveyard",
    "putToExile",
    "putToLibrary",
];

function hasInstantTiming(card: CardInstanceState): boolean {
    const types = (card.card as { types?: string[] }).types ?? [];
    if (types.includes("Instant")) return true;
    // TODO: check for Flash keyword
    return false;
}

/** Returns the list of legal actions for a card in a player's hand. */
export function getLegalActions(
    state: GameState,
    _player: PlayerState,
    card: CardInstanceState,
    debugAllActions = false
): CardAction[] {
    if (debugAllActions) {
        return [...ALL_HAND_ACTIONS];
    }

    const actions: CardAction[] = [];
    const types = (card.card as { types?: string[] }).types ?? [];

    // "Play" is for lands only (no mana cost, no stack)
    if (types.includes("Land")) {
        actions.push("play");
    }

    // "Cast" is for all non-land cards
    if (!types.includes("Land")) {
        // Sorcery-speed spells require empty stack
        if (hasInstantTiming(card) || state.stack.length === 0) {
            actions.push("cast");
        }
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

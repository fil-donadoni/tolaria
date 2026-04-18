import type { TargetRequirement, TargetSelection } from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import type { CardAction } from "./types";
import { isSorceryTiming } from "./phases";

const ALL_HAND_ACTIONS: CardAction[] = [
    "play",
    "cast",
    "discard",
    "putToGraveyard",
    "putToExile",
    "putToLibrary",
];

function hasInstantTiming(card: CardInstanceState): boolean {
    const types = card.types;
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
    const types = card.types;

    // "Play" is for lands only — requires sorcery timing (main phase, empty stack, active player)
    if (types.includes("Land")) {
        if (isSorceryTiming(state)) {
            actions.push("play");
        }
    }

    // "Cast" is for all non-land cards
    if (!types.includes("Land")) {
        if (hasInstantTiming(card)) {
            // Instants can be cast anytime a player has priority
            actions.push("cast");
        } else if (isSorceryTiming(state)) {
            // Sorcery-speed: main phase, empty stack, active player has priority
            actions.push("cast");
        }
    }

    return actions;
}

/** Returns all legal targets for a spell/ability with the given target requirement. */
export function getLegalTargets(
    state: GameState,
    requirement: TargetRequirement
): TargetSelection[] {
    const targets: TargetSelection[] = [];

    const reqTypes = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];

    // Check for permanent-targeting types (CardType values)
    const wantsAny = reqTypes.includes("any");
    const wantsSpell = reqTypes.includes("spell");
    const permanentTypes = reqTypes.filter(
        (t) => t !== "player" && t !== "any" && t !== "spell"
    );

    if (wantsAny || permanentTypes.length > 0) {
        for (const player of state.players) {
            for (const card of player.battlefield) {
                if (
                    wantsAny ||
                    permanentTypes.some((t) => card.types.includes(t as never))
                ) {
                    targets.push({ type: "permanent", id: card.id });
                }
            }
        }
    }

    if (wantsAny || reqTypes.includes("player")) {
        for (const player of state.players) {
            targets.push({ type: "player", id: player.id });
        }
    }

    // CR 114.1: any spell or ability currently on the stack is a legal target.
    // (The casting spell itself isn't on the stack yet during target selection.)
    if (wantsSpell) {
        for (const item of state.stack) {
            targets.push({ type: "spell", id: item.id });
        }
    }

    return targets;
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

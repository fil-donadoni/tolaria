import type { Color, TargetRequirement, TargetSelection } from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import type { CardAction } from "./types";
import { isSorceryTiming } from "./phases";
import { DAMAGEABLE_PERMANENT_TYPES } from "./constants";
import { STATIC_EFFECT_CTX } from "./layers";
import { isProtectedFromColors } from "./protection";
import { tryGetCardById } from "../cards";

export {
    getProtectedColors,
    isProtectedFromColors,
    isProtectedFromSource,
    parseProtectionFromColor,
} from "./protection";

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
    player: PlayerState,
    card: CardInstanceState,
    debugAllActions = false
): CardAction[] {
    if (debugAllActions) {
        return [...ALL_HAND_ACTIONS];
    }

    const actions: CardAction[] = [];

    // CR 117.1: a player can only take actions while they have priority.
    if (state.priorityPlayerId !== player.id) {
        return actions;
    }

    const types = card.types;

    // "Play" is for lands only — requires sorcery timing (main phase, empty stack, active player)
    if (types.includes("Land")) {
        if (isSorceryTiming(state)) {
            actions.push("play");
        }
    }

    // "Cast" is for all non-land cards
    if (!types.includes("Land")) {
        const baseLegal = hasInstantTiming(card)
            ? // Instants can be cast anytime a player has priority
              true
            : // Sorcery-speed: main phase, empty stack, active player has priority
              isSorceryTiming(state);
        if (baseLegal && passesCastPhaseRestriction(state, card)) {
            actions.push("cast");
        }
    }

    return actions;
}

/** CR 117.1b: some spells have phase-limited casting windows (e.g. Berserk
 *  "cast only before the combat damage step"). Returns true when the card
 *  either has no restriction or the current phase is in its allow-list. */
function passesCastPhaseRestriction(
    state: GameState,
    card: CardInstanceState
): boolean {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return true;
    const def = tryGetCardById(cardId);
    const restriction = def?.castPhaseRestriction;
    if (!restriction || restriction.length === 0) return true;
    return restriction.includes(state.phase);
}

/** True if the permanent/stack item has at least one of the given color in
 *  its mana cost (CR 202.2). Used by TargetRequirement.colorFilter. */
export function hasColor(card: CardInstanceState, color: Color): boolean {
    return STATIC_EFFECT_CTX.getColors(card).includes(color);
}

/** Returns all legal targets for a spell/ability with the given target
 *  requirement. `sourceColors` are the colors of the casting spell or the
 *  activating permanent (CR 202.2); when provided, protected permanents
 *  (CR 702.16b) are excluded. */
export function getLegalTargets(
    state: GameState,
    requirement: TargetRequirement,
    sourceColors: readonly Color[] = []
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
    const colorFilter = requirement.colorFilter;
    const tappedFilter = requirement.tappedFilter;

    // CR 115.4: "any target" means any creature, planeswalker, player, or
    // battle — the four object types that can be damaged (CR 120.3).
    if (wantsAny || permanentTypes.length > 0) {
        for (const player of state.players) {
            for (const card of player.battlefield) {
                const matchesAny =
                    wantsAny &&
                    DAMAGEABLE_PERMANENT_TYPES.some((t) =>
                        card.types.includes(t)
                    );
                const matchesExplicit = permanentTypes.some((t) =>
                    card.types.includes(t as never)
                );
                if (!matchesAny && !matchesExplicit) continue;
                // CR 202.2: filter by color for "source of color X" choices.
                if (colorFilter && !hasColor(card, colorFilter)) continue;
                // CR 701.20: tap-state filter for "target tapped/untapped ~".
                if (tappedFilter === "tapped" && !card.isTapped) continue;
                if (tappedFilter === "untapped" && card.isTapped) continue;
                // CR 702.16b: protected permanents can't be targeted by
                // spells/abilities of the stated quality.
                if (isProtectedFromColors(card, sourceColors)) continue;
                targets.push({ type: "permanent", id: card.id });
            }
        }
    }

    // Players have no color, so colorFilter excludes them.
    if ((wantsAny || reqTypes.includes("player")) && !colorFilter) {
        for (const player of state.players) {
            targets.push({ type: "player", id: player.id });
        }
    }

    // CR 114.1: any spell or ability currently on the stack is a legal target.
    // (The casting spell itself isn't on the stack yet during target selection.)
    if (wantsSpell) {
        for (const item of state.stack) {
            if (colorFilter && !hasColor(item, colorFilter)) continue;
            targets.push({ type: "spell", id: item.id });
        }
    }

    return targets;
}

/** Colors of the source whose target-selection is in progress (CR 202.2).
 *  Used to enforce CR 702.16b at cast-time target validation. For spells the
 *  source is the hand card; for activated abilities it's the battlefield
 *  permanent. Returns an empty array if the source card can't be located. */
export function getPendingTargetSourceColors(
    state: GameState,
    cardInstanceId: string,
    kind: "cast" | "ability"
): Color[] {
    if (kind === "ability") {
        for (const p of state.players) {
            const c = p.battlefield.find((x) => x.id === cardInstanceId);
            if (c) return STATIC_EFFECT_CTX.getColors(c);
        }
    } else {
        for (const p of state.players) {
            const c = p.hand.find((x) => x.id === cardInstanceId);
            if (c) return STATIC_EFFECT_CTX.getColors(c);
        }
    }
    return [];
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

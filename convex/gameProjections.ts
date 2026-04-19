import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "./gre/state";
import type { CardAction } from "./gre/types";
import { getLegalActions } from "./gre/rules";

/** CardInstanceState with the static card def stripped to { id } only. */
export type SlimCardInstance = Omit<CardInstanceState, "card"> & {
    card: { id: string };
};

/** Hand card in projected state: slim + legalActions attached. */
export type SlimHandCard = SlimCardInstance & { legalActions: CardAction[] };

/** StackItem slimmed to { id } card ref. */
export type SlimStackItem = Omit<StackItem, "card"> & { card: { id: string } };

/** PlayerState as seen through the public projection (library hidden, opponent hand nulled). */
export type PublicPlayer = Omit<
    PlayerState,
    "hand" | "library" | "graveyard" | "exile" | "battlefield"
> & {
    hand: (SlimHandCard | null)[];
    library: { count: number };
    graveyard: SlimCardInstance[];
    exile: SlimCardInstance[];
    battlefield: SlimCardInstance[];
};

/** PlayerState in the full debug projection (everything visible, card defs slimmed). */
export type FullPlayer = Omit<
    PlayerState,
    "hand" | "library" | "graveyard" | "exile" | "battlefield"
> & {
    hand: SlimHandCard[];
    library: SlimCardInstance[];
    graveyard: SlimCardInstance[];
    exile: SlimCardInstance[];
    battlefield: SlimCardInstance[];
};

export type PublicGameState = Omit<GameState, "players" | "stack"> & {
    seq: number;
    players: PublicPlayer[];
    stack: SlimStackItem[];
};

export type FullGameState = Omit<GameState, "players" | "stack"> & {
    seq: number;
    players: FullPlayer[];
    stack: SlimStackItem[];
};

function slimCard<
    T extends { card: { id?: string } | Record<string, unknown> },
>(instance: T): Omit<T, "card"> & { card: { id: string } } {
    const id = (instance.card as { id?: string }).id ?? "";
    return { ...instance, card: { id } };
}

/**
 * Projects GameState into the public view: viewer's own hand has slim cards + legalActions,
 * opponent's hand is an array of nulls of equal length, libraries are reduced to { count }.
 */
export function projectPublicState(
    state: GameState,
    seq: number,
    viewerId: string,
    allActions: boolean = false
): PublicGameState {
    const players = state.players.map((player): PublicPlayer => {
        const common = {
            ...player,
            graveyard: player.graveyard.map(slimCard),
            exile: player.exile.map(slimCard),
            battlefield: player.battlefield.map(slimCard),
            library: { count: player.library.length },
        };
        if (player.id === viewerId) {
            return {
                ...common,
                hand: player.hand.map(
                    (card): SlimHandCard => ({
                        ...slimCard(card),
                        legalActions: getLegalActions(
                            state,
                            player,
                            card,
                            allActions
                        ),
                    })
                ),
            };
        }
        return {
            ...common,
            hand: player.hand.map(() => null),
        };
    });

    return {
        ...state,
        seq,
        players,
        stack: state.stack.map(slimCard),
    };
}

/** Projects GameState into the full debug view: every zone is visible, card defs are slimmed. */
export function projectFullState(
    state: GameState,
    seq: number,
    allActions: boolean = false
): FullGameState {
    const players = state.players.map(
        (player): FullPlayer => ({
            ...player,
            hand: player.hand.map(
                (card): SlimHandCard => ({
                    ...slimCard(card),
                    legalActions: getLegalActions(
                        state,
                        player,
                        card,
                        allActions
                    ),
                })
            ),
            library: player.library.map(slimCard),
            graveyard: player.graveyard.map(slimCard),
            exile: player.exile.map(slimCard),
            battlefield: player.battlefield.map(slimCard),
        })
    );

    return {
        ...state,
        seq,
        players,
        stack: state.stack.map(slimCard),
    };
}

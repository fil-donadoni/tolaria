import type { Zone } from "./types";

export type CardInstanceState = {
    id: string;
    card: Record<string, unknown>;
    controllerId: string;
    ownerId: string;
    zone: Zone;
    isTapped: boolean;
};

export type PlayerState = {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    deck: Record<string, unknown>;
    hand: CardInstanceState[];
    library: CardInstanceState[];
    graveyard: CardInstanceState[];
    exile: CardInstanceState[];
    stack: CardInstanceState[];
    battlefield: CardInstanceState[];
    manaPool: Record<string, number>;
};

export type GameState = {
    players: PlayerState[];
    turn: number;
    activePlayerId: string;
    phase: string;
};

const ZONE_TO_FIELD: Record<Zone, keyof PlayerState> = {
    hand: "hand",
    library: "library",
    battlefield: "battlefield",
    graveyard: "graveyard",
    exile: "exile",
    stack: "stack",
};

export function getPlayer(state: GameState, playerId: string): PlayerState {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) throw new Error(`Player not found: ${playerId}`);
    return player;
}

/** Moves a card between zones within a player's state. Returns the moved card. */
export function moveCard(
    player: PlayerState,
    cardInstanceId: string,
    from: Zone,
    to: Zone
): CardInstanceState {
    const fromField = ZONE_TO_FIELD[from] as keyof Pick<
        PlayerState,
        "hand" | "library" | "battlefield" | "graveyard" | "exile" | "stack"
    >;
    const toField = ZONE_TO_FIELD[to] as keyof Pick<
        PlayerState,
        "hand" | "library" | "battlefield" | "graveyard" | "exile" | "stack"
    >;

    const sourceZone = player[fromField] as CardInstanceState[];
    const cardIndex = sourceZone.findIndex((c) => c.id === cardInstanceId);
    if (cardIndex === -1) {
        throw new Error(`Card ${cardInstanceId} not found in ${from}`);
    }

    const [card] = sourceZone.splice(cardIndex, 1);
    card.zone = to;

    const targetZone = player[toField] as CardInstanceState[];
    targetZone.push(card);

    return card;
}

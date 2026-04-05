import type { Color } from "../cards/types";
import type { Zone } from "./types";

/**
 * Intrinsic mana abilities for basic land subtypes (rule 305.6).
 * Any land with one of these subtypes has the corresponding mana ability.
 */
const LAND_SUBTYPE_MANA: Record<string, Color> = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
};

/** Returns the mana color a land produces via basic land subtype, or null. */
export function getBasicLandMana(card: CardInstanceState): Color | null {
    const subtypes = (card.card as { subtypes?: string[] }).subtypes ?? [];
    for (const subtype of subtypes) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) return color;
    }
    return null;
}

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
    battlefield: CardInstanceState[];
    manaPool: Record<string, number>;
};

export type StackItem = CardInstanceState & {
    castById: string;
};

export type GameState = {
    players: PlayerState[];
    stack: StackItem[];
    turn: number;
    activePlayerId: string;
    phase: string;
};

const ZONE_TO_FIELD: Record<Exclude<Zone, "stack">, keyof PlayerState> = {
    hand: "hand",
    library: "library",
    battlefield: "battlefield",
    graveyard: "graveyard",
    exile: "exile",
};

export function getPlayer(state: GameState, playerId: string): PlayerState {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) throw new Error(`Player not found: ${playerId}`);
    return player;
}

/** Moves a card between player zones (not stack). Returns the moved card. */
export function moveCard(
    player: PlayerState,
    cardInstanceId: string,
    from: Exclude<Zone, "stack">,
    to: Exclude<Zone, "stack">
): CardInstanceState {
    const fromField = ZONE_TO_FIELD[from];
    const toField = ZONE_TO_FIELD[to];

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

/** Removes a card from a player zone and returns it. */
export function removeFromZone(
    player: PlayerState,
    cardInstanceId: string,
    from: Exclude<Zone, "stack">
): CardInstanceState {
    const fromField = ZONE_TO_FIELD[from];
    const sourceZone = player[fromField] as CardInstanceState[];
    const cardIndex = sourceZone.findIndex((c) => c.id === cardInstanceId);
    if (cardIndex === -1) {
        throw new Error(`Card ${cardInstanceId} not found in ${from}`);
    }
    const [card] = sourceZone.splice(cardIndex, 1);
    card.zone = "stack";
    return card;
}

type ManaCost = Record<string, number | string | undefined>;

const MANA_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

/** Checks if a player can pay a mana cost. Returns null if yes, or a description of what's missing. */
export function checkManaCost(
    manaPool: Record<string, number>,
    cost: ManaCost
): string | null {
    const pool = { ...manaPool };

    // Pay colored/colorless costs first
    for (const color of MANA_COLORS) {
        const required = (cost[color] as number | undefined) ?? 0;
        if (required > 0) {
            if ((pool[color] ?? 0) < required) {
                return formatManaCost(cost);
            }
            pool[color] = (pool[color] ?? 0) - required;
        }
    }

    // Pay generic cost with any remaining mana
    const generic = (cost.X as number | undefined) ?? 0;
    if (generic > 0) {
        let available = 0;
        for (const color of MANA_COLORS) {
            available += pool[color] ?? 0;
        }
        if (available < generic) {
            return formatManaCost(cost);
        }
    }

    return null;
}

/** Deducts mana cost from pool. Colored first, then generic (greedy: highest pool first). */
export function payManaCost(
    manaPool: Record<string, number>,
    cost: ManaCost
): void {
    // Pay colored/colorless costs
    for (const color of MANA_COLORS) {
        const required = (cost[color] as number | undefined) ?? 0;
        if (required > 0) {
            manaPool[color] = (manaPool[color] ?? 0) - required;
        }
    }

    // Pay generic with colors that have the most mana available
    let generic = (cost.X as number | undefined) ?? 0;
    if (generic > 0) {
        const sorted = [...MANA_COLORS].sort(
            (a, b) => (manaPool[b] ?? 0) - (manaPool[a] ?? 0)
        );
        for (const color of sorted) {
            const available = manaPool[color] ?? 0;
            const take = Math.min(available, generic);
            if (take > 0) {
                manaPool[color] -= take;
                generic -= take;
                if (generic === 0) break;
            }
        }
    }
}

function formatManaCost(cost: ManaCost): string {
    const parts: string[] = [];
    const generic = (cost.X as number | undefined) ?? 0;
    if (generic > 0) parts.push(`${generic}`);
    for (const color of MANA_COLORS) {
        const n = (cost[color] as number | undefined) ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${color}}`);
    }
    return parts.join("") || "0";
}

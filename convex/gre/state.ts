import type {
    Color,
    SpellContext,
    TargetSelection,
    TargetType,
} from "../cards/types";
import { getCardById } from "../cards";
import type { Phase, Zone } from "./types";

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
    /** Set when this land's mana has been consumed by a spell. Cannot be manually untapped. Resets at untap step. */
    manaCommitted?: boolean;
    /** Set when a creature enters the battlefield. Cleared at untap step. Prevents attacking. */
    isSummoningSick?: boolean;
    /** Set during combat when this creature is declared as attacker. Cleared at END_OF_COMBAT. */
    isAttacking?: boolean;
    /** Set during combat when this creature is declared as blocker. Cleared at END_OF_COMBAT. */
    isBlocking?: boolean;
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
    /** Targets chosen during spell announcement (CR 601.2c). */
    targets?: TargetSelection[];
};

/** Tracks an in-progress spell cast during the payment phase (CR 601.2). */
export type PendingCast = {
    playerId: string;
    cardInstanceId: string;
    manaCost: Record<string, number>;
    /** Land ids tapped during this payment, for rollback on cancel. */
    tappedLandIds: string[];
};

/** Tracks target selection for a spell being announced (CR 601.2c). */
export type PendingTarget = {
    playerId: string;
    cardInstanceId: string;
    /** What kind of targets are needed. */
    targetType: TargetType;
    /** How many targets still needed. */
    count: number;
    /** Targets already selected. */
    selected: TargetSelection[];
};

export type GameState = {
    players: PlayerState[];
    stack: StackItem[];
    turn: number;
    activePlayerId: string;
    priorityPlayerId: string;
    /** Number of consecutive priority passes (resets on any action). Resolves top of stack at 2. */
    passCount: number;
    phase: Phase;
    /** Active spell payment in progress (CR 601.2). */
    pendingCast?: PendingCast;
    /** Active target selection in progress (CR 601.2c). */
    pendingTarget?: PendingTarget;
    /** Player IDs that auto-pass priority for the rest of this turn. Resets on new turn. */
    autoPassPlayers?: string[];
    /** Active combat state. Set at DECLARE_ATTACKERS, cleared at END_OF_COMBAT. */
    combat?: {
        attackerIds: string[];
        confirmed: boolean;
        /** blockerId → attackerId mapping. */
        blockerAssignments: Record<string, string>;
        /** Blocker currently being assigned by the defending player (visible to both clients). */
        pendingBlockerId?: string;
        blockersConfirmed: boolean;
        /** attackerId → { blockerId: damage } for multi-blocker damage distribution. */
        damageAssignments?: Record<string, Record<string, number>>;
        /** false = waiting for manual assignment, undefined = auto-applied or not yet at damage step. */
        damageConfirmed?: boolean;
    };
};

const PERMANENT_TYPES = [
    "Creature",
    "Artifact",
    "Enchantment",
    "Planeswalker",
    "Battle",
];

/** Resolves the top item of the stack (CR 608.3). Returns the resolved item. */
export function resolveTopOfStack(state: GameState): StackItem {
    const item = state.stack.pop();
    if (!item) throw new Error("Stack is empty");

    const types = (item.card as { types?: string[] }).types ?? [];
    const isPermanent = types.some((t) => PERMANENT_TYPES.includes(t));

    // Execute spell effects before moving to destination zone (CR 608.2b)
    const cardId = (item.card as { id?: string }).id;
    if (cardId) {
        const cardDef = getCardById(cardId);
        if (cardDef.resolve && item.targets) {
            const ctx = buildSpellContext(state, item);
            cardDef.resolve(ctx);
        }
    }

    const controller = getPlayer(state, item.castById);

    if (isPermanent) {
        // Permanent spells enter the battlefield (CR 608.3)
        item.zone = "battlefield";
        item.isTapped = false;
        if (types.includes("Creature")) {
            item.isSummoningSick = true;
        }
        controller.battlefield.push(item);
    } else {
        // Instant/Sorcery go to owner's graveyard (CR 608.2k)
        const owner = getPlayer(state, item.ownerId);
        item.zone = "graveyard";
        owner.graveyard.push(item);
    }

    return item;
}

/** Builds a SpellContext with primitives bound to the current game state. */
function buildSpellContext(state: GameState, item: StackItem): SpellContext {
    return {
        caster: item.castById,
        controller: item.castById,
        targets: item.targets ?? [],
        dealDamage(target: TargetSelection, amount: number) {
            if (target.type === "player") {
                const player = getPlayer(state, target.id);
                player.life -= amount;
            } else {
                // Find the creature on any player's battlefield
                for (const player of state.players) {
                    const idx = player.battlefield.findIndex(
                        (c) => c.id === target.id
                    );
                    if (idx === -1) continue;
                    const creature = player.battlefield[idx];
                    const toughness =
                        (creature.card as { toughness?: number }).toughness ??
                        0;
                    if (amount >= toughness) {
                        // Lethal damage — move to graveyard (SBA 704.5g)
                        player.battlefield.splice(idx, 1);
                        creature.zone = "graveyard";
                        const owner = getPlayer(state, creature.ownerId);
                        owner.graveyard.push(creature);
                    }
                    // TODO: track damage on creatures for non-lethal damage accumulation
                    break;
                }
            }
        },
        gainLife(playerId: string, amount: number) {
            const player = getPlayer(state, playerId);
            player.life += amount;
        },
        loseLife(playerId: string, amount: number) {
            const player = getPlayer(state, playerId);
            player.life -= amount;
        },
        getLife(playerId: string): number {
            return getPlayer(state, playerId).life;
        },
        getPower(target: TargetSelection): number {
            if (target.type !== "creature") return 0;
            for (const player of state.players) {
                const card = player.battlefield.find((c) => c.id === target.id);
                if (card) {
                    return (card.card as { power?: number }).power ?? 0;
                }
            }
            return 0;
        },
        getController(target: TargetSelection): string {
            if (target.type === "player") return target.id;
            for (const player of state.players) {
                const card = player.battlefield.find((c) => c.id === target.id);
                if (card) return card.controllerId;
            }
            throw new Error(`Target ${target.id} not found on battlefield`);
        },
        destroy(target: TargetSelection): void {
            if (target.type === "player") {
                throw new Error("Cannot destroy a player");
            }
            for (const player of state.players) {
                const idx = player.battlefield.findIndex(
                    (c) => c.id === target.id
                );
                if (idx === -1) continue;
                const creature = player.battlefield.splice(idx, 1)[0];
                creature.zone = "graveyard";
                const owner = getPlayer(state, creature.ownerId);
                owner.graveyard.push(creature);
                break;
            }
        },
        exile(target: TargetSelection): void {
            if (target.type === "player") {
                throw new Error("Cannot exile a player");
            }
            for (const player of state.players) {
                const idx = player.battlefield.findIndex(
                    (c) => c.id === target.id
                );
                if (idx === -1) continue;
                const creature = player.battlefield.splice(idx, 1)[0];
                creature.zone = "exile";
                const owner = getPlayer(state, creature.ownerId);
                owner.exile.push(creature);
                break;
            }
        },
    };
}

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

/** Returns the id of the other player (2-player game). */
export function getOpponentId(state: GameState, playerId: string): string {
    const opponent = state.players.find((p) => p.id !== playerId);
    if (!opponent) throw new Error("Opponent not found");
    return opponent.id;
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

/**
 * After paying a mana cost, mark tapped lands as committed so they can't be manually untapped.
 * For each color spent, finds tapped-but-uncommitted lands of that color and marks them.
 * Generic mana commits lands greedy (highest pool color first, matching payManaCost behavior).
 */
export function commitLandsForCost(
    player: PlayerState,
    cost: Record<string, number>
): void {
    const remaining = { ...cost };

    // Commit lands for colored costs first
    for (const color of MANA_COLORS) {
        let needed = remaining[color] ?? 0;
        if (needed <= 0) continue;
        for (const card of player.battlefield) {
            if (needed <= 0) break;
            if (
                card.isTapped &&
                !card.manaCommitted &&
                getBasicLandMana(card) === color
            ) {
                card.manaCommitted = true;
                needed--;
            }
        }
    }

    // Commit lands for generic cost (same greedy order as payManaCost)
    let generic = remaining.X ?? 0;
    if (generic > 0) {
        const sorted = [...MANA_COLORS].sort((a, b) => {
            const countA = player.battlefield.filter(
                (c) =>
                    c.isTapped && !c.manaCommitted && getBasicLandMana(c) === a
            ).length;
            const countB = player.battlefield.filter(
                (c) =>
                    c.isTapped && !c.manaCommitted && getBasicLandMana(c) === b
            ).length;
            return countB - countA;
        });
        for (const color of sorted) {
            for (const card of player.battlefield) {
                if (generic <= 0) break;
                if (
                    card.isTapped &&
                    !card.manaCommitted &&
                    getBasicLandMana(card) === color
                ) {
                    card.manaCommitted = true;
                    generic--;
                }
            }
            if (generic <= 0) break;
        }
    }
}

/** Converts a ManaCost (with possible string X) to a pure numeric record. */
export function normalizeManaCost(cost: ManaCost): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, val] of Object.entries(cost)) {
        const n = typeof val === "number" ? val : 0;
        if (n > 0) result[key] = n;
    }
    return result;
}

/** Returns true if manaPool fully covers the normalized cost. */
export function isManaCostCovered(
    manaPool: Record<string, number>,
    cost: Record<string, number>
): boolean {
    const pool = { ...manaPool };

    // Check colored/colorless
    for (const color of MANA_COLORS) {
        const required = cost[color] ?? 0;
        if (required > 0) {
            if ((pool[color] ?? 0) < required) return false;
            pool[color] = (pool[color] ?? 0) - required;
        }
    }

    // Check generic
    const generic = cost.X ?? 0;
    if (generic > 0) {
        let available = 0;
        for (const color of MANA_COLORS) {
            available += pool[color] ?? 0;
        }
        if (available < generic) return false;
    }

    return true;
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

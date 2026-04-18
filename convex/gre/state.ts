import type {
    CardType,
    SpellContext,
    TargetRequirement,
    TargetSelection,
} from "../cards/types";
import { getCardById } from "../cards";
import type { Phase, Zone } from "./types";
import {
    getActivatedManaColor,
    getBasicLandMana,
    MANA_COLORS,
    PERMANENT_TYPES,
} from "./constants";

// Re-export for consumers that imported from here previously
export { getBasicLandMana } from "./constants";

export type CardInstanceState = {
    id: string;
    /** Immutable reference to the original card definition. */
    card: Record<string, unknown>;
    controllerId: string;
    ownerId: string;
    zone: Zone;
    /** Mutable types — initialized from card definition, can be modified by effects. */
    types: CardType[];
    /** Mutable subtypes — initialized from card definition, can be modified by effects. */
    subtypes: string[];
    /** Mutable power — initialized from card definition for creatures. */
    power?: number;
    /** Mutable toughness — initialized from card definition for creatures. */
    toughness?: number;
    /** Keyword abilities (flying, vigilance, defender, etc.). Initialized from card definition. */
    staticAbilities: string[];
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
    /** Set when a player attempts to draw from an empty library (CR 704.5b). */
    hasDrawnFromEmpty?: boolean;
};

export type StackItem = CardInstanceState & {
    castById: string;
    /** Targets chosen during spell announcement (CR 601.2c). */
    targets?: TargetSelection[];
    /** If set, this stack item is an activated ability (not a spell). Source permanent stays on battlefield. */
    abilityId?: string;
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
    /** What kind of targets are needed (matches TargetRequirement.type). */
    targetType: TargetRequirement["type"];
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
        /** attackerId → ordered list of blocker IDs (set by attacking player after blockers declared, CR 510.1). */
        blockerOrder?: Record<string, string[]>;
        /** true once attacking player has confirmed the blocker ordering. */
        blockerOrderConfirmed?: boolean;
        /** attackerId → { blockerId/defenderId: damage } for damage distribution. */
        damageAssignments?: Record<string, Record<string, number>>;
        /** false = waiting for manual assignment, undefined = auto-applied or not yet at damage step. */
        damageConfirmed?: boolean;
    };
    /** Player who can undo the last mana ability activation. Cleared on any non-mana action. */
    undoableBy?: string;
    /** Set when a player loses the game. Contains winner/loser info. */
    gameOver?: {
        winnerId: string;
        loserId: string;
        reason: "life" | "decked";
    };
};

/** Resolves the top item of the stack (CR 608.3). Returns the resolved item. */
export function resolveTopOfStack(state: GameState): StackItem {
    const item = state.stack.pop();
    if (!item) throw new Error("Stack is empty");

    const cardId = (item.card as { id?: string }).id;
    const cardDef = cardId ? getCardById(cardId) : undefined;

    // Activated ability resolution — execute effect and discard (CR 602.2)
    if (item.abilityId && cardDef) {
        const ability = cardDef.activatedAbilities?.find(
            (a) => a.id === item.abilityId
        );
        if (ability?.resolve) {
            const ctx = buildSpellContext(state, item);
            ability.resolve(ctx);
        }
        return item;
    }

    const isPermanent = item.types.some((t) =>
        PERMANENT_TYPES.includes(t as (typeof PERMANENT_TYPES)[number])
    );

    // Execute spell effects before moving to destination zone (CR 608.2b)
    if (cardDef?.resolve) {
        const ctx = buildSpellContext(state, item);
        cardDef.resolve(ctx);
    }

    const controller = getPlayer(state, item.castById);

    if (isPermanent) {
        // Permanent spells enter the battlefield (CR 608.3)
        item.zone = "battlefield";
        item.isTapped = cardDef?.entersTapped === true;
        if (item.types.includes("Creature")) {
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

/** Finds a card on any player's battlefield by instance id. */
function findOnBattlefield(
    state: GameState,
    cardId: string
): { card: CardInstanceState; player: PlayerState; idx: number } | null {
    for (const player of state.players) {
        const idx = player.battlefield.findIndex((c) => c.id === cardId);
        if (idx !== -1) return { card: player.battlefield[idx], player, idx };
    }
    return null;
}

/** Removes a permanent from battlefield and moves it to the target zone of its owner. */
export function removePermanentTo(
    state: GameState,
    cardId: string,
    toZone: "graveyard" | "exile"
): void {
    const found = findOnBattlefield(state, cardId);
    if (!found) return;
    const [creature] = found.player.battlefield.splice(found.idx, 1);
    creature.zone = toZone;
    const owner = getPlayer(state, creature.ownerId);
    (owner[toZone] as CardInstanceState[]).push(creature);
}

/** Builds a SpellContext with primitives bound to the current game state. */
function buildSpellContext(state: GameState, item: StackItem): SpellContext {
    function requirePermanent(target: TargetSelection): CardInstanceState {
        const found = findOnBattlefield(state, target.id);
        if (!found) throw new Error(`Creature ${target.id} not on battlefield`);
        return found.card;
    }

    return {
        caster: item.castById,
        controller: item.castById,
        targets: item.targets ?? [],

        dealDamage(target: TargetSelection, amount: number) {
            if (target.type === "player") {
                getPlayer(state, target.id).life -= amount;
            } else {
                const found = findOnBattlefield(state, target.id);
                if (!found) return;
                if (amount >= (found.card.toughness ?? 0)) {
                    removePermanentTo(state, target.id, "graveyard");
                }
                // TODO: track damage on creatures for non-lethal damage accumulation
            }
        },
        gainLife(playerId: string, amount: number) {
            getPlayer(state, playerId).life += amount;
        },
        loseLife(playerId: string, amount: number) {
            getPlayer(state, playerId).life -= amount;
        },
        getLife(playerId: string): number {
            return getPlayer(state, playerId).life;
        },
        getPower(target: TargetSelection): number {
            if (target.type === "player") return 0;
            return findOnBattlefield(state, target.id)?.card.power ?? 0;
        },
        getToughness(target: TargetSelection): number {
            if (target.type === "player") return 0;
            return findOnBattlefield(state, target.id)?.card.toughness ?? 0;
        },
        modifyPower(target: TargetSelection, amount: number): void {
            if (target.type === "player") return;
            const card = requirePermanent(target);
            card.power = (card.power ?? 0) + amount;
        },
        modifyToughness(target: TargetSelection, amount: number): void {
            if (target.type === "player") return;
            const card = requirePermanent(target);
            card.toughness = (card.toughness ?? 0) + amount;
        },
        getController(target: TargetSelection): string {
            if (target.type === "player") return target.id;
            return requirePermanent(target).controllerId;
        },
        destroy(target: TargetSelection): void {
            if (target.type === "player")
                throw new Error("Cannot destroy a player");
            removePermanentTo(state, target.id, "graveyard");
        },
        exile(target: TargetSelection): void {
            if (target.type === "player")
                throw new Error("Cannot exile a player");
            removePermanentTo(state, target.id, "exile");
        },
        destroyAll(type?: CardType | CardType[]): void {
            const types = type
                ? Array.isArray(type)
                    ? type
                    : [type]
                : undefined;
            for (const player of state.players) {
                const toDestroy = types
                    ? player.battlefield.filter((c) =>
                          types.some((t) => c.types.includes(t))
                      )
                    : [...player.battlefield];
                for (const card of toDestroy) {
                    removePermanentTo(state, card.id, "graveyard");
                }
            }
        },
        destroyAllBySubtype(subtype: string): void {
            for (const player of state.players) {
                const toDestroy = player.battlefield.filter((c) =>
                    c.subtypes.includes(subtype)
                );
                for (const card of toDestroy) {
                    removePermanentTo(state, card.id, "graveyard");
                }
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

    /** Returns the mana color a tapped source produces (land subtype or activated ability). */
    const getManaColor = (card: CardInstanceState) =>
        getBasicLandMana(card) ?? getActivatedManaColor(card);

    // Commit mana sources for colored costs first
    for (const color of MANA_COLORS) {
        let needed = remaining[color] ?? 0;
        if (needed <= 0) continue;
        for (const card of player.battlefield) {
            if (needed <= 0) break;
            if (
                card.isTapped &&
                !card.manaCommitted &&
                getManaColor(card) === color
            ) {
                card.manaCommitted = true;
                needed--;
            }
        }
    }

    // Commit mana sources for generic cost (same greedy order as payManaCost)
    let generic = remaining.X ?? 0;
    if (generic > 0) {
        const sorted = [...MANA_COLORS].sort((a, b) => {
            const countA = player.battlefield.filter(
                (c) => c.isTapped && !c.manaCommitted && getManaColor(c) === a
            ).length;
            const countB = player.battlefield.filter(
                (c) => c.isTapped && !c.manaCommitted && getManaColor(c) === b
            ).length;
            return countB - countA;
        });
        for (const color of sorted) {
            for (const card of player.battlefield) {
                if (generic <= 0) break;
                if (
                    card.isTapped &&
                    !card.manaCommitted &&
                    getManaColor(card) === color
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

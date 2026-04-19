import type {
    CardType,
    GameEvent,
    ManaCost as CardManaCost,
    PermanentFilter,
    SpellContext,
    TargetRequirement,
    TargetSelection,
} from "../cards/types";
import { getCardById } from "../cards";
import type { Phase, Zone } from "./types";
import {
    getActivatedManaColor,
    getBasicLandMana,
    isDamageablePermanent,
    MANA_COLORS,
    PERMANENT_TYPES,
} from "./constants";
import { getEffectivePower, getEffectiveToughness } from "./layers";
import { randomInt } from "./rng";

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
    /** Mana choice made when activating a manaChoices ability (e.g. Birds of Paradise).
     *  Stored so untap can refund the exact mana that was added. Cleared at untap step. */
    chosenMana?: CardManaCost;
    /** Set when this land's mana has been consumed by a spell. Cannot be manually untapped. Resets at untap step. */
    manaCommitted?: boolean;
    /** Set when a creature enters the battlefield. Cleared at untap step. Prevents attacking. */
    isSummoningSick?: boolean;
    /** Set during combat when this creature is declared as attacker. Cleared at END_OF_COMBAT. */
    isAttacking?: boolean;
    /** Set during combat when this creature is declared as blocker. Cleared at END_OF_COMBAT. */
    isBlocking?: boolean;
    /** Damage marked on the creature this turn (CR 120.3). Accumulates across
     *  damage events; checked against effective toughness for lethal damage
     *  (CR 704.5g). Removed at CLEANUP (CR 514.2). */
    damageMarked?: number;
};

/** A one-shot damage prevention effect (CR 615.1, 615.6). The next time the
 *  given source would deal damage to `playerId`, that damage is prevented and
 *  this effect is consumed. End-of-turn effects are purged at CLEANUP
 *  (CR 514.2). Used by Circle of Protection. */
export type PreventionEffect = {
    /** Id of the source permanent (on battlefield) or stack item whose next
     *  damage to `playerId` should be prevented. Matched against
     *  `sourceInstanceId` on damage events. */
    sourceInstanceId: string;
    /** The player whose incoming damage is prevented. */
    playerId: string;
    /** "end-of-turn" is removed at CLEANUP (CR 514.2). */
    duration: "end-of-turn";
};

/** A reference to an activated ability template granted to a player by
 *  another card's effect (CR 113.1). Stores only ids — the actual ability
 *  is resolved at activation time via `getCardById(sourceCardId)`. */
export type GrantedAbilityInstance = {
    /** Unique instance id ("grant-N") generated from GameState.nextGrantSeq. */
    id: string;
    /** Card definition id whose `activatedAbilities[]` contains the template. */
    sourceCardId: string;
    /** The ability's id on that card definition. */
    abilityId: string;
    /** "end-of-turn" is removed at CLEANUP (CR 514.2). */
    duration: "end-of-turn";
    /** Turn on which the grant was created; used for bookkeeping/debug. */
    grantedAtTurn: number;
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
    /** Activated abilities granted by effects (e.g. Channel's "Pay 1 life:
     *  Add {C}." until end of turn). Each entry is a reference to a template
     *  on another card; duration controls when CLEANUP purges it. */
    grantedAbilities?: GrantedAbilityInstance[];
};

export type StackItem = CardInstanceState & {
    castById: string;
    /** Targets chosen during spell announcement (CR 601.2c). */
    targets?: TargetSelection[];
    /** Value chosen for X at cast-time for spells with X in their cost
     *  (CR 107.3, 601.2b). Undefined for spells without X. Read on
     *  resolution by SpellContext.getX(). */
    chosenX?: number;
    /** If set, this stack item is an activated ability (not a spell). Source permanent stays on battlefield. */
    abilityId?: string;
    /** If set, this stack item is a triggered ability (CR 603). The source
     *  permanent stays on the battlefield; the trigger vanishes on resolution. */
    triggeredAbilityId?: string;
    /** The originating event captured at trigger time. Passed to resolve(). */
    triggerEvent?: GameEvent;
};

/** Tracks an in-progress spell cast during the payment phase (CR 601.2). */
export type PendingCast = {
    playerId: string;
    cardInstanceId: string;
    manaCost: Record<string, number>;
    /** Land ids tapped during this payment, for rollback on cancel. */
    tappedLandIds: string[];
    /** If true, the caster wants priority back after their spell hits the stack
     *  (Ctrl-initiated cast). If false/undefined, the caster is auto-skipped. */
    keepPriority?: boolean;
    /** Value chosen for X at announce time. Propagated to the stack item. */
    chosenX?: number;
};

/** Tracks target selection for a spell being announced (CR 601.2c) or an
 *  activated ability with targets (CR 602.2b). */
export type PendingTarget = {
    playerId: string;
    /** For spells: id of the card being cast (in hand). For activated
     *  abilities (`kind: "ability"`): id of the permanent on the battlefield. */
    cardInstanceId: string;
    /** What kind of targets are needed (matches TargetRequirement.type). */
    targetType: TargetRequirement["type"];
    /** Fixed N, or a range for variable-target spells. Target selection ends
     *  automatically when selected.length === count (fixed) or the caller
     *  invokes confirmTargets with selected.length within [min, max]. */
    count: number | { min: number; max?: number };
    /** If set, restricts legal targets to sources of the given color
     *  (CR 202.2). Propagated from TargetRequirement.colorFilter. */
    colorFilter?: string;
    /** Targets already selected. */
    selected: TargetSelection[];
    /** Mirrors PendingCast.keepPriority — propagated when the pending cast is created. */
    keepPriority?: boolean;
    /** Propagated from announceCast when the spell has X in its mana cost. */
    chosenX?: number;
    /** Distinguishes a spell cast (default) from an activated ability that
     *  requires targets (CR 602.2b). When "ability", `abilityId` is set and
     *  costs are paid at finalization instead of at announcement. */
    kind?: "cast" | "ability";
    /** For `kind: "ability"` only — id of the activated ability template on
     *  the source card definition. */
    abilityId?: string;
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
    /** Seed for the per-game PRNG. Logged on GAME_INITIALIZED for replay. */
    rngSeed: number;
    /** Monotonic counter advanced by every consumption of randomness (shuffle,
     *  discard at random, coin flips). With rngSeed, the event log is
     *  sufficient to reproduce the exact random choices made during a game. */
    rngCounter: number;
    /** Active spell payment in progress (CR 601.2). */
    pendingCast?: PendingCast;
    /** Active target selection in progress (CR 601.2c). */
    pendingTarget?: PendingTarget;
    /** Player IDs that auto-pass priority for the rest of this turn. Resets on new turn. */
    autoPassPlayers?: string[];
    /** Player ID that auto-passes the very next time priority lands on them, then
     *  is cleared. Set when a player casts/activates without holding Ctrl so they
     *  don't waste a priority round responding to their own action (CR 117). */
    singleShotAutoPass?: string;
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
    /** Monotonic counter advanced by each grantAbility() call. Used to
     *  generate deterministic `grant-N` ids for GrantedAbilityInstance so
     *  replays reproduce the same ids. */
    nextGrantSeq?: number;
    /** Set when a player loses the game. Contains winner/loser info. */
    gameOver?: {
        winnerId: string;
        loserId: string;
        reason: "life" | "decked" | "concede";
    };
    /** Queue of player IDs scheduled to take an extra turn (CR 500.7).
     *  LIFO: pushed at the end, popped from the end — the last extra turn
     *  created is the next one taken. Consumed by advanceTurn(). */
    extraTurns?: string[];
    /** Active one-shot damage prevention effects (CR 615.1). Each effect is
     *  consumed the first time a matching (source, player) damage event
     *  occurs. Cleared at CLEANUP for "end-of-turn" effects (CR 514.2). */
    preventionEffects?: PreventionEffect[];
};

/** Returns true if a prevention effect matches (source, player) and consumes
 *  it. Called from every damage-dealing path (spell/ability, combat). */
export function consumePreventionIfAny(
    state: GameState,
    sourceInstanceId: string,
    playerId: string
): boolean {
    if (!state.preventionEffects || state.preventionEffects.length === 0) {
        return false;
    }
    const idx = state.preventionEffects.findIndex(
        (e) =>
            e.sourceInstanceId === sourceInstanceId && e.playerId === playerId
    );
    if (idx === -1) return false;
    state.preventionEffects.splice(idx, 1);
    if (state.preventionEffects.length === 0) {
        state.preventionEffects = undefined;
    }
    return true;
}

/** Resolves the top item of the stack (CR 608.3). Returns the resolved item. */
export function resolveTopOfStack(state: GameState): StackItem {
    const item = state.stack.pop();
    if (!item) throw new Error("Stack is empty");

    const cardId = (item.card as { id?: string }).id;
    const cardDef = cardId ? getCardById(cardId) : undefined;

    // Triggered ability resolution (CR 603.3). Source permanent stays on
    // battlefield; the trigger vanishes after resolve.
    if (item.triggeredAbilityId && cardDef && item.triggerEvent) {
        const ability = cardDef.triggeredAbilities?.find(
            (a) => a.id === item.triggeredAbilityId
        );
        if (ability) {
            const ctx = buildSpellContext(state, item);
            ability.resolve(ctx, item.triggerEvent);
        }
        return item;
    }

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

/** Predicate: does the card match every constraint in the filter? Omitted
 *  fields don't constrain (AND semantics). */
function matchesPermanentFilter(
    card: CardInstanceState,
    filter: PermanentFilter
): boolean {
    if (filter.types !== undefined) {
        const types = Array.isArray(filter.types)
            ? filter.types
            : [filter.types];
        if (!types.some((t) => card.types.includes(t))) return false;
    }
    if (filter.subtypes !== undefined) {
        const subtypes = Array.isArray(filter.subtypes)
            ? filter.subtypes
            : [filter.subtypes];
        if (!subtypes.some((s) => card.subtypes.includes(s))) return false;
    }
    if (
        filter.requireAbility !== undefined &&
        !card.staticAbilities.includes(filter.requireAbility)
    ) {
        return false;
    }
    if (
        filter.excludeAbility !== undefined &&
        card.staticAbilities.includes(filter.excludeAbility)
    ) {
        return false;
    }
    return true;
}

/** Normalizes the polymorphic `destroyAll` argument into a filter object. */
function normalizeDestroyAllFilter(
    filter: CardType | CardType[] | PermanentFilter | undefined
): PermanentFilter {
    if (filter === undefined) return {};
    if (typeof filter === "string" || Array.isArray(filter)) {
        return { types: filter };
    }
    return filter;
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
                // CR 615.1: a prevention effect replaces the would-be damage
                // with nothing. Matched against the current stack item's id
                // (the spell/ability dealing the damage).
                if (consumePreventionIfAny(state, item.id, target.id)) return;
                getPlayer(state, target.id).life -= amount;
            } else {
                const found = findOnBattlefield(state, target.id);
                if (!found) return;
                // CR 120.3: damage can only be dealt to creatures, planeswalkers,
                // players and battles. Damage on any other permanent is a no-op.
                if (!isDamageablePermanent(found.card)) return;
                // CR 120.3: damage is marked on the creature and accumulates
                // until CLEANUP (CR 514.2). Lethal damage (CR 704.5g) is
                // applied inline using the post-accumulation marked total
                // compared to effective toughness (layer 7c).
                found.card.damageMarked =
                    (found.card.damageMarked ?? 0) + amount;
                if (
                    found.card.damageMarked >=
                    getEffectiveToughness(state, found.card)
                ) {
                    removePermanentTo(state, target.id, "graveyard");
                }
            }
        },
        preventNextDamageFromSource(
            sourceInstanceId: string,
            playerId: string
        ): void {
            // CR 615.1, 615.6: "The next time a [source] would deal damage
            // to [player] this turn, prevent that damage." Stored as a
            // one-shot replacement effect and consumed by the first
            // matching damage event.
            state.preventionEffects = [
                ...(state.preventionEffects ?? []),
                {
                    sourceInstanceId,
                    playerId,
                    duration: "end-of-turn",
                },
            ];
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
            const found = findOnBattlefield(state, target.id);
            return found ? getEffectivePower(state, found.card) : 0;
        },
        getToughness(target: TargetSelection): number {
            if (target.type === "player") return 0;
            const found = findOnBattlefield(state, target.id);
            return found ? getEffectiveToughness(state, found.card) : 0;
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
        destroyAll(filter?: CardType | CardType[] | PermanentFilter): void {
            const normalized = normalizeDestroyAllFilter(filter);
            const ids: string[] = [];
            for (const player of state.players) {
                for (const card of player.battlefield) {
                    if (matchesPermanentFilter(card, normalized)) {
                        ids.push(card.id);
                    }
                }
            }
            for (const id of ids) {
                removePermanentTo(state, id, "graveyard");
            }
        },
        // CR 121.1: cards are drawn one at a time. Stops if the library empties
        // (CR 704.5b: hasDrawnFromEmpty flagged by drawCard; SBA ends the game).
        drawCards(playerId: string, amount: number): void {
            const player = getPlayer(state, playerId);
            for (let i = 0; i < amount; i++) {
                if (drawCard(player) === null) break;
            }
        },
        // CR 701.5a: to counter a spell is to remove it from the stack and put
        // it into its owner's graveyard. If the target is no longer on the
        // stack (already resolved/countered), this is a silent no-op — the
        // countering spell simply fails to find a legal target (CR 608.2b).
        counter(target: TargetSelection): void {
            if (target.type !== "spell") {
                throw new Error("counter() requires a spell target");
            }
            const idx = state.stack.findIndex((s) => s.id === target.id);
            if (idx === -1) return; // target no longer on stack — fizzle silently
            const [item] = state.stack.splice(idx, 1);
            const owner = getPlayer(state, item.ownerId);
            // Activated abilities are not cards: they just vanish (CR 701.5a, 113.7a).
            if (item.abilityId) return;
            item.zone = "graveyard";
            owner.graveyard.push(item);
        },
        discardAtRandom(playerId: string, amount: number): void {
            const player = getPlayer(state, playerId);
            const picks = Math.min(amount, player.hand.length);
            for (let i = 0; i < picks; i++) {
                const idx = randomInt(state, player.hand.length);
                moveCard(player, player.hand[idx].id, "hand", "graveyard");
            }
        },
        addMana(cost: CardManaCost): void {
            const player = getPlayer(state, item.castById);
            for (const [color, amount] of Object.entries(cost)) {
                if (color === "X" || typeof amount !== "number" || amount <= 0)
                    continue;
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        },
        getX(): number {
            return item.chosenX ?? 0;
        },
        // CR 120.1: damage divided evenly, rounded down, among target
        // creatures/players. E.g. 5 damage / 2 targets = 2 each (remainder
        // discarded). Empty targets list is a silent no-op.
        dealDividedDamage(
            targets: TargetSelection[],
            totalAmount: number
        ): void {
            if (targets.length === 0 || totalAmount <= 0) return;
            const per = Math.floor(totalAmount / targets.length);
            if (per <= 0) return;
            for (const target of targets) {
                this.dealDamage(target, per);
            }
        },
        // CR 120.3: damage is dealt simultaneously to every matching entity.
        // Snapshot creature ids before iterating — dealDamage may remove them
        // from the battlefield (SBA lethal) and players have not yet taken
        // damage at that moment.
        dealDamageToEach(
            amount: number,
            filter: {
                creatures?: boolean | Omit<PermanentFilter, "types">;
                players?: boolean;
            }
        ): void {
            if (amount <= 0) return;
            if (filter.creatures) {
                const spec: PermanentFilter = {
                    types: "Creature",
                    ...(typeof filter.creatures === "object"
                        ? filter.creatures
                        : {}),
                };
                const ids: string[] = [];
                for (const player of state.players) {
                    for (const card of player.battlefield) {
                        if (!isDamageablePermanent(card)) continue;
                        if (matchesPermanentFilter(card, spec)) {
                            ids.push(card.id);
                        }
                    }
                }
                for (const id of ids) {
                    this.dealDamage({ type: "permanent", id }, amount);
                }
            }
            if (filter.players) {
                for (const player of state.players) {
                    this.dealDamage({ type: "player", id: player.id }, amount);
                }
            }
        },
        // Grants an activated ability to a player for a limited duration
        // (CR 113.1). The ability is stored as a reference — the template is
        // looked up at activation time via getCardById. Used by Channel.
        grantAbility(
            playerId: string,
            sourceCardId: string,
            abilityId: string,
            duration: "end-of-turn"
        ): void {
            state.nextGrantSeq = (state.nextGrantSeq ?? 0) + 1;
            const instance: GrantedAbilityInstance = {
                id: `grant-${state.nextGrantSeq}`,
                sourceCardId,
                abilityId,
                duration,
                grantedAtTurn: state.turn,
            };
            const player = getPlayer(state, playerId);
            player.grantedAbilities = [
                ...(player.grantedAbilities ?? []),
                instance,
            ];
        },
        // CR 500.7: extra turns are taken after the current turn. Multiple
        // extra turns created on the same turn stack LIFO — the last created
        // is the next taken. advanceTurn() pops from the end of the queue.
        takeExtraTurn(playerId: string): void {
            // Validate the target player exists (throws if not).
            getPlayer(state, playerId);
            state.extraTurns = [...(state.extraTurns ?? []), playerId];
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

/**
 * Draws the top card of a player's library to their hand (CR 121.1).
 * If the library is empty, marks hasDrawnFromEmpty (CR 704.5b) and returns null.
 */
export function drawCard(player: PlayerState): CardInstanceState | null {
    if (player.library.length === 0) {
        player.hasDrawnFromEmpty = true;
        return null;
    }
    return moveCard(player, player.library[0].id, "library", "hand");
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

    /** Returns the mana color a tapped source produces. Prefers chosenMana
     *  (set by tapUntap for choice-based abilities — e.g. dual lands and
     *  Birds of Paradise) so the correct color is matched against the cost.
     *  Falls back to intrinsic subtype mana or fixed activated ability. */
    const getManaColor = (card: CardInstanceState): string | null => {
        if (card.chosenMana) {
            for (const color of MANA_COLORS) {
                if (
                    ((card.chosenMana as Record<string, number>)[color] ?? 0) >
                    0
                ) {
                    return color;
                }
            }
        }
        return getBasicLandMana(card) ?? getActivatedManaColor(card);
    };

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

/** Converts a ManaCost (with possible string X) to a pure numeric record.
 *  When the raw cost has `X: "X"`, the caster's chosen X value is folded into
 *  the generic portion of the cost (CR 107.3, 601.2b). Additional generic mana
 *  from cost modifiers (e.g. Fireball's "+{1} per extra target", CR 601.2f) is
 *  added on top of the generic portion.
 */
export function normalizeManaCost(
    cost: ManaCost,
    opts: { chosenX?: number; additionalGeneric?: number } = {}
): Record<string, number> {
    const result: Record<string, number> = {};
    let extraGeneric = opts.additionalGeneric ?? 0;
    for (const [key, val] of Object.entries(cost)) {
        if (key === "X" && typeof val === "string") {
            extraGeneric += opts.chosenX ?? 0;
            continue;
        }
        const n = typeof val === "number" ? val : 0;
        if (n > 0) result[key] = n;
    }
    if (extraGeneric > 0) {
        result.X = (result.X ?? 0) + extraGeneric;
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

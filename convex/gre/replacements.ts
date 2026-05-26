// Replacement effects engine (CR 614 / 616).
//
// Replacement effects intercept a game event BEFORE the original action runs
// and either rewrite the event payload (damage redirected, lifegain converted
// to draw) or cancel the event entirely (Lich's "don't lose the game"). They
// are continuous effects active while their source is on the battlefield.
//
// Apply order at any damage / life-change / discard / lose-game site:
//   1. CR 614 replacement loop (this module)
//   2. CR 615 prevention shields (existing `consumePreventionIfAny` /
//      `applyTargetPrevention` in state.ts)
//   3. Original action runs against the (possibly rewritten) payload.
//
// CR 616.1d: a given replacement applies at most once per event. The loop
// tracks `(sourceInstanceId|effectId)` keys to honor that, and is bounded by
// a sanity cap (64 iterations) against pathological cycles. Player choice of
// replacement order (CR 616.1c) is currently deterministic — APNAP, then
// battlefield-declaration order. Adequate for the present LEA card set.

import type {
    CardType,
    Color,
    DamageReplacementEvent,
    DiscardReplacementEvent,
    LifeChangeReplacementEvent,
    LoseGameReplacementEvent,
    PermanentView,
    ReplacementApplyContext,
    ReplacementEffect,
    ReplacementEvent,
    ReplacementEventKind,
    ReplacementStateView,
} from "../cards/types";
import { tryGetCardById } from "../cards";
import { getColorsFromCost } from "../cards/colors";
import type {
    CardInstanceState,
    DamageRedirection,
    GameState,
    PlayerState,
} from "./state";
import {
    getPlayer,
    matchesPermanentFilter,
    moveCard,
    removePermanentTo,
} from "./state";

function collectReplacements(
    state: GameState,
    kind: ReplacementEventKind
): { source: CardInstanceState; effect: ReplacementEffect }[] {
    const active = state.players.find((p) => p.id === state.activePlayerId);
    const opponents = state.players.filter(
        (p) => p.id !== state.activePlayerId
    );
    const ordered = active ? [active, ...opponents] : state.players;

    const out: { source: CardInstanceState; effect: ReplacementEffect }[] = [];
    for (const player of ordered) {
        for (const card of player.battlefield) {
            const cardId = (card.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetCardById(cardId);
            const effects = def?.replacementEffects ?? [];
            for (const r of effects) {
                if (r.eventKind === kind) out.push({ source: card, effect: r });
            }
        }
    }
    return out;
}

function buildStateView(state: GameState): ReplacementStateView {
    let combat: ReplacementStateView["combat"];
    if (state.combat) {
        const blockersByAttacker: Record<string, string[]> = {};
        for (const id of state.combat.attackerIds) blockersByAttacker[id] = [];
        for (const [blockerId, attackerIds] of Object.entries(
            state.combat.blockerAssignments
        )) {
            for (const attackerId of attackerIds) {
                if (blockersByAttacker[attackerId])
                    blockersByAttacker[attackerId].push(blockerId);
            }
        }
        combat = {
            attackerIds: state.combat.attackerIds,
            blockersByAttacker,
        };
    }
    return {
        players: state.players.map((p) => ({
            id: p.id,
            life: p.life,
            handSize: p.hand.length,
            battlefield: p.battlefield.map((c) => ({
                id: c.id,
                controllerId: c.controllerId,
                ownerId: c.ownerId,
                types: c.types,
                subtypes: c.subtypes,
                staticAbilities: c.staticAbilities,
                isToken: c.isToken === true,
            })),
            preferences: state.playerPreferences?.[p.id],
        })),
        combat,
    };
}

function buildPermanentView(card: CardInstanceState): PermanentView {
    return {
        id: card.id,
        controllerId: card.controllerId,
        ownerId: card.ownerId,
        types: card.types,
        subtypes: card.subtypes,
        isTapped: card.isTapped,
        power: card.power,
        toughness: card.toughness,
        attachedTo: card.attachedTo,
        counters: card.counters,
        card: card.card as Record<string, unknown>,
    };
}

function buildApplyCtx(
    state: GameState,
    source: CardInstanceState
): ReplacementApplyContext {
    return {
        apNapOrder: () => {
            const active = state.activePlayerId;
            const others = state.players
                .filter((p) => p.id !== active)
                .map((p) => p.id);
            return [active, ...others];
        },
        drawCards: (playerId, amount) => {
            const player = getPlayer(state, playerId);
            for (let i = 0; i < amount; i++) {
                if (player.library.length === 0) {
                    player.hasDrawnFromEmpty = true;
                    return;
                }
                moveCard(player, player.library[0].id, "library", "hand");
            }
        },
        autoSacrifice: (playerId, count, filter) => {
            if (count <= 0) return 0;
            const player = getPlayer(state, playerId);
            const candidateIds: string[] = [];
            for (const c of player.battlefield) {
                if (c.isToken) continue;
                if (c.id === source.id) continue;
                if (filter && !matchesPermanentFilter(c, filter)) continue;
                candidateIds.push(c.id);
                if (candidateIds.length >= count) break;
            }
            for (const id of candidateIds) {
                removePermanentTo(state, id, "graveyard");
            }
            return candidateIds.length;
        },
        moveHandCardToLibraryTop: (playerId, cardInstanceId) => {
            const player: PlayerState = getPlayer(state, playerId);
            const idx = player.hand.findIndex((c) => c.id === cardInstanceId);
            if (idx === -1) return false;
            const [card] = player.hand.splice(idx, 1);
            card.zone = "library";
            // Top of library = index 0 (drawCard reads from index 0).
            player.library.unshift(card);
            return true;
        },
        revealHandCard: () => {
            // CR 701.15 reveal: publicly note the card's identity. Currently a
            // no-op for state — the replacement caller already inspects the
            // card via state, and the UI surfaces hand contents through the
            // game projection. A future event-log entry would land here.
        },
        adjustLifeRaw: (playerId, delta) => {
            getPlayer(state, playerId).life += delta;
        },
        removeCounter: (type, count) => {
            if (!source.counters) return 0;
            const current = source.counters[type] ?? 0;
            const removed = Math.min(current, count);
            if (removed <= 0) return 0;
            source.counters[type] = current - removed;
            if (source.counters[type] === 0) delete source.counters[type];
            return removed;
        },
        state: buildStateView(state),
        self: buildPermanentView(source),
    };
}

function applyReplacementsLoop(
    state: GameState,
    kind: ReplacementEventKind,
    initial: ReplacementEvent
): ReplacementEvent | null {
    let event = initial;
    const used = new Set<string>();
    for (let i = 0; i < 64; i++) {
        const candidates = collectReplacements(state, kind);
        let pick: {
            source: CardInstanceState;
            effect: ReplacementEffect;
        } | null = null;
        const stateView = buildStateView(state);
        for (const c of candidates) {
            const key = `${c.source.id}|${c.effect.id}`;
            if (used.has(key)) continue;
            const view = buildPermanentView(c.source);
            if (!c.effect.appliesTo(event, view, stateView)) continue;
            pick = c;
            break;
        }
        if (!pick) return event;
        used.add(`${pick.source.id}|${pick.effect.id}`);
        const ctx = buildApplyCtx(state, pick.source);
        const result = pick.effect.replace(event, ctx);
        if (result.kind === "consumed") return null;
        event = result.event;
    }
    return event;
}

export function applyDamageReplacements(
    state: GameState,
    event: DamageReplacementEvent
): DamageReplacementEvent | null {
    const result = applyReplacementsLoop(state, "damage", event);
    return result === null ? null : (result as DamageReplacementEvent);
}

/** Applies transient one-shot damage shields stored in
 *  `state.damageRedirections` (CR 614 — Reverse Damage / Jade Monolith /
 *  Personal Incarnation activated). Runs AFTER continuous replacements so a
 *  permanent-bound redirect (Veteran Bodyguard) gets first crack at the
 *  event. Each kind of shield is one-shot: consumed shields are spliced out
 *  of `state.damageRedirections`. Returns the (possibly rewritten) event,
 *  or null if a shield consumed the event entirely. */
export function applyTransientDamageRedirections(
    state: GameState,
    event: DamageReplacementEvent
): DamageReplacementEvent | null {
    const shields = state.damageRedirections;
    if (!shields || shields.length === 0) return event;
    const kept: DamageRedirection[] = [];
    let current = event;
    let consumed = false;
    for (let i = 0; i < shields.length; i++) {
        const sh = shields[i];
        if (consumed) {
            kept.push(sh);
            continue;
        }
        if (sh.kind === "prevent-from-source-gain-life") {
            if (
                current.target.type === "player" &&
                current.target.id === sh.playerId &&
                current.sourceInstanceId === sh.sourceInstanceId
            ) {
                // Reverse Damage: prevent the damage and gain life equal to
                // the amount that was prevented. The shield is one-shot.
                getPlayer(state, sh.playerId).life += current.amount;
                consumed = true;
                // splice this shield: do not push back
                continue;
            }
            kept.push(sh);
        } else if (sh.kind === "to-self-redirect-to-owner") {
            if (
                current.target.type === "permanent" &&
                current.target.id === sh.targetInstanceId &&
                sh.remaining > 0
            ) {
                const targetCard = findOnBattlefieldAnywhere(
                    state,
                    sh.targetInstanceId
                );
                if (!targetCard) {
                    kept.push(sh);
                    continue;
                }
                const ownerId = targetCard.ownerId;
                // Redirect this damage to the permanent's owner. Decrement
                // the shield's remaining count and keep it if it still has
                // charges (Personal Incarnation's "{0}: next 1 damage to
                // this creature" stacks one charge per activation).
                const absorb = Math.min(current.amount, sh.remaining);
                if (absorb >= current.amount) {
                    current = {
                        ...current,
                        target: { type: "player", id: ownerId },
                    };
                    if (sh.remaining - current.amount > 0) {
                        kept.push({
                            ...sh,
                            remaining: sh.remaining - current.amount,
                        });
                    }
                } else {
                    // Partial redirect: in current model we redirect the
                    // full amount when the shield has any charge — splitting
                    // a single damage event across both target and owner
                    // would require emitting two events. LEA scope keeps
                    // amounts compatible with sh.remaining = 1.
                    current = {
                        ...current,
                        target: { type: "player", id: ownerId },
                    };
                }
            } else {
                kept.push(sh);
            }
        } else if (sh.kind === "from-source-to-permanent-redirect-to-player") {
            const sourceMatches =
                sh.sourceInstanceId === undefined ||
                sh.sourceInstanceId === current.sourceInstanceId;
            if (
                sourceMatches &&
                current.target.type === "permanent" &&
                current.target.id === sh.targetInstanceId &&
                sh.remaining > 0
            ) {
                // Jade Monolith: redirect damage to a chosen player. Charges
                // decrement per match; keep the shield while still charged.
                current = {
                    ...current,
                    target: { type: "player", id: sh.redirectToPlayerId },
                };
                if (sh.remaining - 1 > 0) {
                    kept.push({ ...sh, remaining: sh.remaining - 1 });
                }
                continue;
            }
            kept.push(sh);
        }
    }
    state.damageRedirections = kept.length > 0 ? kept : undefined;
    return consumed ? null : current;
}

function findOnBattlefieldAnywhere(
    state: GameState,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const hit = p.battlefield.find((c) => c.id === instanceId);
        if (hit) return hit;
    }
    return undefined;
}

export function applyLifeChangeReplacements(
    state: GameState,
    event: LifeChangeReplacementEvent
): LifeChangeReplacementEvent | null {
    const kind = event.kind === "lifegain" ? "lifegain" : "lifeloss";
    const result = applyReplacementsLoop(state, kind, event);
    return result === null ? null : (result as LifeChangeReplacementEvent);
}

export function applyDiscardReplacements(
    state: GameState,
    event: DiscardReplacementEvent
): DiscardReplacementEvent | null {
    const result = applyReplacementsLoop(state, "discard", event);
    return result === null ? null : (result as DiscardReplacementEvent);
}

export function applyLoseGameReplacements(
    state: GameState,
    event: LoseGameReplacementEvent
): LoseGameReplacementEvent | null {
    const result = applyReplacementsLoop(state, "lose-game", event);
    return result === null ? null : (result as LoseGameReplacementEvent);
}

/** Public helper for resolving a damage source's identity at the moment a
 *  damage event is emitted. Used by `dealDamage` and combat damage paths to
 *  populate `DamageReplacementEvent.sourceColors / sourceTypes /
 *  sourceStaticAbilities` so source-filtering replacements (Veteran
 *  Bodyguard's "except damage from sources with flying") can read them, and
 *  by `DAMAGE_DEALT` event emitters for last-known-information snapshots
 *  consumed by damage trigger factories (CR 603.10). */
export function describeDamageSource(
    state: GameState,
    sourceInstanceId: string
): {
    colors: ReadonlyArray<Color>;
    types: ReadonlyArray<CardType>;
    subtypes: ReadonlyArray<string>;
    staticAbilities: ReadonlyArray<string>;
} {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.id !== sourceInstanceId) continue;
            const cardId = (card.card as { id?: string }).id;
            const def = cardId ? tryGetCardById(cardId) : null;
            const colors = def?.manaCost ? getColorsFromCost(def.manaCost) : [];
            return {
                colors,
                types: card.types,
                subtypes: card.subtypes,
                staticAbilities: card.staticAbilities,
            };
        }
    }
    const stackItem = state.stack.find((s) => s.id === sourceInstanceId);
    if (stackItem) {
        const cardId = (stackItem.card as { id?: string }).id;
        const def = cardId ? tryGetCardById(cardId) : null;
        const colors = def?.manaCost ? getColorsFromCost(def.manaCost) : [];
        return {
            colors,
            types: stackItem.types,
            subtypes: stackItem.subtypes,
            staticAbilities: stackItem.staticAbilities,
        };
    }
    return { colors: [], types: [], subtypes: [], staticAbilities: [] };
}

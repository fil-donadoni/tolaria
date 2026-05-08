import type { Phase } from "./types";
import type { GameEvent } from "../cards/types";
import type {
    CardInstanceState,
    DelayedTriggerInstance,
    GameState,
    StackItem,
} from "./state";
import {
    consumePreventionIfAny,
    drawCard,
    getOpponentId,
    getPlayer,
    regenerateOrDestroy,
    resolveTopOfStack,
    tickDuration,
} from "./state";
import { getEffectivePower, getEffectiveToughness } from "./layers";
import { isProtectedFromSource } from "./protection";
import { collectTriggers } from "./triggers";
import { hasAnyLegalBlock, getRequiredAttackerIds } from "./combat";

/** Ordered sequence of all phases/steps in a turn. */
const PHASE_ORDER: Phase[] = [
    "UNTAP",
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
    "POSTCOMBAT_MAIN",
    "END_STEP",
    "CLEANUP",
];

/** Which damage step a creature deals damage in (CR 510.2-510.5, 702.7). */
export type DamageKind = "first-strike" | "regular";

function hasFirstOrDoubleStrike(card: CardInstanceState): boolean {
    return (
        card.staticAbilities.includes("first strike") ||
        card.staticAbilities.includes("double strike")
    );
}

/** CR 510.5: A creature deals damage in the first-strike step iff it has
 *  first strike or double strike. It deals damage in the regular step iff
 *  it has no first strike, or it has double strike (which deals twice). */
function dealsDamageIn(card: CardInstanceState, kind: DamageKind): boolean {
    const fs = card.staticAbilities.includes("first strike");
    const ds = card.staticAbilities.includes("double strike");
    if (kind === "first-strike") return fs || ds;
    return !fs || ds;
}

/** CR 510.5: first-strike damage step is skipped if no attacker or blocker
 *  has first strike or double strike when the step would begin. */
function anyCombatantHasFirstOrDoubleStrike(state: GameState): boolean {
    if (!state.combat) return false;
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    for (const id of state.combat.attackerIds) {
        const c = activePlayer.battlefield.find((x) => x.id === id);
        if (c && hasFirstOrDoubleStrike(c)) return true;
    }
    for (const blockerId of Object.keys(state.combat.blockerAssignments)) {
        const c = defender.battlefield.find((x) => x.id === blockerId);
        if (c && hasFirstOrDoubleStrike(c)) return true;
    }
    return false;
}

/** Phases where no player receives priority (automatic). */
const AUTO_PHASES = new Set<Phase>(["UNTAP", "CLEANUP"]);

/** Returns the next phase after the given one, or null if end of turn (CLEANUP). */
function nextPhase(current: Phase): Phase | null {
    const idx = PHASE_ORDER.indexOf(current);
    if (idx === -1) throw new Error(`Unknown phase: ${current}`);
    if (idx === PHASE_ORDER.length - 1) return null;
    return PHASE_ORDER[idx + 1];
}

/** True if any permanent on either battlefield grants the given static
 *  ability (CR 611). Used by the untap step to apply Winter Orb-style
 *  global restrictions without hardcoding card ids. */
function hasGlobalStaticAbility(state: GameState, ability: string): boolean {
    for (const p of state.players) {
        for (const c of p.battlefield) {
            if (c.staticAbilities.includes(ability)) return true;
        }
    }
    return false;
}

/** True if the card has one of the types restricted by Winter Orb's
 *  "artifact, creature, or land" clause. */
function isAclPermanent(card: CardInstanceState): boolean {
    return (
        card.types.includes("Artifact") ||
        card.types.includes("Creature") ||
        card.types.includes("Land")
    );
}

/** Untap step: untap all permanents, clear committed/summoning sickness
 *  (CR 502.4). When any permanent grants the `limits-acl-untap` marker
 *  (Winter Orb / Static Orb), the active player's untap is capped at one
 *  artifact/creature/land total. Selection is deterministic — first tapped
 *  ACL in battlefield order — since UNTAP is an auto-phase with no priority
 *  window (CR 502.1). Non-ACL permanents untap normally. */
function untapStep(state: GameState): void {
    const player = getPlayer(state, state.activePlayerId);
    const aclLimited = hasGlobalStaticAbility(state, "limits-acl-untap");
    const chosenAclUntapId = aclLimited
        ? (player.battlefield.find((c) => c.isTapped && isAclPermanent(c))
              ?.id ?? null)
        : null;
    for (const card of player.battlefield) {
        if (
            aclLimited &&
            isAclPermanent(card) &&
            card.id !== chosenAclUntapId
        ) {
            // Blocked by Winter Orb — permanent stays tapped but stops
            // counting as "mana committed" so it can be played around at
            // sorcery speed next turn if the restriction lifts.
            continue;
        }
        card.isTapped = false;
        card.manaCommitted = undefined;
        card.isSummoningSick = undefined;
        card.chosenMana = undefined;
    }
}

/** Draw step: active player draws a card. Skipped on turn 1 (CR 103.8). */
function drawStep(state: GameState): void {
    if (state.turn === 1) return;
    drawCard(getPlayer(state, state.activePlayerId));
}

/** Inverts blockerAssignments (blockerId→attackerId) to attackerId→blockerId[]. */
function getBlockersPerAttacker(state: GameState): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    if (!state.combat) return result;
    for (const [blockerId, attackerId] of Object.entries(
        state.combat.blockerAssignments
    )) {
        if (!result[attackerId]) result[attackerId] = [];
        result[attackerId].push(blockerId);
    }
    return result;
}

function getCardPower(state: GameState, card: CardInstanceState): number {
    return Math.max(0, getEffectivePower(state, card));
}

function getCardToughness(state: GameState, card: CardInstanceState): number {
    return getEffectiveToughness(state, card);
}

/** Returns true if any attacker dealing damage in this step has 2+ blockers. */
function combatDamageNeedsManual(state: GameState, kind: DamageKind): boolean {
    if (!state.combat) return false;
    const activePlayer = getPlayer(state, state.activePlayerId);
    const blockersPerAttacker = getBlockersPerAttacker(state);
    for (const [attackerId, blockerIds] of Object.entries(
        blockersPerAttacker
    )) {
        if (blockerIds.length < 2) continue;
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        if (dealsDamageIn(attacker, kind)) return true;
    }
    return false;
}

/** Build auto damage assignments for attackers with 0 or 1 blocker. */
function buildAutoDamageAssignments(
    state: GameState,
    kind: DamageKind
): Record<string, Record<string, number>> {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const result: Record<string, Record<string, number>> = {};

    for (const attackerId of state.combat!.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        if (!dealsDamageIn(attacker, kind)) continue;
        const blockers = blockersPerAttacker[attackerId] ?? [];
        const hasTrample = attacker.staticAbilities.includes("trample");

        if (blockers.length === 1) {
            const blocker = defender.battlefield.find(
                (c) => c.id === blockers[0]
            );
            if (hasTrample && blocker) {
                // Trample: assign lethal damage to blocker, excess to defender
                const lethal = getCardToughness(state, blocker);
                const toBlocker = Math.min(
                    getCardPower(state, attacker),
                    lethal
                );
                const toDefender = getCardPower(state, attacker) - toBlocker;
                const assignment: Record<string, number> = {
                    [blockers[0]]: toBlocker,
                };
                if (toDefender > 0) {
                    assignment[defenderId] = toDefender;
                }
                result[attackerId] = assignment;
            } else {
                result[attackerId] = {
                    [blockers[0]]: getCardPower(state, attacker),
                };
            }
        }
        // 0 blockers = unblocked, handled separately in applyAllCombatDamage
    }
    return result;
}

/** Build default damage assignments for multi-blocker attackers.
 *  Uses blockerOrder for ordering. With trample, assigns lethal to each in order, excess to defender. */
function buildDefaultDamageAssignments(
    state: GameState,
    kind: DamageKind
): Record<string, Record<string, number>> {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const result: Record<string, Record<string, number>> = {};

    for (const attackerId of state.combat!.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        if (!dealsDamageIn(attacker, kind)) continue;
        // Use blockerOrder if available, fall back to blockersPerAttacker
        const blockers =
            state.combat!.blockerOrder?.[attackerId] ??
            blockersPerAttacker[attackerId] ??
            [];
        const hasTrample = attacker.staticAbilities.includes("trample");

        if (blockers.length === 1) {
            if (hasTrample) {
                const blocker = defender.battlefield.find(
                    (c) => c.id === blockers[0]
                );
                const lethal = blocker ? getCardToughness(state, blocker) : 0;
                const toBlocker = Math.min(
                    getCardPower(state, attacker),
                    lethal
                );
                const toDefender = getCardPower(state, attacker) - toBlocker;
                const assignment: Record<string, number> = {
                    [blockers[0]]: toBlocker,
                };
                if (toDefender > 0) assignment[defenderId] = toDefender;
                result[attackerId] = assignment;
            } else {
                result[attackerId] = {
                    [blockers[0]]: getCardPower(state, attacker),
                };
            }
        } else if (blockers.length >= 2) {
            const assignment: Record<string, number> = {};
            if (hasTrample) {
                // Default with trample: lethal to each in order, excess to defender
                let remaining = getCardPower(state, attacker);
                for (const blockerId of blockers) {
                    const blocker = defender.battlefield.find(
                        (c) => c.id === blockerId
                    );
                    const lethal = blocker
                        ? getCardToughness(state, blocker)
                        : 0;
                    const toThis = Math.min(remaining, lethal);
                    assignment[blockerId] = toThis;
                    remaining -= toThis;
                }
                if (remaining > 0) assignment[defenderId] = remaining;
            } else {
                // Default without trample: all damage to first blocker
                for (let i = 0; i < blockers.length; i++) {
                    assignment[blockers[i]] =
                        i === 0 ? getCardPower(state, attacker) : 0;
                }
            }
            result[attackerId] = assignment;
        }
    }
    return result;
}

/**
 * Apply combat damage for a single damage step and move dead creatures to
 * the graveyard. When `kind` is "first-strike" only creatures with first
 * strike or double strike deal damage (CR 510.2). When "regular", creatures
 * without first strike deal damage; creatures with double strike deal again
 * (CR 510.5).
 *
 * @param damageAssignments attackerId → { blockerId|defenderId: damage } — used
 *   only for multi-blocker attackers currently dealing damage in this step.
 */
export function applyAllCombatDamage(
    state: GameState,
    damageAssignments: Record<string, Record<string, number>>,
    kind: DamageKind = "regular"
): void {
    if (!state.combat) return;

    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const blockersPerAttacker = getBlockersPerAttacker(state);

    // Track damage received: cardId → total damage
    const damageReceived: Record<string, number> = {};
    const events: GameEvent[] = [];

    for (const attackerId of state.combat.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue; // removed before damage (e.g. killed by instant)

        const blockers = blockersPerAttacker[attackerId] ?? [];
        const attackerPower = getCardPower(state, attacker);
        const attackerDeals = dealsDamageIn(attacker, kind);

        if (blockers.length === 0) {
            // Unblocked: damage to defending player (only if attacker is active this step)
            if (attackerDeals && attackerPower > 0) {
                // CR 615.1: prevention effect consumes the damage fully.
                const prevented = consumePreventionIfAny(
                    state,
                    attacker.id,
                    defenderId
                );
                if (!prevented) {
                    defender.life -= attackerPower;
                    events.push({
                        type: "DAMAGE_DEALT",
                        sourceInstanceId: attacker.id,
                        sourceControllerId: attacker.controllerId,
                        target: { type: "player", id: defenderId },
                        amount: attackerPower,
                        isCombat: true,
                    });
                }
            }
        } else {
            // Blocked: the attacker distributes its damage only if it deals in this step
            if (attackerDeals) {
                const assignments = damageAssignments[attackerId] ?? {};
                for (const [targetId, damage] of Object.entries(assignments)) {
                    if (damage <= 0) continue;
                    if (targetId === defenderId) {
                        // Trample excess damage to defending player
                        // CR 615.1: prevention effect consumes the damage fully.
                        const prevented = consumePreventionIfAny(
                            state,
                            attacker.id,
                            defenderId
                        );
                        if (prevented) continue;
                        defender.life -= damage;
                        events.push({
                            type: "DAMAGE_DEALT",
                            sourceInstanceId: attacker.id,
                            sourceControllerId: attacker.controllerId,
                            target: { type: "player", id: defenderId },
                            amount: damage,
                            isCombat: true,
                        });
                    } else {
                        // CR 702.16e: damage from a source with the stated
                        // quality to a protected permanent is prevented.
                        const blockerCard = defender.battlefield.find(
                            (c) => c.id === targetId
                        );
                        if (
                            blockerCard &&
                            isProtectedFromSource(blockerCard, attacker)
                        ) {
                            continue;
                        }
                        damageReceived[targetId] =
                            (damageReceived[targetId] ?? 0) + damage;
                        events.push({
                            type: "DAMAGE_DEALT",
                            sourceInstanceId: attacker.id,
                            sourceControllerId: attacker.controllerId,
                            target: { type: "permanent", id: targetId },
                            amount: damage,
                            isCombat: true,
                        });
                    }
                }
            }

            // Blockers that deal damage in this step hit the attacker.
            for (const blockerId of blockers) {
                const blocker = defender.battlefield.find(
                    (c) => c.id === blockerId
                );
                if (!blocker) continue; // removed before damage
                if (!dealsDamageIn(blocker, kind)) continue;
                const blockerPower = getCardPower(state, blocker);
                if (blockerPower <= 0) continue;
                // CR 702.16e: prevent damage from a blocker whose color
                // matches the attacker's "protection from [color]". (The
                // symmetric "attacker protected from blocker's color can't
                // be blocked" case was rejected at block-declaration.)
                if (isProtectedFromSource(attacker, blocker)) continue;
                damageReceived[attackerId] =
                    (damageReceived[attackerId] ?? 0) + blockerPower;
                events.push({
                    type: "DAMAGE_DEALT",
                    sourceInstanceId: blocker.id,
                    sourceControllerId: blocker.controllerId,
                    target: { type: "permanent", id: attackerId },
                    amount: blockerPower,
                    isCombat: true,
                });
            }
        }
    }

    // CR 120.3: record which sources dealt damage to each victim this turn.
    // Preserved through CLEANUP (CR 514.2) so post-death lookup triggers
    // (Sengir Vampire) can inspect the victim after it leaves the battlefield.
    for (const ev of events) {
        if (ev.type !== "DAMAGE_DEALT") continue;
        if (ev.target.type !== "permanent") continue;
        const hit =
            activePlayer.battlefield.find((c) => c.id === ev.target.id) ??
            defender.battlefield.find((c) => c.id === ev.target.id);
        if (!hit) continue;
        hit.damagedBySources = [
            ...(hit.damagedBySources ?? []),
            ev.sourceInstanceId,
        ];
    }

    // CR 120.3: accumulate combat damage onto the creature's marked damage,
    // then check CR 704.5g lethal against effective toughness (layer 7c).
    const deadIds = new Set<string>();
    for (const [cardId, damage] of Object.entries(damageReceived)) {
        const card =
            activePlayer.battlefield.find((c) => c.id === cardId) ??
            defender.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        card.damageMarked = (card.damageMarked ?? 0) + damage;
        if (card.damageMarked >= getCardToughness(state, card)) {
            deadIds.add(cardId);
        }
    }

    // Move dead creatures to their owner's graveyard, emitting CREATURE_DIED
    // (CR 700.4) so "whenever another creature dies" triggers can fire in the
    // same collectTriggers pass as the combat DAMAGE_DEALT events. Each
    // victim is routed through regenerateOrDestroy (CR 614.5, 701.15a) so a
    // regen shield can replace the destroy with the heal/tap/leave-combat
    // rider — those creatures stay on the battlefield and don't fire
    // CREATURE_DIED.
    for (const cardId of deadIds) {
        const carrier =
            activePlayer.battlefield.find((c) => c.id === cardId) ??
            defender.battlefield.find((c) => c.id === cardId);
        if (!carrier) continue;
        const snapshot = {
            controllerId: carrier.controllerId,
            damagedBySources: carrier.damagedBySources ?? [],
        };
        const wasDestroyed = regenerateOrDestroy(state, cardId);
        if (!wasDestroyed) continue;
        // The destroyed card has already been moved to its owner's graveyard
        // by removePermanentTo. Reset combat-only flags on the dead instance
        // for parity with the prior implementation.
        carrier.isAttacking = undefined;
        carrier.isBlocking = undefined;
        carrier.isTapped = false;
        events.push({
            type: "CREATURE_DIED",
            creatureInstanceId: cardId,
            creatureControllerId: snapshot.controllerId,
            damagedBySources: snapshot.damagedBySources,
        });
    }

    // Collect triggered abilities fired by this damage step (CR 603.2). Dead
    // permanents are already gone, so their own triggers are skipped — that's
    // not strictly CR-correct for LTB/"when ~ dies" triggers, but those are
    // out of scope here.
    const triggers = collectTriggers(state, events);
    if (triggers.length > 0) {
        state.stack.push(...triggers);
        // Active player gets priority again with triggers on the stack (CR 117.3c).
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Emits a PHASE_BEGIN event for the current phase, collects matching
 *  triggered abilities from all battlefield permanents (CR 603.6a), pushes
 *  them on the stack, and restarts priority at the active player (CR 117.3c).
 *  No-op when the scan yields no triggers. Intervening-if conditions are
 *  the card's responsibility inside `matches()` (CR 603.4). */
function firePhaseBeginTriggers(state: GameState): void {
    const event: GameEvent = {
        type: "PHASE_BEGIN",
        phase: state.phase,
        activePlayerId: state.activePlayerId,
    };
    const triggers = collectTriggers(state, [event]);
    if (triggers.length === 0) return;
    state.stack.push(...triggers);
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
}

/** Dequeue delayed triggers matching `timing`, push them on the stack as
 *  StackItems, and restart priority at the active player (CR 603.3, 603.7a).
 *  Controller-as-APNAP ordering isn't implemented — triggers fire in
 *  scheduling order. */
function fireDelayedTriggers(
    state: GameState,
    timing: DelayedTriggerInstance["timing"]
): void {
    if (!state.delayedTriggers?.length) return;
    const firing: DelayedTriggerInstance[] = [];
    const remaining: DelayedTriggerInstance[] = [];
    for (const t of state.delayedTriggers) {
        (t.timing === timing ? firing : remaining).push(t);
    }
    state.delayedTriggers = remaining.length > 0 ? remaining : undefined;
    if (firing.length === 0) return;
    for (const t of firing) {
        const stackItem: StackItem = {
            id: crypto.randomUUID(),
            card: { id: t.sourceCardId },
            controllerId: t.controller,
            ownerId: t.controller,
            zone: "stack",
            types: [],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            castById: t.controller,
            delayedTriggerId: t.triggerId,
            delayedPayload: t.payload,
        };
        state.stack.push(stackItem);
    }
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
}

/** Perform automatic entry actions for the current phase. */
function performPhaseEntry(state: GameState): void {
    switch (state.phase) {
        case "UNTAP":
            untapStep(state);
            break;
        case "DRAW":
            drawStep(state);
            break;
        case "DECLARE_ATTACKERS":
            state.combat = {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            };
            break;
        case "DECLARE_BLOCKERS": {
            if (state.combat) {
                state.combat.blockerAssignments = {};
                state.combat.pendingBlockerId = undefined;
                state.combat.blockersConfirmed = false;
            }
            break;
        }
        case "FIRST_STRIKE_DAMAGE":
        case "COMBAT_DAMAGE": {
            if (state.combat && state.combat.attackerIds.length > 0) {
                const kind: DamageKind =
                    state.phase === "FIRST_STRIKE_DAMAGE"
                        ? "first-strike"
                        : "regular";
                const needsManual = combatDamageNeedsManual(state, kind);
                if (needsManual) {
                    // Pre-fill default assignments and wait for active player
                    state.combat.damageAssignments =
                        buildDefaultDamageAssignments(state, kind);
                    state.combat.damageConfirmed = false;
                } else {
                    // All auto: apply immediately
                    applyAllCombatDamage(
                        state,
                        buildAutoDamageAssignments(state, kind),
                        kind
                    );
                }
            }
            break;
        }
        case "END_OF_COMBAT": {
            if (state.combat) {
                const activePlayer = getPlayer(state, state.activePlayerId);
                const defenderId = getOpponentId(state, state.activePlayerId);
                const defender = getPlayer(state, defenderId);
                for (const card of activePlayer.battlefield) {
                    card.isAttacking = undefined;
                }
                for (const card of defender.battlefield) {
                    card.isBlocking = undefined;
                }
                state.combat = undefined;
            }
            // CR 511.3 — "until end of combat" effects end here.
            tickAllDurations(state);
            break;
        }
        case "END_STEP": {
            fireDelayedTriggers(state, "next-end-step");
            break;
        }
        case "CLEANUP":
            // CR 514.2 — "until end of turn" effects end at the cleanup step.
            tickAllDurations(state);
            // CR 514.2 — marked damage is removed from all permanents, and
            // turn-scoped combat flags are cleared.
            for (const p of state.players) {
                for (const card of p.battlefield) {
                    if (card.damageMarked !== undefined) {
                        card.damageMarked = undefined;
                    }
                    if (card.hasAttackedThisTurn) {
                        card.hasAttackedThisTurn = undefined;
                    }
                    if (card.damagedBySources !== undefined) {
                        card.damagedBySources = undefined;
                    }
                    // CR 701.15a — regeneration shields apply only "this turn".
                    // Unused shields wear off here.
                    if (card.regenerationShields !== undefined) {
                        card.regenerationShields = undefined;
                    }
                }
            }
            // TODO: hand size check (CR 514.1).
            break;
    }
}

/** Advances all parametric durations on the current game state by one
 *  phase-boundary tick. Called from END_OF_COMBAT (CR 511.3) and CLEANUP
 *  (CR 514.2); `tickDuration` itself filters by phase+playerId so entries
 *  scoped to a different boundary are left untouched. */
function tickAllDurations(state: GameState): void {
    const view = { phase: state.phase, activePlayerId: state.activePlayerId };

    // Player-granted activated abilities (e.g. Channel).
    for (const p of state.players) {
        if (!p.grantedAbilities?.length) continue;
        const kept: typeof p.grantedAbilities = [];
        for (const grant of p.grantedAbilities) {
            const next = tickDuration(grant.duration, view);
            if (next !== null) kept.push({ ...grant, duration: next });
        }
        p.grantedAbilities = kept.length > 0 ? kept : undefined;
    }

    // Granted static keywords (e.g. Berserk's trample). On expiry, splice
    // one occurrence out of `staticAbilities` so natively-declared
    // duplicates are left untouched (CR 113.1). Aura-sourced grants have
    // no duration — they're managed by the aura's lifetime (see
    // applyAuraStaticEffects / unapplyAuraStaticEffects in state.ts) and
    // pass through this purge unchanged.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.grantedStaticAbilities?.length) continue;
            const kept: typeof card.grantedStaticAbilities = [];
            for (const grant of card.grantedStaticAbilities) {
                if (!grant.duration) {
                    kept.push(grant);
                    continue;
                }
                const next = tickDuration(grant.duration, view);
                if (next === null) {
                    const idx = card.staticAbilities.indexOf(grant.ability);
                    if (idx !== -1) {
                        card.staticAbilities = [
                            ...card.staticAbilities.slice(0, idx),
                            ...card.staticAbilities.slice(idx + 1),
                        ];
                    }
                } else {
                    kept.push({ ...grant, duration: next });
                }
            }
            card.grantedStaticAbilities = kept.length > 0 ? kept : undefined;
        }
    }

    // One-shot prevention effects (e.g. Circle of Protection). An effect
    // that hasn't been consumed by the time its duration expires simply
    // wears off.
    if (state.preventionEffects?.length) {
        const kept: typeof state.preventionEffects = [];
        for (const effect of state.preventionEffects) {
            const next = tickDuration(effect.duration, view);
            if (next !== null) kept.push({ ...effect, duration: next });
        }
        state.preventionEffects = kept.length > 0 ? kept : undefined;
    }

    // "Becomes a creature" animations (e.g. Jade Statue). On expiry, splice
    // back out anything the animation added and restore the pre-animation
    // P/T so the permanent returns to its original shape.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.animation) continue;
            const next = tickDuration(card.animation.duration, view);
            if (next === null) {
                revertAnimation(card);
            } else {
                card.animation = { ...card.animation, duration: next };
            }
        }
    }
}

/** Undoes the mutations applied by `animateAsCreature`, restoring the
 *  permanent to its pre-animation shape. Safe to call only on a card whose
 *  `animation` field is set (caller checks). */
function revertAnimation(card: CardInstanceState): void {
    const anim = card.animation;
    if (!anim) return;
    if (anim.addedSubtype !== undefined) {
        const idx = card.subtypes.indexOf(anim.addedSubtype);
        if (idx !== -1) {
            card.subtypes = [
                ...card.subtypes.slice(0, idx),
                ...card.subtypes.slice(idx + 1),
            ];
        }
    }
    if (anim.addedCreatureType) {
        const idx = card.types.indexOf("Creature");
        if (idx !== -1) {
            card.types = [
                ...card.types.slice(0, idx),
                ...card.types.slice(idx + 1),
            ];
        }
    }
    card.power = anim.savedPower;
    card.toughness = anim.savedToughness;
    card.animation = undefined;
    // CR 704.5g: damage marked on a permanent that's no longer a creature
    // is irrelevant but harmless — cleared at CLEANUP regardless.
}

/** Advance turn: increment counter, swap active player, reset autoPass.
 *  CR 500.7: if an extra turn is queued, the next active player is the one
 *  at the end of the queue (LIFO) instead of the normal turn-order swap. */
function advanceTurn(state: GameState): void {
    state.turn += 1;
    if (state.extraTurns && state.extraTurns.length > 0) {
        const nextActive = state.extraTurns[state.extraTurns.length - 1];
        state.extraTurns = state.extraTurns.slice(0, -1);
        if (state.extraTurns.length === 0) state.extraTurns = undefined;
        state.activePlayerId = nextActive;
    } else {
        state.activePlayerId = getOpponentId(state, state.activePlayerId);
    }
    state.autoPassPlayers = undefined;
    state.singleShotAutoPass = undefined;
    // CR 117.2c / 305.2: reset per-turn land drop count at the start of each turn.
    for (const p of state.players) p.landsPlayedThisTurn = 0;
}

/**
 * Advance the game to the next phase/step.
 * Called when both players pass priority with an empty stack.
 * Auto-phases (UNTAP, CLEANUP) are traversed without giving priority.
 * Returns the list of phases traversed (for event emission).
 */
/** Empty mana pools for all players (CR 500.4). Tapped lands become committed (non-untappable until untap step). */
function emptyManaPools(state: GameState): void {
    for (const player of state.players) {
        for (const color of Object.keys(player.manaPool)) {
            player.manaPool[color] = 0;
        }
        for (const card of player.battlefield) {
            if (card.isTapped) {
                card.manaCommitted = true;
            }
        }
    }
}

function defenderHasAnyLegalBlock(state: GameState): boolean {
    if (!state.combat) return false;
    const defenderId = getOpponentId(state, state.activePlayerId);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const attackers: CardInstanceState[] = [];
    for (const id of state.combat.attackerIds) {
        const card = activePlayer.battlefield.find((c) => c.id === id);
        if (card) attackers.push(card);
    }
    return hasAnyLegalBlock(attackers, defender.battlefield);
}

export function advancePhase(state: GameState): Phase[] {
    const traversed: Phase[] = [];

    // CR 500.4: mana pools empty when a step or phase ends
    emptyManaPools(state);

    const next = nextPhase(state.phase);

    if (next === null) {
        // End of turn → advance to next turn
        advanceTurn(state);
        state.phase = "UNTAP";
    } else {
        state.phase = next;
    }

    traversed.push(state.phase);

    // Check combat state before entry actions (END_OF_COMBAT clears it)
    const hadAttackers = !!state.combat && state.combat.attackerIds.length > 0;
    performPhaseEntry(state);

    // CR 603.6a: fire "at the beginning of ~" triggers after the step's
    // turn-based actions. Skipped on auto-phases (UNTAP/CLEANUP) which don't
    // grant priority — triggers scoped to those steps are out of scope for
    // now and would need to be held until the next priority window.
    if (!AUTO_PHASES.has(state.phase)) {
        firePhaseBeginTriggers(state);
    }

    const skipEmptyCombat =
        (state.phase === "DECLARE_BLOCKERS" ||
            state.phase === "FIRST_STRIKE_DAMAGE" ||
            state.phase === "COMBAT_DAMAGE" ||
            state.phase === "END_OF_COMBAT") &&
        !hadAttackers;

    // Auto-skip DECLARE_BLOCKERS when every declared attacker is unblockable
    // (e.g. flying with no reach defender, or landwalk on a matching land —
    // CR 702.9, 702.13). Matches the UX where the defender has no legal
    // target to assign, avoiding a dead-end priority window.
    const skipUnblockableCombat =
        state.phase === "DECLARE_BLOCKERS" &&
        hadAttackers &&
        !!state.combat &&
        !defenderHasAnyLegalBlock(state);
    if (skipUnblockableCombat && state.combat) {
        state.combat.blockersConfirmed = true;
        state.combat.blockerOrder = {};
        state.combat.blockerOrderConfirmed = true;
    }

    // CR 510.5: skip the first-strike damage step when no combatant has
    // first strike or double strike.
    const skipFirstStrikeDamage =
        state.phase === "FIRST_STRIKE_DAMAGE" &&
        hadAttackers &&
        !anyCombatantHasFirstOrDoubleStrike(state);

    if (
        AUTO_PHASES.has(state.phase) ||
        skipEmptyCombat ||
        skipUnblockableCombat ||
        skipFirstStrikeDamage
    ) {
        // Auto-phase or empty combat: skip straight through (no priority given)
        traversed.push(...advancePhase(state));
    } else {
        // Priority phase: active player gets priority
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }

    return traversed;
}

/**
 * Drain auto-passes: while the current priority holder is in autoPassPlayers,
 * simulate their pass. Handles both stack resolution and phase advancement.
 * Stops when priority lands on a non-auto-pass player or a new turn begins
 * (which clears autoPassPlayers).
 */
export function drainAutoPasses(state: GameState): void {
    const maxIterations = 50; // safety bound
    for (let i = 0; i < maxIterations; i++) {
        const autoPass = state.autoPassPlayers ?? [];
        const singleShot = state.singleShotAutoPass === state.priorityPlayerId;
        if (!autoPass.includes(state.priorityPlayerId) && !singleShot) break;
        if (singleShot) state.singleShotAutoPass = undefined;

        // Auto-confirm attackers with current selection when auto-passing
        if (
            state.phase === "DECLARE_ATTACKERS" &&
            state.combat &&
            !state.combat.confirmed
        ) {
            const activePlayer = getPlayer(state, state.activePlayerId);
            // CR 508.1d: fold in any eligible creature required to attack.
            for (const requiredId of getRequiredAttackerIds(
                activePlayer.battlefield
            )) {
                if (!state.combat.attackerIds.includes(requiredId)) {
                    state.combat.attackerIds.push(requiredId);
                }
            }
            for (const attackerId of state.combat.attackerIds) {
                const card = activePlayer.battlefield.find(
                    (c) => c.id === attackerId
                );
                if (card) {
                    if (!card.staticAbilities.includes("vigilance")) {
                        card.isTapped = true;
                    }
                    card.isAttacking = true;
                    card.hasAttackedThisTurn = true;
                }
            }
            state.combat.confirmed = true;
            state.combat.blockerAssignments = {};
            state.combat.blockersConfirmed = false;
        }

        // Auto-confirm blockers when defending player auto-passes
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            !state.combat.blockersConfirmed
        ) {
            const defenderId = getOpponentId(state, state.activePlayerId);
            const defender = getPlayer(state, defenderId);
            for (const blockerId of Object.keys(
                state.combat.blockerAssignments
            )) {
                const card = defender.battlefield.find(
                    (c) => c.id === blockerId
                );
                if (card) card.isBlocking = true;
            }
            state.combat.pendingBlockerId = undefined;
            state.combat.blockersConfirmed = true;

            // Initialize blocker order (same logic as confirmBlockers)
            const blockerOrder: Record<string, string[]> = {};
            for (const [blockerId, attackerId] of Object.entries(
                state.combat.blockerAssignments
            )) {
                if (!blockerOrder[attackerId]) blockerOrder[attackerId] = [];
                blockerOrder[attackerId].push(blockerId);
            }
            state.combat.blockerOrder = blockerOrder;
            // Auto-confirm order (no multi-block reordering during auto-pass)
            state.combat.blockerOrderConfirmed = true;
        }

        // Auto-confirm blocker order when attacking player auto-passes
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            state.combat.blockerOrderConfirmed === false
        ) {
            state.combat.blockerOrderConfirmed = true;
        }

        // Auto-confirm damage assignment when active player auto-passes
        if (
            (state.phase === "FIRST_STRIKE_DAMAGE" ||
                state.phase === "COMBAT_DAMAGE") &&
            state.combat &&
            state.combat.damageConfirmed === false
        ) {
            const kind: DamageKind =
                state.phase === "FIRST_STRIKE_DAMAGE"
                    ? "first-strike"
                    : "regular";
            applyAllCombatDamage(
                state,
                state.combat.damageAssignments ?? {},
                kind
            );
            state.combat.damageConfirmed = true;
        }

        state.passCount += 1;

        if (state.passCount >= 2 && state.stack.length > 0) {
            resolveTopOfStack(state);
            if ((state.pendingChoices?.length ?? 0) > 0) {
                // Resolution suspended on a pending choice (CR 608.2) —
                // priority moves to the chooser and auto-drain stops;
                // selectResolutionChoice will resume from here.
                state.priorityPlayerId = state.pendingChoices![0].playerId;
                return;
            }
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
        } else if (state.passCount >= 2 && state.stack.length === 0) {
            advancePhase(state);
            // advanceTurn clears autoPassPlayers, so the loop will exit naturally
        } else {
            state.priorityPlayerId = getOpponentId(
                state,
                state.priorityPlayerId
            );
        }
    }
}

/** Returns true if sorcery-speed actions are legal (main phase, empty stack, active player has priority). */
export function isSorceryTiming(state: GameState): boolean {
    return (
        (state.phase === "PRECOMBAT_MAIN" ||
            state.phase === "POSTCOMBAT_MAIN") &&
        state.stack.length === 0 &&
        state.priorityPlayerId === state.activePlayerId
    );
}

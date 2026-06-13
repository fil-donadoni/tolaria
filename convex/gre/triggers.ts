// Trigger scan and stack push (CR 603).
//
// Flow: the engine applies a game action that emits one or more `GameEvent`s,
// then calls `collectTriggers` which returns one StackItem per (permanent,
// ability, event) match. Caller appends them to the stack and restarts
// priority from the active player.
//
// APNAP ordering (CR 603.3b) is out of scope for now — this implementation
// iterates the active player's permanents first, then the opponent's, in
// battlefield-declaration order. That's deterministic but not the rules-
// correct ordering for controlled simultaneous triggers.

import type { GameEvent, StateCheckEvent } from "../cards/types";
import { tryGetCardById } from "../cards";
import type { CardInstanceState, GameState, StackItem } from "./state";
import { getPlayer, allocInstanceId } from "./state";

/** Builds a StackItem representing a triggered ability on the stack. */
function buildTriggerItem(
    state: GameState,
    self: CardInstanceState,
    triggeredAbilityId: string,
    event: GameEvent
): StackItem {
    return {
        ...self,
        id: allocInstanceId(state),
        zone: "stack",
        castById: self.controllerId,
        triggeredAbilityId,
        triggerSourceId: self.id,
        triggerEvent: event,
    };
}

/** Scans all battlefield permanents for triggered abilities matching `events`.
 *  Returns new StackItems in the order they should be placed on the stack.
 *
 *  CR 603.10: a triggered ability fires based on whether the source had the
 *  ability when the trigger condition arose, even if the source has since
 *  left the battlefield (e.g. Fungusaur taking lethal damage — its
 *  "is dealt damage" trigger should still go on the stack). To honor that,
 *  we also scan creatures that died in this same trigger batch (their ids
 *  are carried in CREATURE_DIED events) by looking them up in the relevant
 *  player's graveyard. The trigger lands on the stack and resolves with
 *  last-known information; effect primitives that target a non-battlefield
 *  permanent simply no-op. */
export function collectTriggers(
    state: GameState,
    events: GameEvent[]
): StackItem[] {
    if (events.length === 0) return [];

    const active = getPlayer(state, state.activePlayerId);
    const opponents = state.players.filter(
        (p) => p.id !== state.activePlayerId
    );
    const ordered = [active, ...opponents];

    const recentlyDead = new Set<string>();
    // CR 603.10 — PERMANENT_LEFT triggers on the leaving permanent itself
    // ("when this Aura leaves the battlefield, ...") need to find the source
    // in its destination zone. Track (instanceId → toZone) so we know which
    // zone to scan for each id.
    const recentlyLeft = new Map<
        string,
        "graveyard" | "exile" | "hand" | "library"
    >();
    for (const ev of events) {
        if (ev.type === "CREATURE_DIED") {
            recentlyDead.add(ev.creatureInstanceId);
        } else if (ev.type === "PERMANENT_LEFT") {
            recentlyLeft.set(ev.instanceId, ev.toZone);
        }
    }

    const out: StackItem[] = [];
    for (const player of ordered) {
        const sources: CardInstanceState[] = [...player.battlefield];
        if (recentlyDead.size > 0) {
            for (const c of player.graveyard) {
                if (recentlyDead.has(c.id)) sources.push(c);
            }
        }
        if (recentlyLeft.size > 0) {
            // CR 603.10 last-known-information: the leaving permanent has
            // already been moved to its destination zone. Scan each zone
            // referenced by recentlyLeft.toZone so an aura that just hit
            // the graveyard can still place its LTB-trigger on the stack.
            const visitedIds = new Set<string>();
            for (const [id, zone] of recentlyLeft) {
                if (visitedIds.has(id)) continue;
                const pile =
                    zone === "graveyard"
                        ? player.graveyard
                        : zone === "exile"
                          ? player.exile
                          : zone === "hand"
                            ? player.hand
                            : player.library;
                for (const c of pile) {
                    if (c.id === id && !sources.includes(c)) {
                        sources.push(c);
                        visitedIds.add(id);
                        break;
                    }
                }
            }
        }
        for (const permanent of sources) {
            const cardId = (permanent.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetCardById(cardId);
            const abilities = def?.triggeredAbilities;
            if (!abilities || abilities.length === 0) continue;
            for (const ability of abilities) {
                // Battlefield-zone abilities only here; graveyard-zone
                // abilities (zone: "graveyard") are scanned separately below.
                if (ability.zone) continue;
                for (const event of events) {
                    if (event.type !== ability.event) continue;
                    if (!ability.matches(event, permanent, state)) continue;
                    out.push(
                        buildTriggerItem(state, permanent, ability.id, event)
                    );
                }
            }
        }
    }

    // CR 603.6e — abilities that function while the source is in the
    // graveyard (Nether Shadow's upkeep self-reanimation). Scanned only for
    // abilities explicitly opted in via `zone: "graveyard"`. The trigger's
    // `matches`/`interveningIf` inspects card position via `TriggerStateView`.
    for (const player of ordered) {
        for (const card of player.graveyard) {
            const cardId = (card.card as { id?: string }).id;
            if (!cardId) continue;
            const abilities = tryGetCardById(cardId)?.triggeredAbilities;
            if (!abilities || abilities.length === 0) continue;
            for (const ability of abilities) {
                if (ability.zone !== "graveyard") continue;
                for (const event of events) {
                    if (event.type !== ability.event) continue;
                    if (!ability.matches(event, card, state)) continue;
                    out.push(buildTriggerItem(state, card, ability.id, event));
                }
            }
        }
    }
    return out;
}

/** True if a state trigger from `(sourceInstanceId, abilityId)` is currently
 *  on the stack. CR 603.8 — a state-triggered ability does not trigger again
 *  until it has resolved, been countered, or otherwise left the stack. */
function stateTriggerAlreadyOnStack(
    state: GameState,
    sourceInstanceId: string,
    abilityId: string
): boolean {
    return state.stack.some(
        (item) =>
            item.triggerSourceId === sourceInstanceId &&
            item.triggeredAbilityId === abilityId &&
            item.triggerEvent?.type === "STATE_CHECK"
    );
}

/** Scans all battlefield permanents for state-triggered abilities (CR 603.8)
 *  whose persistent condition is currently met. Skips abilities whose trigger
 *  is already on the stack to satisfy the no-retrigger clause of CR 603.8. */
export function collectStateTriggers(state: GameState): StackItem[] {
    const event: StateCheckEvent = { type: "STATE_CHECK" };
    const active = getPlayer(state, state.activePlayerId);
    const opponents = state.players.filter(
        (p) => p.id !== state.activePlayerId
    );
    const ordered = [active, ...opponents];

    const out: StackItem[] = [];
    for (const player of ordered) {
        for (const permanent of player.battlefield) {
            const cardId = (permanent.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetCardById(cardId);
            const abilities = def?.triggeredAbilities;
            if (!abilities || abilities.length === 0) continue;
            for (const ability of abilities) {
                if (ability.event !== "STATE_CHECK") continue;
                if (stateTriggerAlreadyOnStack(state, permanent.id, ability.id))
                    continue;
                if (!ability.matches(event, permanent, state)) continue;
                out.push(buildTriggerItem(state, permanent, ability.id, event));
            }
        }
    }
    return out;
}

/** Pushes any newly-triggered state abilities onto the stack and restarts
 *  priority at the active player (CR 117.3c). Called from the stable
 *  checkpoint that follows SBA evaluation (CR 117.5). */
export function applyStateTriggers(state: GameState): boolean {
    const triggers = collectStateTriggers(state);
    if (triggers.length === 0) return false;
    state.stack.push(...triggers);
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    return true;
}

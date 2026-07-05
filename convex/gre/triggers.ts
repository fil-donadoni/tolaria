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
import { tryGetDefinition } from "../cards";
import type {
    CardInstanceState,
    DelayedTriggerInstance,
    GameState,
    StackItem,
} from "./state";
import { getPlayer, allocInstanceId } from "./state";
import { effectiveTriggeredAbilities } from "./copy";

/** Builds the StackItem a fired delayed triggered ability resolves from (CR
 *  603.7a, ADR 0048). Shared by the phase-boundary fire path
 *  (`fireDelayedTriggers`, phases.ts) and the instance leave-watch fire path
 *  (`collectTriggers`, issue #731): an INLINE-body instance carries its Effect
 *  Script + payload onto the stack item, so resolution needs no card-def
 *  lookup. */
export function buildDelayedTriggerStackItem(
    state: GameState,
    t: DelayedTriggerInstance
): StackItem {
    return {
        id: allocInstanceId(state),
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
        // ADR 0048 — an inline-body instance carries its Effect Script onto the
        // stack item, so resolution needs no card-def lookup.
        ...(t.effects ? { delayedEffects: t.effects } : {}),
    };
}

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
        // CR 603.3d — a triggered ability's targets are chosen when it is put
        // on the stack, not inherited from the source permanent. The `...self`
        // spread copies the source's stale `targets` (e.g. an Aura still
        // carries the `graveyard-card` target from when it was cast); drop it
        // so the resolution-time legality gate (CR 608.2b) doesn't fizzle the
        // trigger against a target that was never its own. Targeted triggers
        // set their own `targets` after this builder runs.
        targets: undefined,
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
            // CR 707.9d — includes abilities retained through a copy effect
            // (Vesuvan Doppelganger's upkeep re-copy).
            const abilities = effectiveTriggeredAbilities(permanent);
            if (abilities.length === 0) continue;
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
            const abilities = tryGetDefinition(cardId)?.triggeredAbilities;
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

    // CR 603.7a / 603.10 (issue #731) — instance leave-watch delayed triggers.
    // A `timing: "leaves-battlefield"` delayed trigger fires when its watched
    // instance leaves the battlefield ("when THAT creature leaves the
    // battlefield this turn, …"). Match each pending watch against the
    // PERMANENT_LEFT ids in this same event batch, push the matched triggers
    // onto the stack (as delayed-trigger StackItems, resolved through the
    // inline-body path), and remove the fired instances from the pending list
    // so they can't fire twice. recentlyLeft is the set of ids that just left.
    if (state.delayedTriggers?.length && recentlyLeft.size > 0) {
        const remaining: DelayedTriggerInstance[] = [];
        for (const t of state.delayedTriggers) {
            const fires =
                t.timing === "leaves-battlefield" &&
                t.watchInstanceId !== undefined &&
                recentlyLeft.has(t.watchInstanceId);
            if (fires) {
                out.push(buildDelayedTriggerStackItem(state, t));
            } else {
                remaining.push(t);
            }
        }
        state.delayedTriggers = remaining.length > 0 ? remaining : undefined;
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
            const abilities = effectiveTriggeredAbilities(permanent);
            if (abilities.length === 0) continue;
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

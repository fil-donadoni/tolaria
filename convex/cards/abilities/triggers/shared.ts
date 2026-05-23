// Helpers shared by the damage trigger factories (CR 120.3 / 603.10).
//
// Both `damageDealtTrigger` and `damageTakenTrigger` listen to the same
// `DAMAGE_DEALT` event; they differ only in which side of the event the
// scope/filter gates on. These helpers centralise the wire-up so the two
// factories stay symmetric and don't drift.

import type {
    CardType,
    Color,
    DamageDealtEvent,
    PermanentView,
    TargetSelection,
    TriggerStateView,
} from "../../types";
import type {
    DamageSourceFilter,
    FilterMatchContext,
    MatchableDamageSource,
    MatchablePermanent,
    MatchablePlayer,
    PermanentFilter,
    PlayerFilter,
} from "../../filters";
import {
    matchesDamageSourceFilter,
    matchesPermanentFilter,
    matchesPlayerFilter,
} from "../../filters";

/** Source-side scope vocabulary used by `damageDealtTrigger.source` and (as
 *  an optional refinement) by `damageTakenTrigger.source`. Tests the damage
 *  source's controller-relation to the trigger source (CR 109.4, 109.5). */
export type DamageSourceScope = "self" | "yours" | "opponents" | "any";

/** Derived payload exposed to the user-facing `resolve` callback. Spares the
 *  card author from re-narrowing `event.type` and from looking up the source's
 *  characteristics by hand (CR 603.10 last-known information snapshotted at
 *  emit time on the event). */
export interface DamageTriggerPayload {
    source: {
        id: string;
        controllerId: string;
        colors: ReadonlyArray<Color>;
        types: ReadonlyArray<CardType>;
    };
    target: TargetSelection;
    amount: number;
    isCombat: boolean;
}

/** True if the source side of `event` matches `scope` relative to `self`.
 *  CR 109.4 (controller of a permanent), CR 109.5 (controller of a stack
 *  item). Sources are always permanents or stack items — never players. */
export function matchesSourceScope(
    event: DamageDealtEvent,
    self: PermanentView,
    scope: DamageSourceScope
): boolean {
    if (scope === "any") return true;
    if (scope === "self") return event.sourceInstanceId === self.id;
    if (scope === "yours") {
        return event.sourceControllerId === self.controllerId;
    }
    // "opponents"
    return event.sourceControllerId !== self.controllerId;
}

/** Builds a `MatchableDamageSource` from the event's snapshotted source
 *  fields (CR 603.10). The emitter populates `sourceColors / sourceTypes /
 *  sourceSubtypes / sourceStaticAbilities` at damage time; if absent (e.g.
 *  synthetic event in tests), defaults to empty arrays so filters become
 *  no-ops rather than throwing. */
export function buildSourceMatchable(
    event: DamageDealtEvent
): MatchableDamageSource {
    return {
        types: event.sourceTypes ?? [],
        subtypes: event.sourceSubtypes ?? [],
        colors: event.sourceColors ?? [],
        staticAbilities: event.sourceStaticAbilities ?? [],
        controllerId: event.sourceControllerId,
        instanceId: event.sourceInstanceId,
    };
}

/** True if the damage source matches `filter` (CR 120.3 source-side). Returns
 *  `true` when `filter` is undefined (no constraint). */
export function passesSourceFilter(
    event: DamageDealtEvent,
    self: PermanentView,
    filter: DamageSourceFilter | undefined
): boolean {
    if (filter === undefined) return true;
    const ctx: FilterMatchContext = {
        selfInstanceId: self.id,
        selfControllerId: self.controllerId,
    };
    return matchesDamageSourceFilter(buildSourceMatchable(event), filter, ctx);
}

/** Looks up a permanent on the battlefield via the narrow trigger state view.
 *  Returns `null` if not found (target has already left the battlefield —
 *  filter checks treat that as a non-match). */
export function findPermanentInView(
    state: TriggerStateView | undefined,
    instanceId: string
): MatchablePermanent | null {
    if (!state) return null;
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.id === instanceId) {
                return {
                    id: card.id,
                    types: card.types,
                    subtypes: card.subtypes,
                    staticAbilities: card.staticAbilities,
                    controllerId: card.controllerId,
                };
            }
        }
    }
    return null;
}

/** Looks up a player in the narrow trigger state view. */
export function findPlayerInView(
    state: TriggerStateView | undefined,
    playerId: string
): MatchablePlayer | null {
    if (!state) return null;
    for (const player of state.players) {
        if (player.id === playerId) {
            return { id: player.id, life: player.life };
        }
    }
    return null;
}

/** True if the event's target permanent passes `filter` (CR 109.4
 *  controller-relations resolved via the source's `self` view). Returns
 *  `false` if the target isn't a permanent or has left the battlefield —
 *  the trigger doesn't fire (callers can compose with target-kind checks). */
export function passesTargetPermanentFilter(
    event: DamageDealtEvent,
    self: PermanentView,
    state: TriggerStateView | undefined,
    filter: PermanentFilter | undefined
): boolean {
    if (event.target.type !== "permanent") return false;
    const ctx: FilterMatchContext = {
        selfInstanceId: self.id,
        selfControllerId: self.controllerId,
    };
    if (filter === undefined) return true;
    // controllerRelation "self" wants the target permanent's id to equal
    // self.id (CR 109.2). When the target permanent has left the battlefield
    // (e.g. lethal damage already moved it to the graveyard during the same
    // trigger batch), `findPermanentInView` returns null. Synthesise a
    // minimal permanent shape using the event's target id so `self` triggers
    // still fire on the source itself (the source is on the battlefield at
    // trigger-collection time — see Fungusaur).
    const candidate: MatchablePermanent =
        findPermanentInView(state, event.target.id) ??
        ({
            id: event.target.id,
            types: [],
            subtypes: [],
            staticAbilities: [],
            controllerId: undefined,
        } as MatchablePermanent);
    return matchesPermanentFilter(candidate, filter, ctx);
}

/** True if the event's target player passes `filter`. */
export function passesTargetPlayerFilter(
    event: DamageDealtEvent,
    self: PermanentView,
    state: TriggerStateView | undefined,
    filter: PlayerFilter
): boolean {
    if (event.target.type !== "player") return false;
    const candidate =
        findPlayerInView(state, event.target.id) ??
        // Player not visible in the view (shouldn't happen but stay
        // defensive): synthesise an entry; relation checks still resolve
        // off `ctx.selfControllerId`.
        ({ id: event.target.id, life: 0 } as MatchablePlayer);
    const ctx: FilterMatchContext = {
        selfControllerId: self.controllerId,
    };
    return matchesPlayerFilter(candidate, filter, ctx);
}

/** Constructs the derived payload handed to the user's `resolve` callback. */
export function buildDamagePayload(
    event: DamageDealtEvent
): DamageTriggerPayload {
    return {
        source: {
            id: event.sourceInstanceId,
            controllerId: event.sourceControllerId,
            colors: event.sourceColors ?? [],
            types: event.sourceTypes ?? [],
        },
        target: event.target,
        amount: event.amount,
        isCombat: event.isCombat,
    };
}

/** Narrows the broad `GameEvent` union from a `matches`/`interveningIf`
 *  callback down to `DamageDealtEvent`. Caller-side ergonomics. */
export function isDamageDealtEvent(event: {
    type: string;
}): event is DamageDealtEvent {
    return event.type === "DAMAGE_DEALT";
}

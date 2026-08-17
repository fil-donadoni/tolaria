// combatPairKillTrigger — CR 509.1h "blocks or becomes blocked by" trigger
// composed with a CR 603.7a deferred end-of-combat destroy.
//
// Declarative factory for the family of cards reading "Whenever [this creature
// | enchanted creature] blocks or becomes blocked by a creature [matching a
// filter], destroy the other creature at end of combat." (Cockatrice, Thicket
// Basilisk, Abomination, Infernal Medusa, Infinite Authority).
//
// Two composable pieces are returned together via `combatPairKill`:
//   1. a `TriggeredAbility` on BLOCKERS_CONFIRMED that, on each relevant
//      attacker↔blocker pair, captures the OTHER creature and schedules a
//      delayed destroy;
//   2. a `DelayedTriggerDef` (timing: "next-end-of-combat") that runs the
//      destroy and — when the destroy actually moves the creature to a
//      graveyard — optionally schedules a follow-up effect (Infinite Authority's
//      next-end-step +1/+1 counter, gated on "destroyed this way").
//
// `combatant: "self"` matches when the SOURCE permanent is the attacker or
// blocker (Cockatrice). `combatant: "enchanted"` matches when the source's
// aura host (`self.attachedTo`, CR 303.4b) is the attacker or blocker
// (Infinite Authority) — the "enchanted creature blocks or becomes blocked by"
// wording. In both cases the destroy targets the OTHER creature in the pair.

import type {
    BlockersConfirmedEvent,
    DelayedTriggerDef,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggeredAbility,
} from "../../types";

/** Which combatant in the pair must be "this" card's creature. */
export type CombatantScope = "self" | "enchanted";

/** Inputs describing the OTHER creature in a confirmed block pair, surfaced so
 *  a card's filter can gate on it (CR 509.1h). `toughness` is the effective
 *  CR 613 toughness captured at block confirmation; undefined only for
 *  synthetic test events that omit it. */
export interface CombatPairOpponent {
    id: string;
    types: ReadonlyArray<string>;
    subtypes: ReadonlyArray<string>;
    toughness?: number;
}

export interface CombatPairKillArgs {
    /** Local id of the BLOCKERS_CONFIRMED trigger. */
    triggerId: string;
    /** Local id of the paired end-of-combat delayed destroy. */
    delayedTriggerId: string;
    /** Card definition id (used to look the delayed trigger up at fire time). */
    cardId: string;
    /** Oracle text for the BLOCKERS_CONFIRMED ability. */
    oracleText: string;
    /** Oracle text for the delayed destroy. */
    delayedOracleText: string;
    /** Whether the source itself, or the source's aura host, must be the
     *  attacker/blocker in the pair. */
    combatant: CombatantScope;
    /** Gate on the OTHER creature in the pair. Return false to skip a pair
     *  (Cockatrice: non-Wall; Infinite Authority: toughness 3 or less). When
     *  omitted every pair the source participates in qualifies. */
    opponentFilter?: (opponent: CombatPairOpponent) => boolean;
    /** Optional follow-up scheduled ONLY when the deferred destroy actually
     *  put the creature into a graveyard ("if that creature was destroyed this
     *  way"). Receives the SpellContext at end-of-combat resolution and the
     *  delayed-trigger payload (carrying the captured combatant id / aura host
     *  id). Infinite Authority uses it to schedule its next-end-step +1/+1
     *  counter on the host. */
    onDestroyed?: (ctx: SpellContext, payload: Record<string, string>) => void;
}

/** Reads the combatant id this card "owns" for the pair: the source itself, or
 *  its aura host. Undefined for an unattached aura (no host to fight). */
function ownCombatantId(
    combatant: CombatantScope,
    self: PermanentView
): string | undefined {
    return combatant === "self" ? self.id : self.attachedTo;
}

/** Returns the OTHER creature's view if the owned combatant is in this pair,
 *  else undefined. */
function opponentInPair(
    event: BlockersConfirmedEvent,
    ownId: string
): CombatPairOpponent | undefined {
    if (event.attackerId === ownId) {
        return {
            id: event.blockerId,
            types: event.blockerTypes,
            subtypes: event.blockerSubtypes,
            toughness: event.blockerToughness,
        };
    }
    if (event.blockerId === ownId) {
        return {
            id: event.attackerId,
            types: event.attackerTypes,
            subtypes: event.attackerSubtypes,
            toughness: event.attackerToughness,
        };
    }
    return undefined;
}

/** Builds the (trigger, delayedTrigger) pair for a combat-kill card. */
export function combatPairKill(args: CombatPairKillArgs): {
    trigger: TriggeredAbility;
    delayed: DelayedTriggerDef;
} {
    const trigger: TriggeredAbility = {
        id: args.triggerId,
        oracleText: args.oracleText,
        event: "BLOCKERS_CONFIRMED",
        matches: (event: GameEvent, self: PermanentView) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return false;
            const ownId = ownCombatantId(args.combatant, self);
            if (ownId === undefined) return false;
            const opponent = opponentInPair(event, ownId);
            if (!opponent) return false;
            return args.opponentFilter ? args.opponentFilter(opponent) : true;
        },
        resolve: (ctx: SpellContext, event: GameEvent) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return;
            // Re-derive the owned combatant at resolution from the source. For
            // "enchanted" the source is the aura; read its current host.
            const ownId =
                args.combatant === "self"
                    ? ctx.sourceInstanceId
                    : ctx.getAttachedToId();
            if (ownId === undefined) return;
            const opponent = opponentInPair(event, ownId);
            if (!opponent) return;
            // Capture the owned combatant (the host, for an aura) in the
            // payload: the delayed-destroy stack item has no `triggerSourceId`,
            // so `getAttachedToId()` is unavailable when it resolves. `ownId`
            // is the host here (where `getAttachedToId` works) and is read back
            // by `onDestroyed`.
            ctx.scheduleDelayedTrigger(
                args.cardId,
                args.delayedTriggerId,
                "next-end-of-combat",
                { targetId: opponent.id, ownId }
            );
        },
    };

    const delayed: DelayedTriggerDef = {
        id: args.delayedTriggerId,
        oracleText: args.delayedOracleText,
        timing: "next-end-of-combat",
        resolve: (ctx: SpellContext, payload: Record<string, string>) => {
            if (!payload.targetId) return;
            // CR 701.8 — destroy returns true only when the creature actually
            // moved to a graveyard (not regenerated / replaced / already gone).
            // That truth is the "destroyed this way" condition for any follow-up.
            const destroyed = ctx.destroy({
                type: "permanent",
                id: payload.targetId,
            });
            if (destroyed && args.onDestroyed) args.onDestroyed(ctx, payload);
        },
    };

    return { trigger, delayed };
}

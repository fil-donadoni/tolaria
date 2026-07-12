// rampageTrigger — CR 702.23 Rampage N.
//
// "Rampage N means 'Whenever this creature becomes blocked, it gets +N/+N
// until end of turn for each creature blocking it beyond the first.'"
// (CR 702.23a). The bonus is computed as the ability resolves (CR 702.23b):
// it counts the creatures blocking the source AT RESOLUTION, so a blocker
// removed after blocks are declared but before this resolves lowers the
// bonus. Rampage abilities of the same creature are cumulative (CR 702.23c).
//
// Modeled as a keyword→triggered-ability factory (ADR 0002): the card carries
// the parametric keyword `"rampage N"` in `staticAbilities[]` (board-visible
// reminder data) and a matching `rampageTrigger(N)` in `triggeredAbilities[]`,
// so no per-card trigger code is written.
//
// Firing once per "becomes blocked": the engine emits BLOCKERS_CONFIRMED once
// per attacker-blocker pair (CR 509.1h). A creature blocked by K blockers thus
// produces K events for the same attacker. To fire Rampage exactly once we
// dedupe in `matches` against the live block graph in `state.combat`: only the
// pair whose `blockerId` is the FIRST blocker assigned to this attacker passes.

import type {
    GameEvent,
    BlockersConfirmedEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";

/** First blocker (by assignment-iteration order) of `attackerId` in the live
 *  block graph, or undefined if the attacker has no recorded blocker. The
 *  BLOCKERS_CONFIRMED pair whose `blockerId` equals this is the single pair we
 *  let through, so a multi-blocked attacker fires Rampage just once. Exported
 *  (not Rampage-specific) so any other "whenever this becomes blocked" trigger
 *  can reuse the same becomes-blocked-once dedupe (Sparring Golem, INV —
 *  "gets +1/+1 for each creature blocking it", the non-"beyond the first"
 *  sibling of Rampage's math). */
export function firstBlockerOf(
    state: TriggerStateView | undefined,
    attackerId: string
): string | undefined {
    const assignments = state?.combat?.blockerAssignments;
    if (!assignments) return undefined;
    for (const [blockerId, attackerIds] of Object.entries(assignments)) {
        if (attackerIds.includes(attackerId)) return blockerId;
    }
    return undefined;
}

/** Builds the Rampage N triggered ability (CR 702.23) for a value of `n`. */
export function rampageTrigger(n: number): TriggeredAbility {
    const oracleText = `Rampage ${n} (Whenever this creature becomes blocked, it gets +${n}/+${n} until end of turn for each creature blocking it beyond the first.)`;

    function isSelfFirstPair(
        event: BlockersConfirmedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean {
        // Only fire on the source as the blocked ATTACKER (CR 702.23a).
        if (event.attackerId !== self.id) return false;
        // Dedupe the per-pair emission: pass only on the first blocker so the
        // ability triggers once per becoming-blocked even with a band of
        // blockers. `state` is undefined only in synthetic test events that
        // push a single pair — treat that as the first pair.
        const first = firstBlockerOf(state, self.id);
        if (first === undefined) return true;
        return event.blockerId === first;
    }

    return {
        id: `rampage-${n}`,
        oracleText,
        event: "BLOCKERS_CONFIRMED",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return false;
            return isSelfFirstPair(event, self, state);
        },
        resolve: (ctx: SpellContext, event: GameEvent) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return;
            const attackerId = ctx.sourceInstanceId;
            // CR 702.23b — count blockers AT RESOLUTION. `getBlockersByAttacker`
            // reads the (band-expanded) block graph, but `blockerAssignments`
            // is NOT pruned when a blocker leaves the battlefield, so filter to
            // blockers still on the battlefield: a blocker destroyed before this
            // resolves no longer counts.
            const live = new Set<string>();
            for (const pid of ctx.allPlayerIds) {
                for (const id of ctx.getBattlefieldIds(pid)) live.add(id);
            }
            const blockers = (
                ctx.getBlockersByAttacker()[attackerId] ?? []
            ).filter((id) => live.has(id));
            const beyondFirst = Math.max(0, blockers.length - 1);
            if (beyondFirst === 0) return; // blocked by one (or none): no bonus
            const bonus = n * beyondFirst;
            // +bonus/+bonus until end of turn (CR 702.23a, 514.2 cleanup expiry).
            ctx.addTemporaryPTBuff(
                { type: "permanent", id: attackerId },
                bonus,
                bonus,
                { phase: "end-of-turn" }
            );
        },
    };
}

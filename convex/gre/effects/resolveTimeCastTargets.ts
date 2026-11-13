// CR 601.2c — the target announcement of a spell cast DURING a resolution
// (`castDuringResolution`'s picked card, CR 608.2g; Word of Command's
// controlled cast, ADR 0037). Shared by both raise sites so a multi-target
// spell announces every target it requires, group by group, exactly as a
// normal cast's `PendingTarget` walk does (issue #9536).

import type { SpellContext, TargetSelection } from "../../cards/types";

/** Who announces the targets, for which card, and under which choice ids. */
export interface ResolveTimeCastTargetsArgs {
    /** The player prompted for each pick (the caster, or Word of Command's
     *  Acting Player). */
    chooserId: string;
    /** The spell's controller-to-be: legality is read from their side
     *  (CR 601.2c, "opponent"/"you" filters). */
    casterId: string;
    cardInstanceId: string;
    modeId?: string;
    /** CR 709.3 / 712.11b / 715.3 — the announced face. */
    alternativeCostId?: string;
    /** CR 107.3 — the announced X, for an "X targets" count or an X-bound
     *  filter. */
    chosenX?: number;
    /** The id of the FIRST pick; every later pick derives its own from it, so
     *  a single-target spell asks under the same id it always did. */
    choiceId: string;
    /** ADR 0037 — recorded on each raise when it differs from `chooserId`. */
    actingPlayerId?: string;
    /** The pick prompt's subject: "the card you are casting". */
    subject: string;
}

/** `TargetSelection[]` (possibly empty: the spell announces no target) when
 *  every group is announced; `"suspend"` while a pick is pending;
 *  `"unfillable"` when a required pick has no legal target (CR 601.2c — the
 *  spell cannot be cast, "if able"); `"abort"` for a replayed answer that no
 *  longer fits (CR 608.2b). */
export type ResolveTimeCastTargetsOutcome =
    | TargetSelection[]
    | "suspend"
    | "unfillable"
    | "abort";

const MORE = "more";
const DONE = "done";

/** CR 601.2c — announce every target of a spell cast mid-resolution: each
 *  target group in order (the primary requirement, then every
 *  `additionalTargetRequirements` entry, card- or mode-level), each group
 *  filled one target at a time. A pick below the group's minimum is required;
 *  above it ("up to N", "any number") the chooser is first asked whether to
 *  announce another. The legal set of every pick comes from
 *  `ctx.getCastTargetSlot`, which applies the cross-slot constraints the
 *  normal walk applies: no object twice for one instance of "target"
 *  (CR 115.3), `sameController` (Barrin's Spite), `excludePriorTargets`
 *  ("another target") and the zone-owner directives.
 *
 *  One `choose-damage-target` per target, never one multi-pick: the kind is a
 *  singleton on every consumer (submit validator, legal-action lister, Bot
 *  candidate generator), so a spell of N targets asks N questions. A required
 *  pick offers only the candidates that leave the group's remaining minimum
 *  fillable — picking a creature whose controller has no second one would
 *  otherwise sink a "two target creatures controlled by the same player"
 *  cast after the fact. */
export function announceResolveTimeCastTargets(
    ctx: SpellContext,
    args: ResolveTimeCastTargetsArgs
): ResolveTimeCastTargetsOutcome {
    const chosen: TargetSelection[] = [];
    const slotQuery = (
        groupIndex: number,
        groupTargets: readonly TargetSelection[],
        priorTargets: readonly TargetSelection[]
    ) =>
        ctx.getCastTargetSlot(args.casterId, args.cardInstanceId, {
            modeId: args.modeId,
            alternativeCostId: args.alternativeCostId,
            chosenX: args.chosenX,
            groupIndex,
            groupTargets,
            priorTargets,
        });
    const acting =
        args.actingPlayerId !== undefined
            ? { actingPlayerId: args.actingPlayerId }
            : {};
    for (let group = 0; ; group++) {
        const prior = [...chosen];
        const picks: TargetSelection[] = [];
        for (;;) {
            const slot = slotQuery(group, picks, prior);
            if (!slot) return chosen; // every group announced
            const n = picks.length;
            if (slot.max !== undefined && n >= slot.max) break;
            const required = n < slot.min;
            const slotKey = group === 0 && n === 0 ? "" : `@${group}.${n}`;
            let legal = slot.legal;
            if (required && n + 1 < slot.min) {
                // Keep a candidate only when the rest of the group's minimum
                // can still be met after it.
                legal = legal.filter((t) => {
                    const after = slotQuery(group, [...picks, t], prior);
                    return (
                        after !== undefined &&
                        after.legal.length >= slot.min - (n + 1)
                    );
                });
            }
            if (legal.length === 0) {
                if (required) return "unfillable";
                break;
            }
            if (!required) {
                const more = ctx.requestOptionChoice({
                    playerId: args.chooserId,
                    choiceId: `${args.choiceId}:more${slotKey}`,
                    ...acting,
                    options: [
                        { id: MORE, label: "Choose a target" },
                        { id: DONE, label: "No more targets" },
                    ],
                    prompt: `Choose another target for ${args.subject}?`,
                });
                if (more === undefined) return "suspend";
                if (more !== MORE) break;
            }
            const picked = ctx.requestChoice({
                playerId: args.chooserId,
                choiceId: `${args.choiceId}${slotKey}`,
                ...acting,
                kind: "choose-damage-target",
                zone: "battlefield",
                count: 1,
                candidateIds: legal
                    .filter((t) => t.type !== "player")
                    .map((t) => t.id),
                candidatePlayerIds: legal
                    .filter((t) => t.type === "player")
                    .map((t) => t.id),
                prompt:
                    slot.max === 1 && n === 0
                        ? `Choose a target for ${args.subject}.`
                        : `Choose target ${n + 1} for ${args.subject}.`,
            });
            if (picked === undefined) return "suspend";
            const pickedId = picked[0];
            if (!pickedId) return "abort";
            const selected = legal.find((t) => t.id === pickedId);
            if (!selected) return "abort"; // no longer legal (CR 608.2b)
            picks.push(selected);
            chosen.push(selected);
        }
    }
}

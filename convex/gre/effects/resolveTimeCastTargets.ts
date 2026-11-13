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

/** CR 601.2c — announce every target of a spell cast mid-resolution: each
 *  target group in order (the primary requirement, then every
 *  `additionalTargetRequirements` entry, card- or mode-level). A group with a
 *  variable number of targets ("up to N", "any number") first announces HOW
 *  MANY ("the player announces how many targets they will choose before they
 *  announce those targets") — asked only when there is a real choice — then
 *  its targets one at a time. The legal set of every pick comes from
 *  `ctx.getCastTargetSlot`, which applies the cross-slot constraints the
 *  normal walk applies: no object twice for one instance of "target",
 *  `sameController` (Barrin's Spite), `excludePriorTargets` ("another
 *  target") and the zone-owner directives.
 *
 *  One `choose-damage-target` per target, never one multi-pick: the kind is a
 *  singleton on every consumer (submit validator, legal-action lister, Bot
 *  candidate generator), so a spell of N targets asks N questions. A pick
 *  offers only the candidates that leave the rest of the group's announced
 *  number fillable — picking a creature whose controller has no second one
 *  would otherwise sink a "two target creatures controlled by the same
 *  player" cast after the fact. */
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
        const first = slotQuery(group, [], prior);
        if (!first) return chosen; // every group announced
        // The most targets this group could take: its own bound, never more
        // than there are legal objects to name.
        const cap =
            first.max === undefined
                ? first.legal.length
                : Math.min(first.max, first.legal.length);
        if (cap < first.min) return "unfillable";
        let count = first.min;
        if (cap > first.min) {
            const options = Array.from(
                { length: cap - first.min + 1 },
                (_, i) => first.min + i
            ).map((k) => ({
                id: String(k),
                label:
                    k === 0
                        ? "No targets"
                        : k === 1
                          ? "1 target"
                          : `${k} targets`,
            }));
            const announced = ctx.requestOptionChoice({
                playerId: args.chooserId,
                choiceId: `${args.choiceId}:count${group === 0 ? "" : `@${group}`}`,
                ...acting,
                options,
                prompt: `Choose how many targets ${args.subject} will have.`,
            });
            if (announced === undefined) return "suspend";
            count = Number(announced);
            if (!Number.isInteger(count) || count < first.min || count > cap) {
                return "abort";
            }
        }
        const picks: TargetSelection[] = [];
        for (let n = 0; n < count; n++) {
            const slot = n === 0 ? first : slotQuery(group, picks, prior);
            if (!slot) return "abort";
            // Keep a candidate only when the rest of the announced number can
            // still be named after it.
            const legal =
                n + 1 < count
                    ? slot.legal.filter(
                          (t) =>
                              (slotQuery(group, [...picks, t], prior)?.legal
                                  .length ?? 0) >=
                              count - (n + 1)
                      )
                    : slot.legal;
            if (legal.length === 0) return "unfillable";
            const picked = ctx.requestChoice({
                playerId: args.chooserId,
                choiceId: `${args.choiceId}${group === 0 && n === 0 ? "" : `@${group}.${n}`}`,
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
                    count === 1
                        ? `Choose a target for ${args.subject}.`
                        : `Choose target ${n + 1} of ${count} for ${args.subject}.`,
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

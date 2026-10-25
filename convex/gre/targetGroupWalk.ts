// The multi-group target walk (CR 601.2c — Fumarole) shared by every site that
// answers a `PendingTarget`: `game.ts`'s `advanceTargetGroupOrFinalize` (the
// human/mutation path) and `applyRaisedTargetFinalization` (also the Bot's
// in-tree `submit-target`), so a raised selection with queued groups (a copy
// retarget of a multi-group spell, CR 707.10c) is walked identically by both.

import type { GameState, PendingTarget } from "./state";
import { PENDING_TARGET_FILTER_KEYS } from "./state";
import type { TargetRequirement, TargetSelection } from "../cards/types";
import { pendingTargetFiltersFromRequirement } from "./rules";
import { resolveTargetCount } from "./activation";
import {
    priorTargetsOfSameModeInstance,
    recordModeTargetGroup,
} from "./modeSelection";
import { refreshRequiredTargetChoiceIds } from "./targetChoiceRequirements";
import { pendingTargetCountMaxReached } from "./pendingTargetOrigin";

/** Loads the next INDEPENDENT target group of a multi-group spell (CR 601.2c —
 *  Fumarole) into `pt` in place: clears every group-specific filter field and
 *  re-derives them from `req`, resetting `selected` for the fresh group. The
 *  primary group's build in `announceCast` is the single-group analogue; both
 *  derive their filters from `pendingTargetFiltersFromRequirement`. */
export function applyRequirementToPendingTarget(
    state: GameState,
    pt: PendingTarget,
    req: TargetRequirement,
    chosenX: number | undefined,
    priorTargets: readonly TargetSelection[]
): void {
    pt.targetType = req.type;
    // CR 601.2c — a text-defined bound is read HERE, once, against the picks
    // the earlier groups made (the slots its `{ target: N }` names); the
    // stored number is what the rest of the cast reads, never the board again.
    pt.count = resolveTargetCount(req.count, chosenX, {
        state,
        controllerId: pt.playerId,
        sourceInstanceId: pt.cardInstanceId,
        priorTargets,
    });
    pt.selected = [];
    // Clear every optional filter so a prior group's constraint never leaks,
    // then re-apply from the shared builder. The key set is COMPILE-FORCED —
    // `PENDING_TARGET_FILTER_KEYS` (`gre/state.ts`, ADR 0068 / issue #1956)
    // fails `tsc` the moment a registry filter that lands on `PendingTarget`
    // is missing from it. This used to be a hand-written run of assignments,
    // which is a fail-OPEN shape — a filter added to the registry but
    // forgotten here silently leaks the previous group's constraint into the
    // next one (Fumarole's creature-then-land walk), and ten permanent-kind
    // filters had already drifted out of it.
    for (const key of Object.keys(PENDING_TARGET_FILTER_KEYS)) {
        (pt as Record<string, unknown>)[key] = undefined;
    }
    pt.zone = undefined;
    pt.divideTotal = undefined;
    pt.divideAmounts = undefined;
    // CR 601.2c (issue #4193) — the per-Target roles belong to the group that
    // derived them; an additional group carries none (see
    // `announcedTargetRoleFields`), so leaking the primary group's would
    // caption the wrong picks.
    pt.announcedTargetRoles = undefined;
    Object.assign(pt, pendingTargetFiltersFromRequirement(req, chosenX));
}

/** CR 115.3 "another target" (issue #3236) — lowers a group's
 *  `excludePriorTargets` directive into the registered `excludeInstanceIds`
 *  filter, naming every permanent an EARLIER group already chose. Returns the
 *  requirement untouched when the directive is absent. */
export function excludingPriorTargets(
    req: TargetRequirement,
    prior: readonly TargetSelection[]
): TargetRequirement {
    if (!req.excludePriorTargets) return req;
    const priorIds = prior
        .filter((t) => t.type === "permanent")
        .map((t) => t.id);
    if (priorIds.length === 0) return req;
    return {
        ...req,
        excludeInstanceIds: [...(req.excludeInstanceIds ?? []), ...priorIds],
    };
}

/** CR 601.2c + CR 404.1 (issue #2912) — lowers a group's
 *  `zoneOwnerOfPriorPlayerTarget` directive into the registered `zoneOwnerId`
 *  filter, naming the player an EARLIER group announced ("target artifact
 *  cards from target player's graveyard"). Returns the requirement untouched
 *  when the directive is absent. With no player among the earlier picks (the
 *  announcement dropped it) the filter is set to a handle no player has, so
 *  the group fails CLOSED rather than offering every graveyard. */
export function zoneOwnedByPriorPlayerTarget(
    req: TargetRequirement,
    prior: readonly TargetSelection[]
): TargetRequirement {
    if (!req.zoneOwnerOfPriorPlayerTarget) return req;
    const player = prior.find((t) => t.type === "player");
    return { ...req, zoneOwnerId: player?.id ?? "" };
}

/** After a target group's selection completes (CR 601.2c): if the spell has
 *  further INDEPENDENT groups queued, lock the current group's picks into
 *  `priorSelected` and load the next requirement, returning `"advanced"`.
 *  Returns `"exhausted"` when nothing is queued (or every queued group resolved
 *  to no targets at all), leaving `pt` for the caller to finalize. */
export function advancePendingTargetGroup(
    state: GameState,
    pt: PendingTarget
): "advanced" | "exhausted" {
    const remaining = pt.remainingRequirements;
    if (!remaining || remaining.length === 0) return "exhausted";
    const [next, ...rest] = remaining;
    // ADR 0094 — credit the finished group to its mode instance first.
    recordModeTargetGroup(pt, pt.selected.length);
    pt.priorSelected = [...(pt.priorSelected ?? []), ...pt.selected];
    pt.remainingRequirements = rest.length > 0 ? rest : undefined;
    // ADR 0094 — with several mode instances, the earlier picks a group
    // sees are its own instance's: the slots its script reads at
    // resolution.
    const instancePrior = priorTargetsOfSameModeInstance(pt, pt.priorSelected);
    applyRequirementToPendingTarget(
        state,
        pt,
        zoneOwnedByPriorPlayerTarget(
            excludingPriorTargets(next, instancePrior),
            instancePrior
        ),
        pt.chosenX,
        instancePrior
    );
    // CR 601.2c — one announcement, one set of targets: a requirement the
    // earlier groups left unobeyed follows the walk into this one, and the
    // ids it narrows to are this group's, not the previous group's.
    refreshRequiredTargetChoiceIds(state, pt);
    // CR 601.2c — a group whose count resolved to no targets at all (an
    // "up to X" whose X came out 0) has nothing to announce: move on
    // rather than rest on a selection no pick can enter. The announcement
    // side of the same rule is `announcedTargetCount`'s `undefined`.
    if (pendingTargetCountMaxReached(pt.count, 0)) {
        return advancePendingTargetGroup(state, pt);
    }
    return "advanced";
}

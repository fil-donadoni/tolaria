import type { ModeOption } from "@convex/cards/types";
import type { PendingTarget } from "~/types/game";

/** Which mode instance the target group being chosen now belongs to. */
export interface ModeTargetProvenance {
    modeId: string;
    label: string;
    /** 1-based position of this instance among the instances of the SAME
     *  mode (CR 700.2d — a repeated mode is chosen several times). */
    occurrence: number;
    /** How many instances of this mode were announced. */
    of: number;
}

/** ADR 0094 (issue #2264) — a multi-mode announcement flattens every chosen
 *  instance's target groups into one queue, and the prompt asks them in order;
 *  this names the instance that owns the group being asked NOW, read off
 *  `groupModeInstances[0]` (the index into `chosenModeIds` the engine keeps
 *  aligned with the queue). Undefined for a single-instance selection — its
 *  prompt needs no provenance — or when the id names no mode in `modes`. */
export function modeTargetProvenance(
    pendingTarget: Pick<PendingTarget, "chosenModeIds" | "groupModeInstances">,
    modes: readonly ModeOption[] | undefined
): ModeTargetProvenance | undefined {
    const ids = pendingTarget.chosenModeIds ?? [];
    const instance = pendingTarget.groupModeInstances?.[0];
    if (ids.length < 2 || instance === undefined) return undefined;
    const modeId = ids[instance];
    const mode = modes?.find((m) => m.id === modeId);
    if (!mode) return undefined;
    return {
        modeId,
        label: mode.label,
        occurrence: ids.slice(0, instance + 1).filter((id) => id === modeId)
            .length,
        of: ids.filter((id) => id === modeId).length,
    };
}

/** "Destroy target artifact (2 of 2)" — the count only when the mode repeats. */
export function formatModeTargetProvenance(p: ModeTargetProvenance): string {
    return p.of > 1 ? `${p.label} (${p.occurrence} of ${p.of})` : p.label;
}

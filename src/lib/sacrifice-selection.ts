import type {
    Combat,
    PendingActivation,
    PendingCast,
    SacrificeRequirement,
    SacrificeSelection,
} from "~/types/game";

/** The next requirement still awaiting picks (greedy in-order allocation —
 *  mirror of the server's nextUnmetRequirement). CR 701.21a. */
export function nextSacrificeRequirement(
    sel: SacrificeSelection
): SacrificeRequirement | undefined {
    let remaining = sel.picked.length;
    for (const req of sel.requirements) {
        if (remaining < req.count) return req;
        remaining -= req.count;
    }
    return undefined;
}

export function isSacrificeComplete(sel: SacrificeSelection): boolean {
    return nextSacrificeRequirement(sel) === undefined;
}

/** The single sacrifice selection currently awaiting `playerId`'s choice, across
 *  the three in-flight containers (cast / activation / attack tax). Mirrors the
 *  server's findActiveSacrificeSelection so the board lights up the same picker.
 *  CR 701.21a. */
export function activeSacrificeSelection(
    pendingCast: PendingCast | null | undefined,
    pendingActivation: PendingActivation | null | undefined,
    combat: Combat | null | undefined,
    playerId: string
): SacrificeSelection | undefined {
    const cast = pendingCast?.sacrificeSelection;
    if (
        cast &&
        pendingCast!.playerId === playerId &&
        !isSacrificeComplete(cast)
    ) {
        return cast;
    }
    const act = pendingActivation?.sacrificeSelection;
    if (
        act &&
        pendingActivation!.playerId === playerId &&
        !isSacrificeComplete(act)
    ) {
        return act;
    }
    const atk = combat?.pendingAttackSacrifice;
    if (atk && atk.playerId === playerId && !isSacrificeComplete(atk)) {
        return atk;
    }
    return undefined;
}

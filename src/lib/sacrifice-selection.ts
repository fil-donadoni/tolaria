import type {
    Combat,
    PendingActivation,
    PendingCast,
    SacrificeRequirement,
    SacrificeSelection,
} from "~/types/game";
import type { PermanentFilter } from "@convex/cards/filters";

/** Minimal noun phrase for a permanent filter, e.g. "a creature" (types:
 *  "Creature") or "a Swamp" (subtypes: ["Swamp"]). Subtypes win over types
 *  when both are present (more specific). Deliberately terse — the exact legal
 *  set is already visible via battlefield highlighting
 *  (`useBattlefieldVisualState`). Shared by the payment and sacrifice banners. */
export function formatFilterLabel(filter: PermanentFilter): string {
    const subtypes = filter.subtypes
        ? Array.isArray(filter.subtypes)
            ? filter.subtypes
            : [filter.subtypes]
        : [];
    if (subtypes.length > 0) return `a ${subtypes.join(" or ")}`;
    const types = filter.types
        ? Array.isArray(filter.types)
            ? filter.types
            : [filter.types]
        : [];
    if (types.length > 0) return `a ${types.join(" or ").toLowerCase()}`;
    return "a permanent";
}

/** Subtitle for an outstanding permanent-cost choice (CR 701.21a / 118.9) —
 *  names the next unmet requirement's filter, with progress when more than one
 *  is owed. The verb matches the selection's terminal action: "sacrifice"
 *  (default) or "return" (the return-N-lands alternative cost, Gush / Thwart).
 *  Shared by the payment banner (cast/activation) and the sacrifice banner
 *  (attack-declaration land tax). */
export function describeSacrificeChoice(sel: SacrificeSelection): string {
    const verb = sel.action === "return" ? "return" : "sacrifice";
    const req = nextSacrificeRequirement(sel);
    if (!req) return `${verb} a permanent`;
    const label = formatFilterLabel(req.filter);
    const total = sel.requirements.reduce((a, r) => a + r.count, 0);
    if (total > 1) {
        return `${verb} ${label} (${sel.picked.length}/${total})`;
    }
    return `${verb} ${label}`;
}

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

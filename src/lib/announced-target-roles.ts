import type { PendingTarget } from "~/types/game";

/** One announced target of the group being chosen, and the half of the effect
 *  it will receive (CR 601.2c, issue #4193). */
export interface AnnouncedTargetRoleRow {
    /** 1-based position in the announcement, as the prompt numbers it. */
    slot: number;
    /** "returned to its owner's hand", "dealt 2 damage" — the engine's own
     *  derivation, carried on the `PendingTarget` (`gre/targetRoles.ts`). */
    role: string;
    /** `picked` — already chosen; `current` — the next click fills this slot;
     *  `pending` — still to come. */
    status: "picked" | "current" | "pending";
}

/** The per-Target roster the target prompt prints while a group whose slots
 *  receive DIFFERENT halves of the effect is being chosen.
 *
 *  Empty — so the prompt renders exactly as it did before issue #4193 — for
 *  every announcement the engine could not tell apart, which is every
 *  symmetric card (Magma Burst's two targets both take 3 damage) and every
 *  unkicked single-target cast. That suppression lives on the engine side:
 *  `announcedTargetRoles` is simply absent, and this function never invents a
 *  roster for one.
 *
 *  Status is derived from how many picks are in rather than from names: CR
 *  601.2c fills the slots in click order, and the banner sees only the
 *  viewer's own board, so a target on the opponent's battlefield has no name
 *  to print here. What the caster needs before the next click is which half
 *  that click buys, and that is what the `current` row says. */
export function announcedTargetRoleRows(
    roles: PendingTarget["announcedTargetRoles"],
    selectedCount: number
): AnnouncedTargetRoleRow[] {
    if (!roles || roles.length === 0) return [];
    return roles.map((role, index) => ({
        slot: index + 1,
        role,
        status:
            index < selectedCount
                ? ("picked" as const)
                : index === selectedCount
                  ? ("current" as const)
                  : ("pending" as const),
    }));
}

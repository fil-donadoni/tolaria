/**
 * Solo-mode viewer selection (shared between the server projection and the
 * client board). In a solo game one user controls both seats; the viewer
 * follows whoever currently owes input so the UI shows that player's private
 * zones (hand, legal actions, and the face-up library of an active
 * `search-library` choice — CR 401.4 / 701.23).
 *
 * This MUST be the single source of truth for "who is the solo viewer": the
 * server uses it to decide which seat's private zones to project, and the
 * client uses it to decide which seat to render. If the two diverge, a private
 * zone can be exposed to one seat while the other seat is on screen — e.g. the
 * search-library pile failing to open until a page refresh re-syncs priority.
 *
 * Typed against the canonical `GameState` field types (convex is the source of
 * truth for these — the frontend re-exports the same pending types and mirrors
 * `Combat`), so both the server `GameState` and the client board satisfy the
 * ctx directly.
 */
import type {
    GameState,
    PendingActivation,
    PendingCast,
    PendingChoice,
    PendingTarget,
} from "./gre/state";
import { actingPlayerFor, type TurnControlView } from "./gre/turnControl";

export type SoloViewerCtx = {
    activePlayerId: string;
    priorityPlayerId: string;
    phase: string;
    combat?: GameState["combat"];
    /** Melee (#669) — when set, the ATTACKING (active) player declares this
     *  combat's blocks, so the solo viewer steers to them instead of the
     *  defender during DECLARE_BLOCKERS. */
    blocksDeclaredByAttacker?: boolean;
    pendingCast?: PendingCast;
    pendingActivation?: PendingActivation;
    pendingTarget?: PendingTarget;
    pendingChoices?: PendingChoice[];
    playerIds: readonly string[];
};

// CR 509.1 — defender declares blockers as a turn-based action before the
// active player receives priority in DECLARE_BLOCKERS. priorityPlayerId still
// reads as active during that window, so solo viewer must steer to the
// defender (or any other player owning a pending action) explicitly.
export function computeSoloViewerId(ctx: SoloViewerCtx): string {
    const choiceOwner = ctx.pendingChoices?.[0]?.playerId;
    if (choiceOwner) return choiceOwner;
    if (ctx.pendingTarget?.playerId) return ctx.pendingTarget.playerId;
    if (ctx.pendingCast?.playerId) return ctx.pendingCast.playerId;
    if (ctx.pendingActivation?.playerId) return ctx.pendingActivation.playerId;

    if (
        ctx.phase === "DECLARE_BLOCKERS" &&
        ctx.combat &&
        !ctx.combat.blockersConfirmed
    ) {
        // Melee (#669) — the attacker declares blocks, so steer to the active
        // player; otherwise steer to the defender (CR 509.1).
        if (ctx.blocksDeclaredByAttacker) return ctx.activePlayerId;
        const defender = ctx.playerIds.find((id) => id !== ctx.activePlayerId);
        if (defender) return defender;
    }

    // CR 702.22j-k: when banding hands damage-assignment authority to the
    // defending player, steer the solo viewer to whoever still owes a choice.
    if (
        (ctx.phase === "COMBAT_DAMAGE" ||
            ctx.phase === "FIRST_STRIKE_DAMAGE") &&
        ctx.combat &&
        ctx.combat.damageConfirmed === false
    ) {
        const assigners = ctx.combat.damageAssignerIds;
        if (assigners) {
            const confirmed = new Set(
                ctx.combat.damageAssignmentConfirmedBy ?? []
            );
            for (const playerId of Object.values(assigners)) {
                if (!confirmed.has(playerId)) return playerId;
            }
        }
    }

    return ctx.priorityPlayerId;
}

/** The seat `requesterId` views and acts as outside Solo Mode (ADR 0181): the
 *  seat that owes input when the requester answers for it under Turn Control
 *  (CR 723.5), else their own. A controller's board therefore follows the
 *  controlled seat exactly as a solo board follows the owed one; a controlled
 *  player's stays on their own seat, where they watch. Shared by the server
 *  projection and the client board for the same reason `computeSoloViewerId`
 *  is. */
export function computeViewerSeat(
    ctx: SoloViewerCtx & TurnControlView,
    requesterId: string
): string {
    const owed = computeSoloViewerId(ctx);
    return owed !== requesterId && actingPlayerFor(ctx, owed) === requesterId
        ? owed
        : requesterId;
}

/** CR 723.4 — the seats whose hidden game information `requesterId` sees
 *  besides `viewerId`'s: their own (a controller viewing the controlled seat
 *  still knows their own hand) and every seat they actively control. Empty on
 *  a board with no Turn Control. */
export function informationSeatsFor(
    view: TurnControlView,
    requesterId: string,
    viewerId: string
): string[] {
    const seats = [requesterId];
    for (const c of view.turnControls ?? []) {
        if (c.active && c.controllerId === requesterId)
            seats.push(c.controlledId);
    }
    return [...new Set(seats)].filter((id) => id !== viewerId);
}

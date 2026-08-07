import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePageVisible } from "~/hooks/usePageVisible";
import ManualBoardView from "./manual-board-view";

/** The Manual Game's route entry (PRD #2162, issue #2169). Replaces the ~1200
 *  hand-written lines of `manual-board.tsx`, deleted in the same change.
 *
 *  Its whole job is the two things a container does: subscribe to
 *  `getManualState` and gate the loading frame. Everything the player looks
 *  at — the board AND the log — is {@link ManualBoardView}: the log used to
 *  be placed here, as a permanently docked `w-80` rail (desktop) or a
 *  full-screen overlay behind a button (portrait), both of which either
 *  subtracted board width or hid the board outright. Issue #2172 re-homed it
 *  as a collapsed overlay owned by `ManualBoardView` itself
 *  (`manual-log-surface.tsx`), so this container no longer knows the log
 *  exists — it just needs full-bleed space to render into. */
export default function ManualBoardContainer({
    gameId,
    playerId,
}: {
    gameId: Id<"games">;
    playerId: string;
    /** Accepted but unused — the route passes it for both boards. A Manual
     *  Game is always driven by whoever is looking at it. */
    solo?: boolean;
}) {
    const pageVisible = usePageVisible();
    const state = useQuery(
        api.game.getManualState,
        pageVisible ? { gameId, viewerId: playerId } : "skip"
    );

    if (!state) {
        return (
            <div className="flex h-dvh items-center justify-center text-text-muted">
                Loading...
            </div>
        );
    }

    return (
        <div className="relative h-dvh">
            <ManualBoardView
                gameId={gameId}
                viewerId={playerId}
                state={state}
            />
        </div>
    );
}

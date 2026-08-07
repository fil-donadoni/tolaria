import { useCallback, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePageVisible } from "~/hooks/usePageVisible";
import ManualBoardView from "./manual-board-view";

/** The Manual Game's route entry (PRD #2162, issue #2169). Replaces the ~1200
 *  hand-written lines of `manual-board.tsx`, deleted in the same change.
 *
 *  Its whole job is the things a container does: subscribe to
 *  `getManualState`, gate the loading frame, and — since #2173 — own the
 *  steered seat (which seat's projection the subscription asks for; a solo
 *  Manual Game is one user holding both, so that is client-local view state,
 *  not anything the server needs to know about). Everything the player looks
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
    solo = false,
}: {
    gameId: Id<"games">;
    playerId: string;
    /** A solo Manual Game is one user holding BOTH seats (ADR 0080) — the
     *  steered seat (issue #2173) is genuinely switchable there. In a
     *  two-player Manual Game `playerId` already IS the caller's only seat,
     *  so `solo` gates the switch affordance rather than deriving it from
     *  `state.players.length`: a two-player game still has two entries in
     *  that array, and reading player count would offer the action to a
     *  player who has no second seat of their own to look at. */
    solo?: boolean;
}) {
    const pageVisible = usePageVisible();
    // The seat this client currently steers. Starts as the caller's own seat
    // and is the ONLY thing a seat switch changes — everything downstream
    // (the query below, `me`/`opponent` ordering in `ManualBoardView`) is
    // derived from it, so flipping it is the entire feature.
    const [steeredSeat, setSteeredSeat] = useState(playerId);
    const state = useQuery(
        api.game.getManualState,
        pageVisible ? { gameId, viewerId: steeredSeat } : "skip"
    );

    // Toggles to whichever OTHER seat is on the current state — reads
    // `state.players` rather than assuming the `-p1`/`-p2` id shape (no
    // "other seat" helper exists elsewhere in the codebase, and this stays
    // correct even if that shape ever changes). A no-op until state has
    // loaded or if, somehow, only one seat exists.
    const switchSeat = useCallback(() => {
        setSteeredSeat((current) => {
            const other = state?.players.find((p) => p.id !== current)?.id;
            return other ?? current;
        });
    }, [state]);

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
                viewerId={steeredSeat}
                state={state}
                onSwitchSeat={solo ? switchSeat : undefined}
            />
        </div>
    );
}

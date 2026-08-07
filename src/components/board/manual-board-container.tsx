import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import ManualBoardView from "./manual-board-view";
import ManualLog from "./manual-log";

/** The Manual Game's route entry (PRD #2162, issue #2169). Replaces the ~1200
 *  hand-written lines of `manual-board.tsx`, deleted in the same change.
 *
 *  Its whole job is the three things a container does: subscribe to
 *  `getManualState`, gate the loading frame, and place the log beside the
 *  board. Everything the player looks at is {@link ManualBoardView}, which is
 *  the SHARED board surface.
 *
 *  The log stays exactly where it was — a sibling of the board, a right rail on
 *  desktop and a full-screen overlay behind a button in portrait. Issue #2172
 *  is what re-homes it. */
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
    const isPortrait = useIsPortrait();
    const [logOpen, setLogOpen] = useState(false);
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
        <div className="flex h-dvh relative">
            <div className="flex-1 min-w-0 relative">
                <ManualBoardView
                    gameId={gameId}
                    viewerId={playerId}
                    state={state}
                />
                {isPortrait && (
                    <button
                        className="absolute top-2 right-2 z-40 rounded-lg bg-black/60 p-2 text-xs text-text-muted shadow-lg transition-colors hover:bg-black/80"
                        onClick={() => setLogOpen((v) => !v)}
                    >
                        Log
                    </button>
                )}
            </div>
            {isPortrait ? (
                logOpen && (
                    <div className="absolute inset-0 z-40 flex flex-col bg-surface-base">
                        <button
                            className="m-2 self-end p-2 text-text-muted hover:text-text"
                            onClick={() => setLogOpen(false)}
                        >
                            Close
                        </button>
                        <div className="flex-1 min-h-0">
                            <ManualLog gameId={gameId} />
                        </div>
                    </div>
                )
            ) : (
                <div className="w-80 shrink-0 border-l border-border-subtle">
                    <ManualLog gameId={gameId} />
                </div>
            )}
        </div>
    );
}

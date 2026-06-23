import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MulliganState, Player } from "~/types/game";
import { useDraggable } from "~/hooks/useDraggable";

const STARTING_HAND_SIZE = 7;

/** Pre-game mulligan declaration prompt (CR 103.5, London mulligan). Shown
 *  while the engine is in `phase === "MULLIGAN"` and not yet in the bottoming
 *  step. The currently-declaring player sees Keep / Mulligan-to-N buttons;
 *  the opponent sees a "waiting for X" message. Bottoming is handled by the
 *  generic `PendingChoicePrompt` (kind: "mulligan-bottom"). */
export default function MulliganPrompt({
    gameId,
    viewerId,
    mulligan,
    allPlayers,
}: {
    gameId: Id<"games">;
    viewerId: string;
    mulligan: MulliganState;
    allPlayers: Player[];
}) {
    const { offset, dragHandlers } = useDraggable();
    const declareMulligan = useMutation(api.game.declareMulligan);
    const [isBusy, setIsBusy] = useState(false);

    const declaringPlayer = allPlayers.find(
        (p) => p.id === mulligan.declaringPlayerId
    );
    const isDeclarer = mulligan.declaringPlayerId === viewerId;
    const viewerIdx = allPlayers.findIndex((p) => p.id === viewerId);
    const viewerMulls = viewerIdx >= 0 ? mulligan.mulligansTaken[viewerIdx] : 0;
    const nextHandSize = STARTING_HAND_SIZE - viewerMulls - 1;

    const onKeep = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await declareMulligan({
                gameId,
                playerId: viewerId,
                decision: "keep",
            });
        } finally {
            setIsBusy(false);
        }
    };
    const onMull = async () => {
        if (isBusy) return;
        setIsBusy(true);
        try {
            await declareMulligan({
                gameId,
                playerId: viewerId,
                decision: "mull",
            });
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div
            className="absolute top-1/2 left-1/2 z-100 pointer-events-none"
            style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
        >
            <div
                {...dragHandlers}
                className="relative flex flex-col items-center gap-3 bg-surface border border-border-subtle backdrop-blur-md rounded-sm px-6 py-4 shadow-[0_0_50px_rgba(0,0,0,0.8)] cursor-move select-none pointer-events-auto"
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-border-accent/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-border-accent/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-border-accent/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-border-accent/40" />

                <div className="flex flex-col items-center gap-1 w-full">
                    <p className="font-beleren text-sm tracking-wide text-parchment">
                        Mulligan
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-border-accent/40 to-transparent" />
                    <p className="text-text-muted text-xs">
                        {viewerMulls > 0
                            ? `you have taken ${viewerMulls} mulligan${viewerMulls === 1 ? "" : "s"}`
                            : "review your opening hand"}
                    </p>
                </div>

                {isDeclarer ? (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onKeep}
                            disabled={isBusy}
                            className="px-4 py-2 rounded-sm bg-accent-soft border border-accent text-accent-strong text-sm font-beleren tracking-wide hover:bg-accent-soft/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                            Keep
                        </button>
                        <button
                            type="button"
                            onClick={onMull}
                            disabled={isBusy || nextHandSize < 0}
                            className="px-4 py-2 rounded-sm bg-danger-soft border border-danger text-danger-strong text-sm font-beleren tracking-wide hover:bg-danger-soft/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                            {nextHandSize >= 0
                                ? `Mulligan to ${nextHandSize}`
                                : "Cannot mulligan further"}
                        </button>
                    </div>
                ) : (
                    <p className="text-text-muted text-xs">
                        Waiting for{" "}
                        <span className="text-parchment font-beleren">
                            {declaringPlayer?.name ?? "opponent"}
                        </span>
                    </p>
                )}
            </div>
        </div>
    );
}

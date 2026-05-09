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

    const declaringPlayer = allPlayers.find(
        (p) => p.id === mulligan.declaringPlayerId
    );
    const isDeclarer = mulligan.declaringPlayerId === viewerId;
    const viewerIdx = allPlayers.findIndex((p) => p.id === viewerId);
    const viewerMulls = viewerIdx >= 0 ? mulligan.mulligansTaken[viewerIdx] : 0;
    const nextHandSize = STARTING_HAND_SIZE - viewerMulls - 1;

    const onKeep = () =>
        declareMulligan({ gameId, playerId: viewerId, decision: "keep" });
    const onMull = () =>
        declareMulligan({ gameId, playerId: viewerId, decision: "mull" });

    return (
        <div
            className="absolute top-1/2 left-1/2 z-50 pointer-events-none"
            style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
        >
            <div
                {...dragHandlers}
                className="flex flex-col items-center gap-3 bg-indigo-900/90 border border-indigo-400/50 rounded-lg px-6 py-4 backdrop-blur-sm shadow-lg cursor-move select-none pointer-events-auto"
            >
                <div className="text-indigo-100 text-sm font-medium">
                    <span className="text-white font-bold">Mulligan</span>
                    {" — "}
                    {viewerMulls > 0
                        ? `you have taken ${viewerMulls} mulligan${viewerMulls === 1 ? "" : "s"}`
                        : "review your opening hand"}
                </div>

                {isDeclarer ? (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onKeep}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-md px-4 py-2 text-sm cursor-pointer"
                        >
                            Keep
                        </button>
                        <button
                            type="button"
                            onClick={onMull}
                            disabled={nextHandSize < 0}
                            className="bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-md px-4 py-2 text-sm cursor-pointer"
                        >
                            {nextHandSize >= 0
                                ? `Mulligan to ${nextHandSize}`
                                : "Cannot mulligan further"}
                        </button>
                    </div>
                ) : (
                    <div className="text-indigo-200 text-xs">
                        Waiting for{" "}
                        <span className="text-white font-bold">
                            {declaringPlayer?.name ?? "opponent"}
                        </span>{" "}
                        to declare
                    </div>
                )}
            </div>
        </div>
    );
}

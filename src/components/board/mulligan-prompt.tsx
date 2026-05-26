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
                className="relative flex flex-col items-center gap-3 bg-[#0c0d12]/90 border border-zinc-800/80 backdrop-blur-md rounded-sm px-6 py-4 shadow-[0_0_50px_rgba(0,0,0,0.8)] cursor-move select-none pointer-events-auto"
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-zinc-500/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-zinc-500/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-zinc-500/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-zinc-500/40" />

                <div className="flex flex-col items-center gap-1 w-full">
                    <p className="font-[var(--font-beleren)] text-sm tracking-wide text-[#f1f1e8]">
                        Mulligan
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-zinc-500/40 to-transparent" />
                    <p className="text-zinc-400 text-xs">
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
                            className="px-4 py-2 rounded-sm bg-emerald-900/40 border border-emerald-700/50 text-emerald-300 text-sm font-[var(--font-beleren)] tracking-wide hover:bg-emerald-900/60 transition-colors cursor-pointer"
                        >
                            Keep
                        </button>
                        <button
                            type="button"
                            onClick={onMull}
                            disabled={nextHandSize < 0}
                            className="px-4 py-2 rounded-sm bg-rose-900/40 border border-rose-700/50 text-rose-300 text-sm font-[var(--font-beleren)] tracking-wide hover:bg-rose-900/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                            {nextHandSize >= 0
                                ? `Mulligan to ${nextHandSize}`
                                : "Cannot mulligan further"}
                        </button>
                    </div>
                ) : (
                    <p className="text-zinc-400 text-xs">
                        Waiting for{" "}
                        <span className="text-[#f1f1e8] font-[var(--font-beleren)]">
                            {declaringPlayer?.name ?? "opponent"}
                        </span>
                    </p>
                )}
            </div>
        </div>
    );
}

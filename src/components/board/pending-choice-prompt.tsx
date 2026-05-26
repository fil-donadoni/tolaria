import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useDraggable } from "~/hooks/useDraggable";
import { isManaCostCovered, manaCostToString } from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";

function getCountMin(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.min;
}

function getCountMax(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.max;
}

/** Banner shown at the top-center of the board while a mid-resolution
 *  player choice is active (CR 608.2). Displays the prompt, the progress
 *  (selected / count) for the chooser, or a waiting state for the opponent.
 *  Card selection itself happens inline on the battlefield / hand —
 *  `player-battlefield` and `selectable-card` detect the pending choice and
 *  route clicks to `selectResolutionChoice`. For `kind: "may-pay"` choices,
 *  the prompt renders Pay/Skip buttons inline that submit through
 *  `submitMayPay`. For `kind: "untap-pick"` choices (CR 502.1 cap-style
 *  restrictions like Winter Orb), the prompt renders a "Skip untap" / "Done"
 *  button when `min === 0` so the chooser can commit a partial pick or
 *  decline to untap; the button submits through `confirmUntapPick`. */
export default function PendingChoicePrompt({
    choice,
    playerId,
    gameId,
}: {
    choice: PendingChoice;
    playerId: string;
    gameId: Id<"games">;
}) {
    const { allPlayers } = useGameContext();
    const { offset, dragHandlers } = useDraggable();
    const submitMayPay = useMutation(api.game.submitMayPay);
    const confirmUntapPick = useMutation(api.game.confirmUntapPick);
    const isChooser = choice.playerId === playerId;
    const selected = choice.selected.length;
    const min = getCountMin(choice.count);
    const max = getCountMax(choice.count);
    const remaining = Math.max(0, max - selected);
    const isUntapPick = choice.kind === "untap-pick";
    // Cap-style untap restrictions surface a "Skip"/"Done" button so the
    // ADR 0003 tactical zero-branch (CR 502.1, 701.39) is reachable in one
    // click — automatic commit only triggers once `selected.length === max`.
    const showUntapCommit = isUntapPick && min === 0;

    const chooserName =
        allPlayers.find((p) => p.id === choice.playerId)?.name ?? "opponent";
    const sourceLabel = pendingChoiceLabel(choice.kind);

    const isMayPay = choice.kind === "may-pay";
    // Disable "Pay" until the chooser's mana pool covers the cost (CR 117.6).
    // The chooser may activate mana abilities while the may-pay window is open
    // (CR 117.3a) — `tapUntap` already allows this and the button will enable
    // as soon as the pool can cover the full cost.
    const chooser = allPlayers.find((p) => p.id === choice.playerId);
    const canPay =
        !isMayPay ||
        !choice.cost ||
        (chooser ? isManaCostCovered(chooser.manaPool, choice.cost) : false);
    const costSymbols =
        isMayPay && choice.cost
            ? formatOracleText(manaCostToString(choice.cost))
            : null;

    return (
        <div
            className="absolute top-1/2 left-1/2 z-50 pointer-events-none"
            style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
        >
            <div
                {...dragHandlers}
                className="relative flex flex-col items-center gap-2 bg-[#0c0d12]/90 border border-zinc-800/80 backdrop-blur-md rounded-sm px-5 py-3 shadow-[0_0_50px_rgba(0,0,0,0.8)] cursor-move select-none pointer-events-auto"
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-zinc-500/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-zinc-500/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-zinc-500/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-zinc-500/40" />

                {isChooser ? (
                    <>
                        <div className="flex flex-col items-center text-center gap-1">
                            <p className="font-beleren text-sm tracking-wide text-[#f1f1e8]">
                                {sourceLabel}
                            </p>
                            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-zinc-500/40 to-transparent" />
                            <p className="text-zinc-400 text-xs">
                                {choice.prompt}
                            </p>
                        </div>
                        {isMayPay ? (
                            <div className="flex gap-2 mt-1">
                                <button
                                    type="button"
                                    disabled={!canPay}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-[#7a5a2e]/30 border border-[#c8a060]/45 text-[#e0c08a] hover:bg-[#7a5a2e]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                                    onClick={() =>
                                        submitMayPay({
                                            gameId,
                                            playerId,
                                            accept: true,
                                        })
                                    }
                                >
                                    {choice.cost ? (
                                        <>
                                            <span>Pay</span>
                                            <span className="inline-flex items-center">
                                                {costSymbols}
                                            </span>
                                        </>
                                    ) : (
                                        "Yes"
                                    )}
                                </button>
                                <button
                                    type="button"
                                    className="px-3 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-zinc-800/40 border border-zinc-600/45 text-zinc-300 hover:bg-zinc-700/40 transition-colors cursor-pointer"
                                    onClick={() =>
                                        submitMayPay({
                                            gameId,
                                            playerId,
                                            accept: false,
                                        })
                                    }
                                >
                                    {choice.cost ? "Skip" : "No"}
                                </button>
                            </div>
                        ) : (
                            <>
                                <p className="text-zinc-500 text-xs">
                                    {remaining > 0
                                        ? `${selected} / ${max} selected — click ${remaining === 1 ? "one more" : `up to ${remaining} more`}`
                                        : "Submitting..."}
                                </p>
                                {showUntapCommit && (
                                    <button
                                        type="button"
                                        className="mt-1 px-3 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-zinc-800/40 border border-zinc-600/45 text-zinc-300 hover:bg-zinc-700/40 transition-colors cursor-pointer"
                                        onClick={() =>
                                            confirmUntapPick({
                                                gameId,
                                                playerId,
                                            })
                                        }
                                    >
                                        {selected === 0 ? "Skip untap" : "Done"}
                                    </button>
                                )}
                            </>
                        )}
                    </>
                ) : (
                    <p className="text-zinc-400 text-xs text-center">
                        Waiting for{" "}
                        <span className="font-beleren text-[#f1f1e8]">
                            {chooserName}
                        </span>{" "}
                        — {choice.prompt}
                    </p>
                )}
            </div>
        </div>
    );
}

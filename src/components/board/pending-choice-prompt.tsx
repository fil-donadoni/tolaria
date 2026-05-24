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
                className="flex flex-col items-center gap-1 bg-violet-900/90 border border-violet-400/50 rounded-lg px-5 py-3 backdrop-blur-sm shadow-lg cursor-move select-none pointer-events-auto"
            >
                {isChooser ? (
                    <>
                        <div className="text-violet-100 text-sm font-medium">
                            <span className="text-white font-bold">
                                {sourceLabel}
                            </span>
                            {" — "}
                            {choice.prompt}
                        </div>
                        {isMayPay ? (
                            <div className="flex gap-2 mt-1">
                                <button
                                    type="button"
                                    disabled={!canPay}
                                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-white/50 disabled:cursor-not-allowed disabled:hover:bg-slate-700 rounded text-white text-xs font-semibold inline-flex items-center gap-1"
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
                                    className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-white text-xs font-semibold"
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
                                <div className="text-violet-300 text-xs">
                                    {remaining > 0
                                        ? `${selected} / ${max} selected — click ${remaining === 1 ? "one more" : `up to ${remaining} more`}`
                                        : "Submitting..."}
                                </div>
                                {showUntapCommit && (
                                    <div className="flex gap-2 mt-1">
                                        <button
                                            type="button"
                                            className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-white text-xs font-semibold"
                                            onClick={() =>
                                                confirmUntapPick({
                                                    gameId,
                                                    playerId,
                                                })
                                            }
                                        >
                                            {selected === 0
                                                ? "Skip untap"
                                                : "Done"}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                ) : (
                    <div className="text-violet-100 text-sm font-medium">
                        Waiting for{" "}
                        <span className="text-white font-bold">
                            {chooserName}
                        </span>
                        {" — "}
                        <span className="text-violet-200">{choice.prompt}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

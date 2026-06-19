import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useDraggable } from "~/hooks/useDraggable";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { usePendingChoicePrimaryAction } from "~/hooks/usePendingChoicePrimaryAction";
import { manaCostToString } from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";
import PendingChoiceOptions from "~/components/board/pending-choice-options";
import RandomRevealOverlay from "~/components/board/random-reveal-overlay";
import MinimizeChoiceButton from "~/components/board/minimize-choice-button";

function getCountMin(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.min;
}

function getCountMax(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.max;
}

/** Banner shown at the top-center of the board while a mid-resolution
 *  player choice is active (CR 608.2). Displays the prompt and, for the
 *  chooser, the progress (selected / max) and an explicit Skip/Done button
 *  for kinds that use the client-buffered submit model (ADR 0007). For the
 *  opponent, only a static "Waiting for X" line is shown — selection
 *  progress is private until submit.
 *
 *  For `may-pay` choices, the prompt renders Pay/Skip buttons that submit
 *  through `submitMayPay`. For kinds not yet migrated to client-buffered
 *  submit (`mulligan-bottom` until slice #84 lands), the legacy per-click
 *  counter is shown without a Done button — commit is server-side at
 *  `selected.length === max`. */
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
    const submitResolutionChoice = useMutation(api.game.submitResolutionChoice);
    const [isBusy, setIsBusy] = useState(false);
    const bufferCtx = usePendingChoiceBuffer();
    // Primary (affirmative) action — shared with the Space hotkey so the button
    // and the key commit through one code path. Non-null when this viewer is
    // the chooser; the Skip/No path below stays local (it's the secondary).
    const primary = usePendingChoicePrimaryAction();
    const isChooser = choice.playerId === playerId;
    const min = getCountMin(choice.count);
    const max = getCountMax(choice.count);
    const isMayPay = choice.kind === "may-pay";
    const isOptionPick = choice.kind === "option-pick";

    // All zone-pick kinds use the client-side buffer (ADR 0007).
    const selected = bufferCtx.buffer.length;
    const remaining = Math.max(0, max - selected);

    const chooserName =
        allPlayers.find((p) => p.id === choice.playerId)?.name ?? "opponent";
    const sourceLabel = pendingChoiceLabel(choice.kind);

    // "Pay" enables once the chooser's mana pool covers the cost (CR 117.6);
    // the chooser may activate mana abilities while the may-pay window is open
    // (CR 117.3a) and the button enables as soon as the pool can cover it. The
    // gating itself lives in usePendingChoicePrimaryAction (shared with Space).
    const canConfirm = primary?.canConfirm ?? false;
    const costSymbols =
        isMayPay && choice.cost
            ? formatOracleText(manaCostToString(choice.cost))
            : null;

    // Done/Skip label (ADR 0007): switches to "Skip" only when min === 0 and
    // the buffer is empty.
    const submitLabel = min === 0 && selected === 0 ? "Skip" : "Done";

    // Random-reveal (CR 705 / ADR 0023): an engine-drawn outcome with NO
    // decision — route to the center-screen reveal overlay (coin animation,
    // auto-acknowledge on landing) instead of the buttons. Both clients render
    // it; only the chooser's client acks.
    if (choice.kind === "random-reveal") {
        return (
            <RandomRevealOverlay
                choice={choice}
                playerId={playerId}
                gameId={gameId}
            />
        );
    }

    return (
        <div
            className="absolute top-1/2 left-1/2 z-100 pointer-events-none"
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
                        <MinimizeChoiceButton className="absolute top-1.5 right-1.5" />
                        <div className="flex flex-col items-center text-center gap-1">
                            <p className="font-beleren text-sm tracking-wide text-[#f1f1e8]">
                                {sourceLabel}
                            </p>
                            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-zinc-500/40 to-transparent" />
                            <p className="text-zinc-400 text-xs">
                                {choice.prompt}
                            </p>
                        </div>
                        {isOptionPick ? (
                            <PendingChoiceOptions
                                options={choice.options ?? []}
                                disabled={isBusy}
                                onPick={async (id) => {
                                    if (isBusy) return;
                                    setIsBusy(true);
                                    try {
                                        // Single-select: submit the chosen
                                        // option id directly (one id), bypassing
                                        // the multi-pick buffer — no stale
                                        // closure on the buffer contents.
                                        await submitResolutionChoice({
                                            gameId,
                                            playerId,
                                            stackItemId: choice.stackItemId,
                                            step: choice.step,
                                            choiceId: choice.choiceId,
                                            cardInstanceIds: [id],
                                        });
                                    } finally {
                                        setIsBusy(false);
                                    }
                                }}
                            />
                        ) : isMayPay ? (
                            <div className="flex gap-2 mt-1">
                                <button
                                    type="button"
                                    disabled={!canConfirm}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-[#7a5a2e]/30 border border-[#c8a060]/45 text-[#e0c08a] hover:bg-[#7a5a2e]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                                    onClick={() => primary?.confirm()}
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
                                    disabled={isBusy}
                                    className="px-3 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-zinc-800/40 border border-zinc-600/45 text-zinc-300 hover:bg-zinc-700/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                                    onClick={async () => {
                                        if (isBusy) return;
                                        setIsBusy(true);
                                        try {
                                            await submitMayPay({
                                                gameId,
                                                playerId,
                                                accept: false,
                                            });
                                        } finally {
                                            setIsBusy(false);
                                        }
                                    }}
                                >
                                    {choice.cost ? "Skip" : "No"}
                                </button>
                            </div>
                        ) : (
                            <>
                                <p className="text-zinc-500 text-xs">
                                    {selected} / {max} selected
                                    {min < max && remaining > 0
                                        ? ` — click ${remaining === 1 ? "one more" : `up to ${remaining} more`}`
                                        : ""}
                                </p>
                                <button
                                    type="button"
                                    disabled={!canConfirm}
                                    className="mt-1 px-3 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-[#7a5a2e]/30 border border-[#c8a060]/45 text-[#e0c08a] hover:bg-[#7a5a2e]/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                                    onClick={() => primary?.confirm()}
                                >
                                    {submitLabel}
                                </button>
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

import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useDraggable } from "~/hooks/useDraggable";

/** Banner shown at the top-center of the board while a mid-resolution
 *  player choice is active (CR 608.2). Displays the prompt, the progress
 *  (selected / count) for the chooser, or a waiting state for the opponent.
 *  Card selection itself happens inline on the battlefield / hand —
 *  `player-battlefield` and `selectable-card` detect the pending choice and
 *  route clicks to `selectResolutionChoice`. */
export default function PendingChoicePrompt({
    choice,
    playerId,
}: {
    choice: PendingChoice;
    playerId: string;
}) {
    const { allPlayers } = useGameContext();
    const { offset, dragHandlers } = useDraggable();
    const isChooser = choice.playerId === playerId;
    const selected = choice.selected.length;
    const remaining = Math.max(0, choice.count - selected);

    const chooserName =
        allPlayers.find((p) => p.id === choice.playerId)?.name ?? "opponent";
    const sourceLabel =
        choice.kind === "mulligan-bottom" ? "Mulligan" : "Balance";

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
                        <div className="text-violet-300 text-xs">
                            {remaining > 0
                                ? `${selected} / ${choice.count} selected — click ${remaining === 1 ? "one more" : `${remaining} more`}`
                                : "Submitting..."}
                        </div>
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

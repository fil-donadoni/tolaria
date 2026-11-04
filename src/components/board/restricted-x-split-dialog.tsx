import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { RestrictedXSplitChoice } from "~/types/game";
import GameDialog from "~/components/ui/game-dialog";

/** CR 601.2f — "Spend only [colour] mana on X" under a cost reduction or delve:
 *  which generic the covered points remove. Parked server-side only when the
 *  spell reads the mana spent on X and at least two splits are affordable
 *  (`buildRestrictedXSplitChoice`). Each button is one option; `pointsOnX` is how
 *  many covered points go back onto X, off the fixed generic. Cancelling rolls
 *  the cast back through `cancelCast`, like every other cast picker. */
export default function RestrictedXSplitDialog({
    choice,
    gameId,
    playerId,
}: {
    choice: RestrictedXSplitChoice;
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectRestrictedXSplit = useMutation(api.game.selectRestrictedXSplit);
    const cancelCast = useMutation(api.game.cancelCast);
    const [isPending, setIsPending] = useState(false);

    async function run(action: () => Promise<unknown>) {
        if (isPending) return;
        setIsPending(true);
        try {
            await action();
        } finally {
            setIsPending(false);
        }
    }

    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    void run(() => cancelCast({ gameId, playerId }));
                }
            }}
            title="Apply the cost reduction"
            subtitle="Reducing X leaves a cheaper-to-pay cost. Reducing the fixed cost leaves more of X to pay with mana, which this spell counts."
            dismissable={!isPending}
        >
            <div className="flex flex-wrap justify-center gap-2 mt-2 p-1">
                {choice.options.map((pointsOnX) => (
                    <button
                        key={pointsOnX}
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                            void run(() =>
                                selectRestrictedXSplit({
                                    gameId,
                                    playerId,
                                    pointsOnX,
                                })
                            )
                        }
                        className="rounded-full bg-white/5 px-4 py-2 cursor-pointer ring-1 ring-white/15 transition-colors hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {pointsOnX === 0
                            ? "Reduce X first"
                            : `Move ${pointsOnX} to the fixed cost`}
                    </button>
                ))}
            </div>
        </GameDialog>
    );
}

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { GenericSpendAmbiguity } from "~/types/game";
import GameDialog from "~/components/ui/game-dialog";

/** CR 601.2g — generic-mana spend picker. Active while this viewer's
 *  `pendingCast`/`pendingActivation` has parked a meaningful choice of which
 *  floating mana pays the generic cost (`GenericSpendAmbiguity`, detected
 *  server-side by `genericSpendAmbiguity` — the leftover-set-differs rule).
 *  Every OTHER payment gate has already cleared by the time this renders (it
 *  is the LAST finalize-point check, `tryAutoCommitPendingCast` /
 *  `tryAutoCommitPendingActivation`), so mana is already tapped/floating —
 *  clicking a colour submits `resolveManaSpendChoice` with one more entry of
 *  the spend order; once the order reaches `choice.generic` entries the
 *  parked cast/activation resumes and this dialog unmounts. Cancelling rolls
 *  back the whole payment via the container's own cancel mutation (mirrors
 *  `CastExileCostDialog` / `ExileCostDialog`). */
export default function ManaSpendChoiceDialog({
    choice,
    container,
    gameId,
    playerId,
}: {
    choice: GenericSpendAmbiguity;
    container: "cast" | "activation";
    gameId: Id<"games">;
    playerId: string;
}) {
    const resolveManaSpendChoice = useMutation(api.game.resolveManaSpendChoice);
    const cancelCast = useMutation(api.game.cancelCast);
    const cancelActivation = useMutation(api.game.cancelActivation);
    const [selected, setSelected] = useState<string[]>([]);
    const [isPending, setIsPending] = useState(false);

    async function handlePick(color: string) {
        if (isPending) return;
        const spendOrder = [...selected, color];
        setSelected(spendOrder);
        // Only the FINAL pick (spendOrder reaches `generic` entries) submits —
        // a partial pick just advances the local buffer so the buttons stay
        // live for the next point of generic still owed.
        if (spendOrder.length < choice.generic) return;
        setIsPending(true);
        try {
            await resolveManaSpendChoice({
                gameId,
                playerId,
                spendOrder,
            });
        } finally {
            // A rejected order (stale pool) falls back to letting the player
            // retry from scratch rather than getting stuck mid-buffer.
            setIsPending(false);
            setSelected([]);
        }
    }

    async function handleCancel() {
        if (isPending) return;
        setIsPending(true);
        try {
            if (container === "cast") {
                await cancelCast({ gameId, playerId });
            } else {
                await cancelActivation({ gameId, playerId });
            }
        } finally {
            setIsPending(false);
        }
    }

    const remaining = choice.generic - selected.length;

    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) void handleCancel();
            }}
            title="Choose mana to spend"
            subtitle={
                choice.generic === 1
                    ? "Pick which floating mana pays the generic cost"
                    : `Pick ${remaining} more floating mana to pay the generic cost (${selected.length}/${choice.generic})`
            }
            dismissable={!isPending}
        >
            <div className="flex flex-wrap justify-center gap-2 mt-2 p-1">
                {choice.candidateColors.map((color) => (
                    <button
                        key={color}
                        type="button"
                        disabled={isPending}
                        onClick={() => void handlePick(color)}
                        title={`Spend {${color}}`}
                        className="flex items-center justify-center gap-0.5 rounded-full bg-white/5 p-2 cursor-pointer ring-1 ring-white/15 transition-colors hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <img
                            src={`/img/symbols/${color}.svg`}
                            alt={color}
                            className="size-8 shrink-0"
                        />
                    </button>
                ))}
            </div>
        </GameDialog>
    );
}

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import LibraryOrderPicker, {
    type LookedAtCard,
} from "~/components/board/library-order/library-order-picker";

/** CR 603.3b (ADR 0058) — the simultaneous-trigger ordering picker. The chooser
 *  controls two or more triggered abilities that triggered from the same event
 *  and orders them on the stack. Reuses the scry/surveil drag strip in
 *  order-only (`none`) mode — every trigger is placed, only the sequence
 *  changes: rightmost = TOP OF STACK = resolves first.
 *
 *  `choice.candidateIds` is the chooser's slice in bottom-first (collection)
 *  order; the strip wants topmost-first (index 0 = current top), so the list is
 *  reversed on the way in. The strip returns the ordering topmost-first, which
 *  is exactly the wire contract `applyPendingChoiceSubmit` expects (index 0
 *  resolves first). Card art for each candidate is resolved through the
 *  projected off-stack `pendingTriggerBatch` (CR 603.3b — the triggers are
 *  public). */
export default function TriggerOrderPrompt({
    choice,
    gameId,
}: {
    choice: PendingChoice;
    gameId: Id<"games">;
}) {
    const { pendingTriggerBatch } = useGameContext();
    const submitResolutionChoice = useMutation(api.game.submitResolutionChoice);
    const [submitting, setSubmitting] = useState(false);

    const batchById = new Map(
        (pendingTriggerBatch ?? []).map((c) => [c.id, c])
    );
    const ids = choice.candidateIds ?? [];
    const lookedAt: LookedAtCard[] = [...ids].reverse().map((id) => ({
        instanceId: id,
        defId:
            (batchById.get(id)?.card as { id?: string } | undefined)?.id ?? "",
    }));

    const handleConfirm = async (topmostFirst: string[]) => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await submitResolutionChoice({
                gameId,
                playerId: choice.playerId,
                stackItemId: choice.stackItemId,
                step: choice.step,
                choiceId: choice.choiceId,
                cardInstanceIds: topmostFirst,
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <LibraryOrderPicker
            lookedAt={lookedAt}
            destination="none"
            prompt={choice.prompt}
            submitting={submitting}
            rightLabelOverride="TOP OF STACK"
            onConfirm={(topmostFirst) => handleConfirm(topmostFirst)}
        />
    );
}

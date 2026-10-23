import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { usePendingChoicePrimaryAction } from "~/hooks/usePendingChoicePrimaryAction";
import { Button } from "~/components/ui/button";

/** Footer of the graveyard picker while a `may-pay` GRAVEYARD leg is being
 *  paid (CR 118.3 / 118.12a — "sacrifice it unless you return a basic land
 *  card from your graveyard to your hand"). The picker opens as a modal over
 *  the board-level prompt, so both answers live here: Return commits the
 *  buffered cards through the shared primary action (the same `submitMayPay`
 *  path as the prompt's Pay button and the Space hotkey), Decline refuses the
 *  payment. */
export default function MayPayGraveyardConfirm({
    required,
}: {
    required: number;
}) {
    const { gameId, playerId } = useGameContext();
    const { buffer } = usePendingChoiceBuffer();
    const primary = usePendingChoicePrimaryAction();
    const submitMayPay = useMutation(api.game.submitMayPay);
    const [isDeclining, setIsDeclining] = useState(false);
    const busy = isDeclining || (primary?.isPending ?? false);

    return (
        <div className="flex gap-2">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={async () => {
                    setIsDeclining(true);
                    try {
                        await submitMayPay({ gameId, playerId, accept: false });
                    } finally {
                        setIsDeclining(false);
                    }
                }}
            >
                Decline
            </Button>
            <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy || !(primary?.canConfirm ?? false)}
                onClick={() => primary?.confirm()}
            >
                {`Return (${buffer.length}/${required})`}
            </Button>
        </div>
    );
}

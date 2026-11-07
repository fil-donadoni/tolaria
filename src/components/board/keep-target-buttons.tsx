import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingTarget, Player, StackItem } from "~/types/game";
import { Button } from "~/components/ui/button";
import { keepTargetRows } from "~/lib/keep-target-rows";

/** CR 115.7d / 707.10c — a "choose new targets" prompt may leave a current target
 *  unchanged even if it is illegal by now, so it can't be clicked on the board,
 *  or gone from its zone. One button per such target of the group being
 *  answered; a keep is one more pick, the server re-validates it. */
export default function KeepTargetButtons({
    pendingTarget,
    players,
    stack,
    gameId,
    playerId,
}: {
    pendingTarget: PendingTarget;
    players: readonly Player[];
    stack: readonly StackItem[];
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectTarget = useMutation(api.game.selectTarget);
    const [isBusy, setIsBusy] = useState(false);
    const rows = keepTargetRows(pendingTarget, players, stack);
    if (rows.length === 0) return null;
    return (
        <div data-keep-targets className="flex flex-wrap gap-2">
            {rows.map((row) => (
                <Button
                    key={row.key}
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isBusy}
                    onClick={async () => {
                        if (isBusy) return;
                        setIsBusy(true);
                        try {
                            await selectTarget({
                                gameId,
                                playerId,
                                targetType: row.targetType,
                                targetId: row.targetId,
                                ...(row.targetPlayerId
                                    ? { targetPlayerId: row.targetPlayerId }
                                    : {}),
                            });
                        } finally {
                            setIsBusy(false);
                        }
                    }}
                >
                    {row.label}
                </Button>
            ))}
        </div>
    );
}

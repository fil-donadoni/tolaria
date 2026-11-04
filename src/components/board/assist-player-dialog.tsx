import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AssistChoice, Player } from "~/types/game";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";

/** CR 702.132a — Assist's first step: the caster may choose another player, who
 *  may then pay any amount of the spell's generic mana. Each button is one answer;
 *  dismissing cancels the cast, like every other cast picker. */
export default function AssistPlayerDialog({
    choice,
    allPlayers,
    gameId,
    playerId,
}: {
    choice: AssistChoice;
    allPlayers: Player[];
    gameId: Id<"games">;
    playerId: string;
}) {
    const selectAssistPlayer = useMutation(api.game.selectAssistPlayer);
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
            title={`Assist ${choice.spell.spellName}`}
            subtitle="You may choose another player, who can pay any amount of this spell's generic mana."
            dismissable={!isPending}
        >
            <div className="flex flex-wrap justify-center gap-2 mt-2 p-1">
                {choice.candidateIds.map((id) => (
                    <Button
                        key={id}
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                            void run(() =>
                                selectAssistPlayer({
                                    gameId,
                                    playerId,
                                    assistPlayerId: id,
                                })
                            )
                        }
                    >
                        {`Ask ${allPlayers.find((p) => p.id === id)?.name ?? "opponent"}`}
                    </Button>
                ))}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() =>
                        void run(() => selectAssistPlayer({ gameId, playerId }))
                    }
                >
                    Pay it yourself
                </Button>
            </div>
        </GameDialog>
    );
}

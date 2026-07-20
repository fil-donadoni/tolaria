import { useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { Panel } from "~/components/ui/panel";
import CoinFlipAnimation from "~/components/board/coin-flip-animation";

/** Center-screen reveal for an engine-drawn random outcome (CR 705.2,
 *  ADR 0023). Mounted by `PendingChoicePrompt` when the head pending choice is
 *  a `random-reveal` — there is NO decision, so no buttons. Both clients render
 *  the same animation off the same persisted outcome; the CHOOSER's client
 *  auto-acknowledges (`submitRandomRevealAck`) when the animation ends, the
 *  opponent only watches. The board is dimmed; the label is viewer-relative
 *  ("You win the flip" / "{Name} wins the flip"), with the realized
 *  `consequence` as a one-line preview.
 *
 *  Routes on `randomKind`: `coin` ships now; `die` is deferred (ADR 0023). */
export default function RandomRevealOverlay({
    choice,
    playerId,
    gameId,
}: {
    choice: PendingChoice;
    playerId: string;
    gameId: Id<"games">;
}) {
    const { allPlayers } = useGameContext();
    const submitRandomRevealAck = useMutation(api.game.submitRandomRevealAck);
    // The chooser's client owns the ack; the gate also avoids a double submit
    // (the engine resume is replay-safe regardless of who acks).
    const isChooser = choice.playerId === playerId;
    const acked = useRef(false);

    const result = choice.result ?? 0;
    const won = result === 1;
    const face = choice.realized?.face ?? (won ? "WIN" : "LOSE");
    const consequence = choice.realized?.consequence ?? "";
    const chooserName =
        allPlayers.find((p) => p.id === choice.playerId)?.name ?? "Opponent";

    // Viewer-relative outcome line (user stories 7 / 6): the flipper sees
    // "You win/lose the flip"; everyone else sees "{Name} wins/loses the flip".
    const label = isChooser
        ? won
            ? "You win the flip"
            : "You lose the flip"
        : won
          ? `${chooserName} wins the flip`
          : `${chooserName} loses the flip`;

    function handleLanded() {
        if (!isChooser || acked.current) return;
        acked.current = true;
        void submitRandomRevealAck({
            gameId,
            playerId,
            stackItemId: choice.stackItemId,
            choiceId: choice.choiceId,
        });
    }

    return (
        <div className="absolute inset-0 z-modal flex items-center justify-center bg-scrim backdrop-blur-sm">
            <Panel
                density="compact"
                className="flex flex-col items-center gap-4 px-8 py-6"
            >
                {choice.randomKind === "coin" && (
                    <CoinFlipAnimation
                        result={result}
                        face={face}
                        onLanded={handleLanded}
                    />
                )}

                <p className="font-beleren text-sm tracking-wide text-parchment">
                    {label}
                </p>
                {consequence && (
                    <p className="text-xs text-text-muted">{consequence}</p>
                )}
            </Panel>
        </div>
    );
}

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { REVEAL_FINAL_HOLD_MS } from "~/lib/random-reveal-pacing";
import { flipCaption, flipTone } from "~/lib/random-reveal-flip";
import { Panel } from "~/components/ui/panel";
import CoinFlipAnimation from "~/components/board/coin-flip-animation";
import RandomRevealSourceRow from "~/components/board/random-reveal-source-row";

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
    const [skipped, setSkipped] = useState(false);
    const [landed, setLanded] = useState(false);
    const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => () => clearTimeout(holdTimer.current), []);

    // CR 705.2 — the overlay shows one coin: the first of the Flip Sequence. A
    // reveal persisted before the list existed carries only `result`.
    const flip = choice.flips?.[0] ?? {
        flipperId: choice.playerId,
        face:
            (choice.result ?? 0) === 1
                ? ("heads" as const)
                : ("tails" as const),
        outcome:
            (choice.result ?? 0) === 1 ? ("win" as const) : ("lose" as const),
        round: 0,
    };
    const consequence = choice.realized?.consequence ?? "";
    const nameOf = (id: string) =>
        allPlayers.find((p) => p.id === id)?.name ?? "Opponent";
    const caption = flipCaption(
        flip,
        nameOf(flip.flipperId),
        flip.flipperId === playerId
    );
    const source = choice.source;

    function ack() {
        if (!isChooser || acked.current) return;
        acked.current = true;
        void submitRandomRevealAck({
            gameId,
            playerId,
            stackItemId: choice.stackItemId,
            choiceId: choice.choiceId,
        });
    }

    // The flipper's ack closes the overlay, so it waits out the final hold:
    // the result (halo + caption) stays readable after the coin lands.
    function handleLanded() {
        setLanded(true);
        if (!isChooser) return;
        clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(ack, REVEAL_FINAL_HOLD_MS);
    }

    // Click-to-end: a click mid-toss jumps the local animation to its result;
    // a click on the landed result acks at once (flipper only — a viewer's
    // click never acks and never closes their overlay).
    function handleClick() {
        if (!landed) setSkipped(true);
        else ack();
    }

    return (
        <div
            data-testid="random-reveal-overlay"
            className="absolute inset-0 z-modal flex cursor-pointer items-center justify-center modal-scrim"
            onClick={handleClick}
        >
            <Panel
                density="compact"
                className="flex w-[min(94vw,460px)] flex-col items-center gap-4 px-5 py-4"
            >
                {source && (
                    <RandomRevealSourceRow
                        cardId={source.cardId}
                        controllerName={nameOf(source.controllerId)}
                        controllerIsViewer={source.controllerId === playerId}
                        excerpt={choice.oracleExcerpt}
                    />
                )}
                {choice.randomKind === "coin" && (
                    <div className="pt-2">
                        <CoinFlipAnimation
                            face={flip.face}
                            tone={flipTone(flip)}
                            caption={caption}
                            skipped={skipped}
                            onLanded={handleLanded}
                        />
                    </div>
                )}
                {consequence && (
                    <p className="text-xs text-text-muted">{consequence}</p>
                )}
                {!landed && (
                    <p className="text-[10px] text-text-disabled">
                        Click to skip to the result
                    </p>
                )}
            </Panel>
        </div>
    );
}

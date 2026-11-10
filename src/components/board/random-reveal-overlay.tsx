import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FlipRecord } from "@convex/gre/types";
import type { PendingChoice } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useFlipSequencePlayback } from "~/hooks/useFlipSequencePlayback";
import { REVEAL_FINAL_HOLD_MS, tossMs } from "~/lib/random-reveal-pacing";
import {
    flipCaption,
    flipTone,
    flipsOfRound,
    revealRounds,
} from "~/lib/random-reveal-flip";
import {
    roundFlipperIds,
    roundsDamageConsequence,
} from "~/lib/random-reveal-rounds";
import { Panel } from "~/components/ui/panel";
import CoinFlipAnimation from "~/components/board/coin-flip-animation";
import FlipHistory from "~/components/board/flip-history";
import FlipRoundCoins from "~/components/board/flip-round-coins";
import FlipRoundTable from "~/components/board/flip-round-table";
import RandomRevealSourceRow from "~/components/board/random-reveal-source-row";

/** Center-screen reveal for an engine-drawn random outcome (CR 705.2,
 *  ADR 0023). Mounted by `PendingChoicePrompt` when the head pending choice is
 *  a `random-reveal` — there is NO decision, so no buttons. Both clients render
 *  the same animation off the same persisted Flip Sequence; the CHOOSER's
 *  client auto-acknowledges (`submitRandomRevealAck`) when the animation ends,
 *  the opponent only watches. The board is dimmed.
 *
 *  A sequence plays round by round (`useFlipSequencePlayback`): toss, HOLD the
 *  result, toss the next. Landed rounds pile up as a numbered history under the
 *  coin; the series' length — and the realized `consequence` — stay hidden
 *  until it ends, when "not flipped" ghosts fill up to the number the card
 *  announced. Click-to-end jumps to that final state.
 *
 *  When several players flip each round (Mana Clash), the round's coins toss
 *  side by side under seat chips and the history is a per-seat table, with a
 *  Damage total when the effect deals damage per face (`faceDamage`); the
 *  consequence line is then the viewer-relative damage summary.
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

    // CR 705.2 — one record per round (the first of it, for one flipper). A
    // reveal persisted before the list existed carries only `result`.
    const rounds = revealRounds(choice);
    const records: FlipRecord[] = Array.from({ length: rounds }, (_, i) => {
        const [flip] = flipsOfRound(choice.flips ?? [], i);
        return flip ?? legacyFlip(choice);
    });
    const { shownRound, landed, ended, skipped, onLanded, jump } =
        useFlipSequencePlayback(rounds);
    const flip = records[shownRound];

    const nameOf = (id: string) =>
        allPlayers.find((p) => p.id === id)?.name ?? "Opponent";
    const seatName = (id: string) => (id === playerId ? "You" : nameOf(id));
    // Several flippers per round (CR 705.2 — "You and target opponent each
    // flip a coin"): coins side by side, a per-seat table.
    const allFlips = choice.flips ?? [];
    const flipperIds = roundFlipperIds(allFlips);
    const multiSeat = flipperIds.length > 1;
    const consequence =
        multiSeat && choice.faceDamage
            ? roundsDamageConsequence(
                  allFlips,
                  choice.faceDamage,
                  nameOf,
                  playerId
              )
            : (choice.realized?.consequence ?? "");
    const caption = flipCaption(
        flip,
        nameOf(flip.flipperId),
        flip.flipperId === playerId
    );
    const source = choice.source;

    const ack = useCallback(() => {
        if (!isChooser || acked.current) return;
        acked.current = true;
        void submitRandomRevealAck({
            gameId,
            playerId,
            stackItemId: choice.stackItemId,
            choiceId: choice.choiceId,
        });
    }, [
        isChooser,
        submitRandomRevealAck,
        gameId,
        playerId,
        choice.stackItemId,
        choice.choiceId,
    ]);

    // The flipper's ack closes the overlay, so it waits out the final hold:
    // the last result (halo + caption) stays readable after the coin lands.
    useEffect(() => {
        if (!ended || !isChooser) return;
        const timer = setTimeout(ack, REVEAL_FINAL_HOLD_MS);
        return () => clearTimeout(timer);
    }, [ended, isChooser, ack]);

    // Click-to-end: a click mid-sequence jumps the local animation to its final
    // state; a click on the ended series acks at once (flipper only — a
    // viewer's click never acks and never closes their overlay).
    function handleClick() {
        if (!ended) jump();
        else ack();
    }

    // The coins that have landed: every earlier round, plus this one once it
    // has.
    const landedRounds = landed ? shownRound + 1 : shownRound;
    const landedRecords = records.slice(0, landedRounds);

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
                {choice.randomKind === "coin" && multiSeat && (
                    <div className="flex w-full flex-col items-center gap-3 pt-2">
                        <FlipRoundCoins
                            key={shownRound}
                            round={flipsOfRound(allFlips, shownRound)}
                            faceDamage={choice.faceDamage}
                            seatName={seatName}
                            viewerId={playerId}
                            durationMs={tossMs(shownRound)}
                            skipped={skipped}
                            onLanded={onLanded}
                        />
                        <FlipRoundTable
                            landed={allFlips.filter(
                                (f) => f.round < landedRounds
                            )}
                            flipperIds={flipperIds}
                            faceDamage={choice.faceDamage}
                            seatName={seatName}
                            viewerId={playerId}
                        />
                    </div>
                )}
                {choice.randomKind === "coin" && !multiSeat && (
                    <div className="flex flex-col items-center gap-3 pt-2">
                        {choice.flipLimit !== undefined && (
                            <p
                                data-testid="flip-heading"
                                className="text-xs font-semibold tracking-wide text-text-muted uppercase"
                            >
                                Flip {shownRound + 1} of up to{" "}
                                {choice.flipLimit}
                            </p>
                        )}
                        <CoinFlipAnimation
                            key={shownRound}
                            face={flip.face}
                            tone={flipTone(flip)}
                            caption={caption}
                            durationMs={tossMs(shownRound)}
                            skipped={skipped}
                            onLanded={onLanded}
                        />
                        <FlipHistory
                            landed={landedRecords}
                            limit={choice.flipLimit}
                            ended={ended}
                        />
                    </div>
                )}
                {ended && consequence && (
                    <p
                        data-testid="reveal-consequence"
                        className="text-xs text-text-muted"
                    >
                        {consequence}
                    </p>
                )}
                {!ended && (
                    <p className="text-[10px] text-text-disabled">
                        Click to skip to the result
                    </p>
                )}
            </Panel>
        </div>
    );
}

/** A reveal saved before the flip list existed: its single `result` is the
 *  flip. */
function legacyFlip(choice: PendingChoice): FlipRecord {
    const heads = (choice.result ?? 0) === 1;
    return {
        flipperId: choice.playerId,
        face: heads ? "heads" : "tails",
        outcome: heads ? "win" : "lose",
        round: 0,
    };
}

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import { interstitialChoiceState } from "~/lib/play-draw-choice";

type PregameDialogProps = {
    matchId: Id<"matches">;
    /** The viewer's seat id — resolves whether this client is the toss winner
     *  (the play/draw chooser), the waiter, or an auto-continue (bot chooser). */
    viewerId: string;
};

/**
 * The G1 coin-toss + play/draw gate (CR 103.2-103.4). The Match sits in
 * "pregame" with the toss winner recorded as `playDrawChooserId`; that winner
 * chooses play or draw, which `chooseFirstPlayer` turns into the turn-1 active
 * player before Game 1 is built. Once resolved, the Match flips to "playing" and
 * the game route reactively swaps this dialog for the board.
 *
 * Three viewer roles (via `interstitialChoiceState`):
 * - `prompt`  — this client won the toss (or is the sole solo controller): show
 *   the Play/Draw choice.
 * - `auto`    — a vs-AI bot won the toss: auto-continue (server forces "play").
 * - `waiting` — the human opponent won the toss: wait for their choice.
 */
export default function PregameDialog({
    matchId,
    viewerId,
}: PregameDialogProps) {
    const match = useQuery(api.matches.getMatch, { matchId });
    const chooseFirstPlayer = useMutation(api.game.chooseFirstPlayer);
    const [submitting, setSubmitting] = useState(false);
    // Guards the auto-continue effect against a double-fire (StrictMode / a
    // re-render before the reactive status flip lands).
    const autoFired = useRef(false);

    const choiceKind = match
        ? interstitialChoiceState(match, viewerId).kind
        : undefined;

    const submit = async (choice?: "play" | "draw") => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await chooseFirstPlayer({ matchId, choice });
            // The route re-queries the game reactively; when the Match flips to
            // "playing" it swaps this dialog for the board. Nothing to do here.
        } catch {
            // A race (opponent already resolved it, or the match advanced)
            // leaves the reactive query to correct the view; re-enable in case
            // the dialog stays mounted.
            setSubmitting(false);
        }
    };

    // vs-AI bot chooser: continue automatically, exactly once.
    useEffect(() => {
        if (choiceKind === "auto" && !autoFired.current) {
            autoFired.current = true;
            void submit();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [choiceKind]);

    if (!match || choiceKind === undefined) {
        return (
            <GameDialog
                open
                align="center"
                title="Coin toss"
                dismissable={false}
            >
                <p className="mt-1 text-center text-sm text-text-muted">
                    Tossing…
                </p>
            </GameDialog>
        );
    }

    const winnerName =
        match.players.find((p) => p.id === match.playDrawChooserId)?.name ??
        "A player";

    if (choiceKind === "waiting") {
        return (
            <GameDialog
                open
                align="center"
                title="Coin toss"
                dismissable={false}
            >
                <div className="mt-1 flex flex-col gap-2">
                    <p className="text-center text-sm text-text-muted">
                        {/* v4 (ADR 0103 §4): Beleren is retired from chrome —
                            a name callout in the game-menu chrome moves onto
                            the display face, not the card face. */}
                        <span className="text-display tracking-wide text-accent-strong">
                            {winnerName}
                        </span>{" "}
                        won the coin toss.
                    </p>
                    <p className="text-center text-xs text-text-disabled">
                        Waiting for them to choose to play or draw…
                    </p>
                </div>
            </GameDialog>
        );
    }

    if (choiceKind === "auto") {
        return (
            <GameDialog
                open
                align="center"
                title="Coin toss"
                dismissable={false}
            >
                <p className="mt-1 text-center text-sm text-text-muted">
                    Starting the game…
                </p>
            </GameDialog>
        );
    }

    // `prompt`: this client is the toss winner (or the solo controller).
    return (
        <GameDialog
            open
            // Every body on this surface is centred (the toss result, the
            // waiting line, the Play/Draw pair) — the title follows it.
            align="center"
            title="Coin toss"
            subtitle={`${winnerName} won the toss`}
            dismissable={false}
        >
            <div className="mt-1 flex flex-col items-center gap-3">
                <p className="text-center text-xs text-text-muted">
                    Choose to play first or draw first.
                </p>
                {/* Two-column Play/Draw pair (ADR 0103 §22, prototype
                    `identity-dialogs.tsx` "Modal · Pregame"): the ivory
                    primary plate for Play, a hairline secondary for Draw —
                    the same Button primitive every other dialog action uses,
                    not a bespoke bordered `<button>`. */}
                <div className="grid w-full grid-cols-2 gap-2">
                    <Button
                        type="button"
                        variant="primary"
                        size="lg"
                        disabled={submitting}
                        onClick={() => void submit("play")}
                    >
                        Play
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        disabled={submitting}
                        onClick={() => void submit("draw")}
                    >
                        Draw
                    </Button>
                </div>
            </div>
        </GameDialog>
    );
}

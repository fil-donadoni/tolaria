import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { LimitedViewerPairingView } from "@convex/limited/eventProjection";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { useUserDecks } from "~/hooks/useUserDecks";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { Banner } from "~/components/ui/banner";
import ActionButton from "~/components/board/action-button";
import { deckPayload } from "~/lib/deckTypes";
import { storeSession } from "~/lib/session";

/** The one action a seat has on its own round pairing (PRD #1628 stories 8-13,
 *  issue #1645): start it, accept it, or resume the Match already in flight.
 *
 *  Every branch is decided from SERVER-projected state, never re-derived here:
 *  `viewerPairing.matchId` says whether the pairing's Match exists,
 *  `viewerIncomingChallenges`/`viewerOutgoingChallenge` (the same seam the free
 *  challenge panel reads) say whether it is addressed to the viewer or waiting
 *  on the opponent, and `myActiveGame` says whether the viewer is already in
 *  it. The server re-validates all of it — this component only chooses which
 *  affordance to render.
 *
 *  Rendered only for an UNDECIDED, non-bye pairing; a decided pairing is the
 *  round panel's own result line, and a bye has nothing to play. */
export default function LimitedRoundAction({
    eventId,
    event,
    pairing,
}: {
    eventId: Id<"limitedEvents">;
    event: LimitedEventView;
    pairing: LimitedViewerPairingView;
}) {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const userDecks = useUserDecks();
    const activeGame = useQuery(api.game.myActiveGame);
    const startPairingMatch = useMutation(api.game.startPairingMatch);
    const joinGame = useMutation(api.game.joinGame);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Legal-only, same rule as the challenge / vs-AI panels: the event's
    // `hasDeck` flag is existence-only, so a player who walked out of the
    // builder under 40 cards must not be offered a button the server rejects.
    const savedDeck = userDecks?.find(
        (d) =>
            d.limitedEventId === eventId &&
            d.limitedSeatId === String(pairing.seatIndex)
    );
    const myDeck = savedDeck?.isLegal ? savedDeck : undefined;

    const opponentLabel =
        pairing.opponentNickname ??
        `Seat ${(pairing.opponentSeatIndex ?? 0) + 1}`;

    // The pairing's Match addressed TO the viewer, if the opponent started it.
    //
    // Identified by the pairing's OWN `matchId`, never by the challenger's seat
    // alone: `viewerIncomingChallenges` carries every `waiting` challenge in the
    // event, and a FREE challenge the same seat sent during deckbuild is still
    // `waiting` when the phase flips to `playing`. Matching on the seat offered
    // that stale challenge as the round Match — accepting it joins an
    // UNRECORDED game and burns the single-active-Match slot the real pairing
    // needs. Both sides of this comparison are server-derived.
    const incoming =
        pairing.matchId === null
            ? undefined
            : (event.viewerIncomingChallenges ?? []).find(
                  (c) => c.matchId === pairing.matchId
              );
    const resumable =
        activeGame && pairing.matchId !== null
            ? activeGame.matchId === pairing.matchId
                ? activeGame
                : null
            : null;

    const enter = async (
        gameId: Id<"games">,
        seatId: string
    ): Promise<void> => {
        storeSession(gameId, seatId);
        await navigate({ to: "/game" });
    };

    const run = async (action: () => Promise<void>) => {
        if (pending || !user) return;
        setPending(true);
        setError(null);
        try {
            await action();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to start the Match."
            );
            setPending(false);
        }
    };

    const handleStart = () =>
        void run(async () => {
            if (!myDeck || !user) return;
            const gameId = await startPairingMatch({
                eventId,
                deck: deckPayload(myDeck),
            });
            // A bot pairing starts as a vs-AI Match, where the viewer drives
            // the `-p1` seat (ADR 0001); a human pairing is an ordinary
            // 2-player Match seated on the user's own id.
            await enter(
                gameId,
                pairing.opponentIsBot ? `${user._id}-p1` : user._id
            );
        });

    const handleAccept = () =>
        void run(async () => {
            if (!myDeck || !user || !incoming) return;
            const gameId = incoming.gameId as Id<"games">;
            await joinGame({ gameId, deck: deckPayload(myDeck) });
            await enter(gameId, user._id);
        });

    const handleResume = () =>
        void run(async () => {
            if (!resumable || !user) return;
            await enter(
                resumable.gameId,
                resumable.solo ? `${user._id}-p1` : user._id
            );
        });

    const needsDeck = !myDeck && (
        <p className="text-sm text-text-muted" data-testid="round-needs-deck">
            {savedDeck
                ? "Finish your deck — it isn't legal for Limited yet."
                : "Build your deck to play your round Match."}
        </p>
    );

    return (
        <div className="mt-2 flex flex-col gap-2" data-testid="round-action">
            {error && (
                <Banner tone="danger" role="alert">
                    {error}
                </Banner>
            )}
            {incoming ? (
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text-muted">
                        {opponentLabel} started your round Match.
                    </span>
                    <ActionButton
                        onClick={handleAccept}
                        label="Accept Match"
                        tone="primary"
                        disabled={pending || !myDeck}
                    />
                </div>
            ) : resumable ? (
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text-muted">
                        Your round Match is in progress.
                    </span>
                    <ActionButton
                        onClick={handleResume}
                        label="Resume Match"
                        tone="primary"
                        disabled={pending}
                    />
                </div>
            ) : pairing.matchId === null ? (
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text-muted">
                        {pairing.opponentIsBot
                            ? "Play your pairing against this bot's drafted deck."
                            : "Start your pairing — your opponent accepts it from their own event page."}
                    </span>
                    <ActionButton
                        onClick={handleStart}
                        label="Start Match"
                        tone="primary"
                        disabled={pending || !myDeck}
                    />
                </div>
            ) : (
                <p
                    className="text-sm text-text-muted"
                    data-testid="round-waiting-accept"
                >
                    Waiting for {opponentLabel} to accept your round Match…
                </p>
            )}
            {needsDeck}
        </div>
    );
}

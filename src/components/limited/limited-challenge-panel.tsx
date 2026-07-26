import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { Banner } from "~/components/ui/banner";
import { useUserDecks } from "~/hooks/useUserDecks";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { deckPayload } from "~/lib/deckTypes";
import { storeSession } from "~/lib/session";
import ActionButton from "~/components/board/action-button";
import LimitedOpponentTile from "./limited-opponent-tile";

/** Challenge a human seat (issue #1577): once the viewer has built their own
 *  Limited deck for this event, they can challenge another SEATED HUMAN who
 *  also has a deck, or accept a challenge addressed to them — the human
 *  counterpart to `LimitedVsAiPanel`'s bot matches, closing the "test my deck
 *  against the TABLE" loop for real opponents (PRD #1107). A challenge is a
 *  waiting 2-player Match bound to the event (`challengeLimitedSeat`); the
 *  challenged player completes it with their own event deck (`joinGame`). The
 *  server validates both decks share the event. */
export default function LimitedChallengePanel({
    eventId,
    event,
    viewerSeatIndex,
}: {
    eventId: Id<"limitedEvents">;
    event: LimitedEventView;
    viewerSeatIndex: number;
}) {
    const navigate = useNavigate();
    const user = useCurrentUser();
    const userDecks = useUserDecks();
    const challengeSeat = useMutation(api.game.challengeLimitedSeat);
    const joinGame = useMutation(api.game.joinGame);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Legal-only, same as `LimitedVsAiPanel`: `challengeLimitedSeat` /
    // `joinGame` re-validate server-side, so an illegal deck must not be
    // offered a Challenge or Accept button here (the event's `hasDeck` flag is
    // existence-only — a player can walk out of the builder under 40 cards).
    const savedDeck = userDecks?.find(
        (d) =>
            d.limitedEventId === eventId &&
            d.limitedSeatId === String(viewerSeatIndex)
    );
    const myDeck = savedDeck?.isLegal ? savedDeck : undefined;

    // Human opponents with a deck of their own — the only seats a challenge can
    // pair with (a bot seat is handled by `LimitedVsAiPanel`, and a seat with
    // no deck could never accept). The server re-validates all of this.
    const opponentSeats = event.seats.filter(
        (s) =>
            !s.isBot &&
            s.userId !== undefined &&
            s.userId !== user?._id &&
            s.seatIndex !== viewerSeatIndex &&
            s.hasDeck
    );
    // Defensive defaults: the wire always carries these (see
    // `projectEventForViewer`), but a stale/partial client view must not crash
    // the whole event page over a missing challenge list.
    const incoming = event.viewerIncomingChallenges ?? [];
    const outgoing = event.viewerOutgoingChallenge ?? null;

    // Nothing to show if the viewer has no deck and there are no incoming
    // challenges — the whole surface is dead for a seat that hasn't built yet.
    if (!myDeck && incoming.length === 0) return null;
    if (opponentSeats.length === 0 && incoming.length === 0 && !outgoing) {
        return null;
    }

    const seatLabel = (seatIndex: number) =>
        event.seats.find((s) => s.seatIndex === seatIndex)?.nickname ??
        `Seat ${seatIndex + 1}`;

    const run = async (action: () => Promise<Id<"games">>) => {
        if (pending || !user) return;
        setPending(true);
        setError(null);
        try {
            const gameId = await action();
            storeSession(gameId, user._id);
            void navigate({ to: "/game" });
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to start the Match."
            );
            setPending(false);
        }
    };

    const handleChallenge = (seatIndex: number) => {
        if (!myDeck) return;
        void run(() =>
            challengeSeat({
                eventId,
                challengedSeatIndex: seatIndex,
                deck: deckPayload(myDeck),
            })
        );
    };

    const handleAccept = (gameId: string) => {
        if (!myDeck) return;
        void run(async () => {
            await joinGame({
                gameId: gameId as Id<"games">,
                deck: deckPayload(myDeck),
            });
            return gameId as Id<"games">;
        });
    };

    return (
        <div className="mt-4 border-t border-border-accent/20 pt-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
                Challenge a Player
            </h3>
            {error && (
                <Banner tone="danger" role="alert" className="mb-2">
                    {error}
                </Banner>
            )}

            {incoming.length > 0 && (
                <ul className="mb-3 flex flex-col gap-2">
                    {incoming.map((c) => (
                        <li
                            key={c.gameId}
                            className="flex items-center justify-between gap-2"
                        >
                            <span className="text-sm text-text">
                                {seatLabel(c.challengerSeatIndex)} challenged
                                you
                            </span>
                            <ActionButton
                                onClick={() => handleAccept(c.gameId)}
                                label="Accept"
                                tone="primary"
                                disabled={pending || !myDeck}
                            />
                        </li>
                    ))}
                </ul>
            )}

            {outgoing && (
                <p className="mb-3 text-sm text-text-muted">
                    Waiting for {seatLabel(outgoing.challengedSeatIndex)} to
                    accept your challenge…
                </p>
            )}

            {!myDeck && incoming.length > 0 && (
                <p className="text-sm text-text-muted">
                    {savedDeck
                        ? "Finish your deck — it isn't legal for Limited yet."
                        : "Build your deck to accept this challenge."}
                </p>
            )}

            {myDeck && !outgoing && opponentSeats.length > 0 && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    {opponentSeats.map((seat) => (
                        <LimitedOpponentTile
                            key={seat.seatIndex}
                            name={seat.nickname ?? `Seat ${seat.seatIndex + 1}`}
                            actionLabel="Challenge"
                            onAction={() => handleChallenge(seat.seatIndex)}
                            disabled={pending}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

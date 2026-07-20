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

/** "Play vs the Table" (PRD #1107 stories 24-25, ADR 0054/0055, issue
 *  #1115): once the viewer has built their own Limited deck for this event
 *  Seat, they can start a vs-AI Match against any Bot Drafter seat's
 *  Auto-Built deck — closing the study loop ("draft, build, then test your
 *  deck against the table's", PRD #1107 problem statement). Reuses the
 *  existing vsAi seat model UNCHANGED (`createSoloGame({ deck, deck2,
 *  vsAi: true })`, ADR 0001) — the bot's deck is tagged `format: "freeform"`
 *  on the wire because it isn't owned by ANY user's own Limited Event Seat
 *  (the ownership gate `loadLimitedPoolResolver` enforces for a `"limited"`
 *  deck would reject it outright); Freeform's validator is a permissive
 *  no-op, so the ALREADY-legal-by-construction Auto-Built decklist (issue
 *  #1115's own property test proves this against its seat's Pool) starts
 *  cleanly with zero changes to `convex/game.ts`. */
export default function LimitedVsAiPanel({
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
    const createSoloGame = useMutation(api.game.createSoloGame);
    const [pendingSeat, setPendingSeat] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const botSeats = event.seats.filter(
        (s) => s.isBot && s.autoBuiltDeck !== null
    );
    if (botSeats.length === 0) return null;

    const myDeck = userDecks?.find(
        (d) =>
            d.limitedEventId === eventId &&
            d.limitedSeatId === String(viewerSeatIndex)
    );

    const handlePlay = async (seat: (typeof botSeats)[number]) => {
        if (pendingSeat !== null || !user || !myDeck || !seat.autoBuiltDeck)
            return;
        setPendingSeat(seat.seatIndex);
        setError(null);
        const botLabel = seat.nickname ?? `Bot ${seat.seatIndex + 1}`;
        try {
            const gameId = await createSoloGame({
                name: `${user.nickname} vs ${botLabel}`,
                deck: deckPayload(myDeck),
                deck2: {
                    id: `limited-autobuild-${eventId}-${seat.seatIndex}`,
                    name: botLabel,
                    format: "freeform",
                    cards: seat.autoBuiltDeck.cards,
                    sideboard: seat.autoBuiltDeck.sideboard,
                },
                vsAi: true,
            });
            storeSession(gameId, `${user._id}-p1`);
            void navigate({ to: "/game" });
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to start the Match."
            );
        } finally {
            setPendingSeat(null);
        }
    };

    return (
        <div className="mt-4 border-t border-border-accent/20 pt-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
                Play vs the Table
            </h3>
            {!myDeck && (
                <p className="text-sm text-text-muted">
                    Build your deck to play against the table&apos;s Bot
                    Drafters.
                </p>
            )}
            {error && (
                <Banner tone="danger" role="alert" className="mb-2">
                    {error}
                </Banner>
            )}
            {myDeck && (
                <ul className="flex flex-col gap-2">
                    {botSeats.map((seat) => (
                        <li
                            key={seat.seatIndex}
                            className="flex items-center justify-between gap-2"
                        >
                            <span className="text-sm text-text">
                                {seat.nickname ?? `Bot ${seat.seatIndex + 1}`}
                                {seat.autoBuiltDeck && (
                                    <span className="ml-2 text-xs text-text-muted">
                                        {seat.autoBuiltDeck.colors.join("/")}
                                    </span>
                                )}
                            </span>
                            <ActionButton
                                onClick={() => void handlePlay(seat)}
                                label="Play"
                                tone="primary"
                                disabled={pendingSeat !== null}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

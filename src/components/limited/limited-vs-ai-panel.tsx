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
import LimitedOpponentTile from "./limited-opponent-tile";

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

    // Only a LEGAL deck can start a Match — `createGame`'s gate rejects
    // anything else server-side, and the event's own `hasDeck` flag is
    // existence-only, so a 30-card walk-away would otherwise show live Play
    // buttons that always error.
    const savedDeck = userDecks?.find(
        (d) =>
            d.limitedEventId === eventId &&
            d.limitedSeatId === String(viewerSeatIndex)
    );
    const myDeck = savedDeck?.isLegal ? savedDeck : undefined;

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
                Play vs Bots
            </h3>
            {!myDeck && (
                <p className="text-sm text-text-muted">
                    {savedDeck
                        ? "Finish your deck — it isn't legal for Limited yet."
                        : "Build your deck to play against the table's Bot Drafters."}
                </p>
            )}
            {error && (
                <Banner tone="danger" role="alert" className="mb-2">
                    {error}
                </Banner>
            )}
            {myDeck && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    {botSeats.map((seat) => (
                        <LimitedOpponentTile
                            key={seat.seatIndex}
                            name={seat.nickname ?? `Bot ${seat.seatIndex + 1}`}
                            colors={seat.autoBuiltDeck?.colors}
                            actionLabel="Play"
                            onAction={() => void handlePlay(seat)}
                            disabled={pendingSeat !== null}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

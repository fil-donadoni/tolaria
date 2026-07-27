import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import type { LimitedPairingResultSource } from "@convex/limited/eventTypes";
import type { Id } from "@convex/_generated/dataModel";
import { roundsForSeatCount } from "@convex/limited/swiss";
import { cn } from "~/lib/utils";
import LimitedRoundAction from "./limited-round-action";

/** How a decided pairing came to be decided, in words (PRD #1628 story 26 — a
 *  player must be able to tell a real win from an awarded one). */
const SOURCE_LABEL: Record<LimitedPairingResultSource, string> = {
    played: "Played",
    simulated: "Simulated",
    bye: "Bye",
    timeout: "Round deadline",
};

const OUTCOME_LABEL = {
    win: "Win",
    loss: "Loss",
    draw: "Draw",
} as const;

const OUTCOME_TONE = {
    win: "text-success-strong",
    loss: "text-danger-strong",
    draw: "text-text-muted",
} as const;

/** The round panel (PRD #1628 stories 6-7/21/26, issue #1644): while the
 *  event's Swiss rounds are running, this is what replaces the free-challenge
 *  and Play-vs-Bots panels — the current round, and the ONE pairing the viewer
 *  actually has to care about.
 *
 *  Reads `event.currentRound` and `event.viewerPairing`, both projected
 *  server-side (`projectLimitedEvent`) — in particular the pairing's `outcome`
 *  is NOT re-derived here: `classifyPairingResult` is the single authority on
 *  whether a recorded result is a win, and a client re-implementing it is
 *  exactly the drift ADR 0076 exists to prevent.
 *
 *  An UNDECIDED, non-bye pairing also carries its one action — start / accept /
 *  resume the pairing's Match (issue #1645) — delegated to
 *  `LimitedRoundAction`, which owns that whole decision. */
export default function LimitedRoundPanel({
    eventId,
    event,
}: {
    eventId: Id<"limitedEvents">;
    event: LimitedEventView;
}) {
    if (event.currentRound === undefined) return null;

    const totalRounds = roundsForSeatCount(event.seatCount);
    // `?? null` rather than a bare read: the wire always carries the field
    // (explicitly `null` when the viewer has no pairing), but a panel that
    // crashes the whole event page on a missing optional is not a trade worth
    // making for one saved character.
    const pairing = event.viewerPairing ?? null;

    return (
        <div className="flex flex-col gap-1.5" data-testid="round-panel">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Round {event.currentRound} of {totalRounds}
            </h3>
            <div className="rounded-sm border border-border-subtle/40 bg-surface-elevated px-3 py-2 text-sm">
                {pairing === null ? (
                    <p className="text-text-muted" data-testid="round-no-seat">
                        You have no seat in this event — the standings below
                        follow the table.
                    </p>
                ) : pairing.isBye ? (
                    <p data-testid="round-pairing-bye">
                        <span className="font-semibold text-text">
                            You have a bye this round.
                        </span>{" "}
                        <span className="text-text-muted">
                            It counts as a match win ({pairing.gameWins ?? 0}-
                            {pairing.gameLosses ?? 0}).
                        </span>
                    </p>
                ) : (
                    <div
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
                        data-testid="round-pairing"
                        data-opponent-seat={pairing.opponentSeatIndex ?? ""}
                    >
                        <span className="text-text-muted">You play</span>
                        <span className="font-semibold text-text">
                            {pairing.opponentNickname ??
                                `Seat ${(pairing.opponentSeatIndex ?? 0) + 1}`}
                        </span>
                        <span
                            className="text-xs uppercase tracking-wide text-text-muted"
                            data-testid="round-opponent-kind"
                        >
                            {pairing.opponentIsBot ? "Bot" : "Human"}
                        </span>
                        {pairing.outcome === null ? (
                            <span
                                className="text-text-muted"
                                data-testid="round-pairing-status"
                            >
                                — not played yet
                            </span>
                        ) : (
                            <span
                                className="flex items-baseline gap-2"
                                data-testid="round-pairing-status"
                            >
                                <span
                                    className={cn(
                                        "font-semibold",
                                        OUTCOME_TONE[pairing.outcome]
                                    )}
                                >
                                    {OUTCOME_LABEL[pairing.outcome]}
                                </span>
                                <span className="tabular-nums text-text-muted">
                                    {pairing.gameWins}-{pairing.gameLosses}
                                </span>
                                {pairing.result && (
                                    <span className="text-xs uppercase tracking-wide text-text-muted">
                                        {SOURCE_LABEL[pairing.result.source]}
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                )}
                {pairing !== null &&
                    pairing.outcome === null &&
                    !pairing.isBye && (
                        <LimitedRoundAction
                            eventId={eventId}
                            event={event}
                            pairing={pairing}
                        />
                    )}
                {pairing !== null &&
                    pairing.outcome !== null &&
                    !pairing.roundComplete && (
                        <p
                            className="mt-1 text-xs italic text-text-muted"
                            data-testid="round-waiting"
                        >
                            Waiting on another seat to finish this round.
                        </p>
                    )}
            </div>
        </div>
    );
}

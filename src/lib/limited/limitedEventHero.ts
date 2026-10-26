// The event page's hero logic (PRD #5383, issue #5389).
//
// PURE — no React, no Convex client: which phase of the Waiting ▸ Draft ▸
// Deckbuilding ▸ Games ▸ Done stepper an event is in, and the ONE primary
// action the viewer's role calls for in that phase. The components render what
// this module says; they never branch on `status` themselves.
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { DIFFICULTY_LABEL } from "~/lib/difficultyLabels";
import {
    limitedEventStatusHint,
    type LimitedEventStatusHint,
} from "~/lib/limitedEventStatus";

/** The stepper's steps, in order. */
export const LIMITED_EVENT_PHASES = [
    "waiting",
    "draft",
    "deckbuilding",
    "games",
    "done",
] as const;

export type LimitedEventPhase = (typeof LIMITED_EVENT_PHASES)[number];

export const LIMITED_EVENT_PHASE_LABEL: Record<LimitedEventPhase, string> = {
    waiting: "Waiting",
    draft: "Draft",
    deckbuilding: "Deckbuilding",
    games: "Games",
    done: "Done",
};

const PHASE_OF_HINT: Record<LimitedEventStatusHint, LimitedEventPhase> = {
    open: "waiting",
    drafting: "draft",
    deckbuilding: "deckbuilding",
    // Every deck is in but the rounds have not opened: still the building step.
    "ready to play": "deckbuilding",
    playing: "games",
    finished: "done",
};

/** The stepper step the event is in. */
export function limitedEventPhase(
    event: Pick<
        LimitedEventView,
        "status" | "type" | "draftCompletedAt" | "completed"
    >
): LimitedEventPhase {
    return PHASE_OF_HINT[limitedEventStatusHint(event)];
}

/** Who is looking: the creator (seated or not), a seated player, or a visitor
 *  with no seat. */
export type LimitedViewerRole = "creator" | "seated" | "visitor";

export function limitedViewerRole(
    isCreator: boolean,
    hasSeat: boolean
): LimitedViewerRole {
    if (isCreator) return "creator";
    return hasSeat ? "seated" : "visitor";
}

export type LimitedHeroCta =
    | { kind: "join"; label: string }
    | { kind: "start"; label: string }
    | { kind: "draft"; label: string }
    | { kind: "build"; label: string }
    | { kind: "play"; label: string }
    | { kind: "back"; label: string }
    /** Disabled: nothing for the viewer to do until the table moves on. */
    | { kind: "waiting"; label: string };

export interface LimitedEventHero {
    phase: LimitedEventPhase;
    role: LimitedViewerRole;
    /** The one primary action. Always present: when there is nothing to do it
     *  is the disabled `waiting` shape, so a phase always has exactly one. */
    cta: LimitedHeroCta;
    /** A quieter second action, only where one viewer legitimately has two
     *  (an unseated creator may take a seat or Start without playing). */
    secondary: LimitedHeroCta | null;
}

type HeroEvent = Pick<
    LimitedEventView,
    | "status"
    | "type"
    | "draftCompletedAt"
    | "completed"
    | "seatCount"
    | "seatsWithDeck"
    | "seats"
    | "viewerPairing"
>;

const JOIN: LimitedHeroCta = { kind: "join", label: "Join this event" };

function startCta(event: HeroEvent): LimitedHeroCta {
    const filled = event.seats.filter(
        (s) => s.userId !== undefined || s.isBot
    ).length;
    const bots = Math.max(0, event.seatCount - filled);
    return {
        kind: "start",
        label: bots === 0 ? "Start now" : `Start now · ${bots} bots fill in`,
    };
}

/** The phase's hero for one viewer. `viewerSeat` is the viewer's own seat, if
 *  they hold one. */
export function limitedEventHero(
    event: HeroEvent,
    viewer: { isCreator: boolean; seat: { hasDeck: boolean } | undefined }
): LimitedEventHero {
    const phase = limitedEventPhase(event);
    const role = limitedViewerRole(viewer.isCreator, viewer.seat !== undefined);
    const seat = viewer.seat;
    const waiting = (label: string): LimitedEventHero => ({
        phase,
        role,
        cta: { kind: "waiting", label },
        secondary: null,
    });
    const act = (cta: LimitedHeroCta): LimitedEventHero => ({
        phase,
        role,
        cta,
        secondary: null,
    });

    switch (phase) {
        case "waiting":
            if (role === "creator") {
                // Starting unseated is legitimate but must be deliberate: Join
                // leads, Start is the quieter second action (issue #5665).
                return seat
                    ? act(startCta(event))
                    : { phase, role, cta: JOIN, secondary: startCta(event) };
            }
            if (role === "visitor") return act(JOIN);
            return waiting("Waiting for the host to start");
        case "draft":
            return seat
                ? act({ kind: "draft", label: "Enter the Draft Room" })
                : waiting("Draft in progress");
        case "deckbuilding":
            if (!seat) return waiting("Players are building their decks");
            if (seat.hasDeck && event.seatsWithDeck >= event.seatCount) {
                return waiting("All decks are in — rounds are starting");
            }
            return seat.hasDeck
                ? waiting(
                      `Waiting — ${event.seatsWithDeck}/${event.seatCount} decks`
                  )
                : act({ kind: "build", label: "Build your deck" });
        case "games": {
            const pairing = event.viewerPairing;
            if (!seat || !pairing) return waiting("Rounds in progress");
            if (pairing.isBye) return waiting("You have a bye this round");
            if (pairing.outcome !== null) {
                return waiting("Round played — waiting for the table");
            }
            const opponent =
                pairing.opponentNickname ??
                `Seat ${(pairing.opponentSeatIndex ?? 0) + 1}`;
            return act({ kind: "play", label: `Play match vs ${opponent}` });
        }
        case "done":
            return act({ kind: "back", label: "Back to Limited events" });
    }
}

// --- Header chips -----------------------------------------------------------

/** The header's chips, in order: type · Pack Source, Games Format, seats, the
 *  Bot difficulty (issue #6916: the strength every Bot Match of the event is
 *  played at, read-only after start) and (Draft only) the pick timer. `sourceName` is the Pack Source's display name
 *  (PRD #5383, issue #5385); an event the catalogue cannot name shows the type
 *  alone. */
export function limitedEventChips(
    event: Pick<
        LimitedEventView,
        "type" | "seatCount" | "gamesFormat" | "botDifficulty" | "timerEnabled"
    >,
    sourceName: string | undefined
): string[] {
    const type = event.type === "draft" ? "Draft" : "Sealed";
    const chips = [
        sourceName === undefined ? type : `${type} · ${sourceName}`,
        event.gamesFormat === "bo1" ? "Best of 1" : "Best of 3",
        `${event.seatCount} seats`,
        `Bots: ${DIFFICULTY_LABEL[event.botDifficulty]}`,
    ];
    if (event.type === "draft") {
        chips.push(event.timerEnabled ? "Pick timer on" : "No pick timer");
    }
    return chips;
}

// --- Draft progress ---------------------------------------------------------

export type LimitedDraftPackState = "done" | "current" | "upcoming";

/** One row per booster round of a Draft: which are behind the table, which is
 *  in play and which are still to come. `draftRound` is the 0-indexed round in
 *  play; a completed draft has every pack behind it. */
export function limitedDraftPackProgress(
    event: Pick<
        LimitedEventView,
        "packSlots" | "draftRound" | "draftCompletedAt"
    >
): { index: number; state: LimitedDraftPackState }[] {
    const completed = event.draftCompletedAt !== undefined;
    const current = event.draftRound ?? 0;
    return event.packSlots.map((_, index) => ({
        index,
        state:
            completed || index < current
                ? "done"
                : index === current
                  ? "current"
                  : "upcoming",
    }));
}

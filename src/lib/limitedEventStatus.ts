import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import {
    areRoundsRunning,
    isEventConcluded,
    isSeatingOpen,
} from "@convex/limited/eventStatus";

/** The phases a viewer can be in for a seated Limited Event (issue #1582 — the
 *  lobby dashboard's Limited box quick re-entry list; extended with the play
 *  phase by PRD #1628 / ADR 0076). Derived purely from fields already on
 *  `LimitedEventView` — every one of them round-trips through
 *  `projectEventForViewer`/`projectLimitedEvent` (`convex/limitedEvents.ts`'s
 *  `limitedEventViewValidator` declares `status`, `type`, `draftCompletedAt`
 *  and `completed` on the wire), so this never needs a fatter server payload. */
export type LimitedEventStatusHint =
    | "open"
    | "drafting"
    | "deckbuilding"
    | "ready to play"
    | "playing"
    | "finished";

/** Event-level phase label (CR-adjacent domain state, not a raw DB enum):
 *  - `"open"` — still filling Seats.
 *  - `"drafting"` — a Draft event whose pool isn't final yet
 *    (`draftCompletedAt` unset). Sealed events skip this phase entirely —
 *    their Pools are dealt in full the instant `startEvent` runs, per the
 *    schema's own `status` doc comment.
 *  - `"deckbuilding"` — every seat's Pool is final (Sealed: always once
 *    Pools are dealt; Draft: once `draftCompletedAt` is set) but at least one
 *    seat still lacks a submitted/auto-built Deck (`!completed`).
 *  - `"ready to play"` — every seat has a Deck (`completed`) but the event's
 *    rounds haven't started.
 *  - `"playing"` — the event's Swiss rounds are running (PRD #1628).
 *  - `"finished"` — the last round is decided; standings are final.
 *
 *  The two play-phase branches are tested FIRST and answered by
 *  `convex/limited/eventStatus.ts`'s predicates rather than by comparing the
 *  raw status: the deck/pool-derived fallbacks below are all true during the
 *  play phase too, so a running event would otherwise keep reporting "ready to
 *  play" forever. */
export function limitedEventStatusHint(
    event: Pick<
        LimitedEventView,
        "status" | "type" | "draftCompletedAt" | "completed"
    >
): LimitedEventStatusHint {
    if (isSeatingOpen(event.status)) return "open";
    if (isEventConcluded(event.status)) return "finished";
    if (areRoundsRunning(event.status)) return "playing";
    if (event.type === "draft" && event.draftCompletedAt === undefined) {
        return "drafting";
    }
    return event.completed ? "ready to play" : "deckbuilding";
}

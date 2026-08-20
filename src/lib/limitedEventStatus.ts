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

/** The FILTER-granularity phase (issue #2590): the merged `/limited` list's
 *  status chips (open / drafting / building / playing / done) — coarser than
 *  `LimitedEventStatusHint`'s six values, which stays the per-row display
 *  granularity (`LimitedEventListItem` still shows "deckbuilding" vs "ready
 *  to play" verbatim). The collapse is deliberate: `"ready to play"` folds
 *  into `"building"` rather than `"playing"`, because at the DB level it is
 *  still `status: "started"` (`convex/limited/eventStatus.ts` —
 *  `areRoundsRunning` is false) — the event's rounds have not started, the
 *  seat is just done with its own deck. `"playing"` is reserved for the
 *  phase where `areRoundsRunning` is actually true. */
export type LimitedEventStatusChip =
    | "open"
    | "drafting"
    | "building"
    | "playing"
    | "done";

/** Every chip, in filter-bar order — the source of the union for the type
 *  guard below (mirrors `LIMITED_EVENT_STATUSES`' array-as-source pattern in
 *  `convex/limited/eventStatus.ts`). */
export const LIMITED_EVENT_STATUS_CHIPS = [
    "open",
    "drafting",
    "building",
    "playing",
    "done",
] as const satisfies readonly LimitedEventStatusChip[];

/** Runtime guard for a value coming off the URL (`?status=`), which is an
 *  untyped string until proven otherwise. */
export function isLimitedEventStatusChip(
    value: unknown
): value is LimitedEventStatusChip {
    return (
        typeof value === "string" &&
        (LIMITED_EVENT_STATUS_CHIPS as readonly string[]).includes(value)
    );
}

/** Collapses the six-value display hint down to the five-value filter chip —
 *  see the type doc above for where `"ready to play"` lands and why. */
export function limitedEventStatusChip(
    event: Pick<
        LimitedEventView,
        "status" | "type" | "draftCompletedAt" | "completed"
    >
): LimitedEventStatusChip {
    const hint = limitedEventStatusHint(event);
    switch (hint) {
        case "open":
            return "open";
        case "drafting":
            return "drafting";
        case "deckbuilding":
        case "ready to play":
            return "building";
        case "playing":
            return "playing";
        case "finished":
            return "done";
    }
}

/** The viewer's own match record for a list row (issue #2357), formatted
 *  the standard "wins-losses[-draws]" way — draws appended only when there
 *  ARE any (a `0`-draw event never shows the trailing `-0`). `null` (render
 *  nothing) when the row carries no record at all: an event that hasn't
 *  reached the play phase yet — see `limitedEventSummaryValidator`'s
 *  `viewerMatchRecord` (`convex/limitedEvents.ts`), which is already blank
 *  rather than `{ wins: 0, losses: 0, draws: 0 }` in that case, so this never
 *  has to re-derive the "reached the play phase" question itself. */
export function formatLimitedMatchRecord(
    record: { wins: number; losses: number; draws: number } | undefined
): string | null {
    if (!record) return null;
    return record.draws > 0
        ? `${record.wins}-${record.losses}-${record.draws}`
        : `${record.wins}-${record.losses}`;
}

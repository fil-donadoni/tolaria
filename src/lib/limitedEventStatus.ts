import type { LimitedEventView } from "~/hooks/useLimitedEvent";

/** The four phases a viewer can be in for a seated Limited Event (issue
 *  #1582 — the lobby dashboard's Limited box quick re-entry list). Derived
 *  purely from fields already on `LimitedEventView` — every one of them
 *  round-trips through `projectEventForViewer`/`projectLimitedEvent`
 *  (`convex/limitedEvents.ts`'s `limitedEventViewValidator` declares
 *  `status`, `type`, `draftCompletedAt` and `completed` on the wire), so this
 *  never needs a fatter server payload. */
export type LimitedEventStatusHint =
    | "open"
    | "drafting"
    | "deckbuilding"
    | "ready to play";

/** Event-level phase label (CR-adjacent domain state, not a raw DB enum):
 *  - `"open"` — still filling Seats (`status === "open"`).
 *  - `"drafting"` — a Draft event whose pool isn't final yet
 *    (`draftCompletedAt` unset). Sealed events skip this phase entirely —
 *    their Pools are dealt in full the instant `startEvent` runs, per the
 *    schema's own `status` doc comment.
 *  - `"deckbuilding"` — every seat's Pool is final (Sealed: always once
 *    `started`; Draft: once `draftCompletedAt` is set) but at least one seat
 *    still lacks a submitted/auto-built Deck (`!completed`).
 *  - `"ready to play"` — every seat has a Deck (`completed`); the event is
 *    playable (challenges, vs-AI). */
export function limitedEventStatusHint(
    event: Pick<
        LimitedEventView,
        "status" | "type" | "draftCompletedAt" | "completed"
    >
): LimitedEventStatusHint {
    if (event.status === "open") return "open";
    if (event.type === "draft" && event.draftCompletedAt === undefined) {
        return "drafting";
    }
    return event.completed ? "ready to play" : "deckbuilding";
}

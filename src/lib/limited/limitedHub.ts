// The `/limited` hub's logic (PRD #5383, issue #5388).
//
// PURE — no React, no Convex client: which events are "yours", which are
// joinable tables, which are history, the status-chip counts, the ONE primary
// CTA each phase calls for and the tile layout are all decided here, so the
// components only render what this module says. Reads the slim list views the
// two Limited list queries already return (`LimitedEventSummaryView`).
import type {
    LimitedEventSummaryView,
    PackSourceInfo,
} from "~/hooks/useLimitedEvent";
import {
    isLimitedEventJoinable,
    limitedEventDashboardRank,
    limitedEventStatusChip,
    type LimitedEventStatusChip,
} from "~/lib/limitedEventStatus";

/** The chips that narrow the hub's live sections; `history` swaps the hub for
 *  the finished-events view. */
export type LimitedHubLiveChip = Exclude<LimitedEventStatusChip, "history">;

export const LIMITED_HUB_LIVE_CHIPS: readonly LimitedHubLiveChip[] = [
    "waiting",
    "drafting",
    "building",
    "playing",
];

export interface LimitedHub {
    /** The viewer's in-progress events, the furthest-along first. */
    yours: LimitedEventSummaryView[];
    /** Tables the viewer can still take a seat at, newest first. */
    joinable: LimitedEventSummaryView[];
    /** Events the viewer sat in that are finished, newest first. */
    history: LimitedEventSummaryView[];
    /** Per chip: how many of the viewer's events and joinable tables are in
     *  that phase (`history` = finished events). Unaffected by `status`. */
    counts: Record<LimitedEventStatusChip, number>;
}

function hasViewerSeat(event: LimitedEventSummaryView, viewerId: string) {
    return event.seats.some((seat) => seat.userId === viewerId);
}

/** The hub's three event groups from the union of the two list queries.
 *  `label` is the fixture-label PREFIX (issue #2822): an unlabelled event
 *  never matches, which is what bounds the hub to the fixture. `status`
 *  narrows the live groups to one phase (`history` empties them: it is its own
 *  view). */
export function buildHub(
    events: readonly LimitedEventSummaryView[],
    viewerId: string,
    status: LimitedEventStatusChip | undefined,
    label: string | undefined
): LimitedHub {
    const byNewest = (a: LimitedEventSummaryView, b: LimitedEventSummaryView) =>
        b.createdAt - a.createdAt;
    const scoped = events.filter(
        (event) => !label || (event.label ?? "").startsWith(label)
    );
    const mine = scoped.filter((event) => hasViewerSeat(event, viewerId));
    const finished = (event: LimitedEventSummaryView) =>
        limitedEventStatusChip(event) === "history";

    const yours = mine
        .filter((event) => !finished(event))
        .sort(
            (a, b) =>
                limitedEventDashboardRank(a) - limitedEventDashboardRank(b) ||
                byNewest(a, b)
        );
    const joinable = scoped.filter(isLimitedEventJoinable).sort(byNewest);
    const history = mine
        .filter(finished)
        .sort((a, b) => b.updatedAt - a.updatedAt);

    const counts: Record<LimitedEventStatusChip, number> = {
        waiting: 0,
        drafting: 0,
        building: 0,
        playing: 0,
        history: history.length,
    };
    for (const event of [...yours, ...joinable]) {
        counts[limitedEventStatusChip(event)] += 1;
    }

    const inPhase = (event: LimitedEventSummaryView) =>
        status === undefined || limitedEventStatusChip(event) === status;
    return {
        yours: yours.filter(inPhase),
        joinable: joinable.filter(inPhase),
        history,
        counts,
    };
}

// --- Primary CTA ------------------------------------------------------------

export type LimitedHubCta =
    | { kind: "draft"; label: string }
    | { kind: "build"; label: string }
    | { kind: "play"; label: string }
    | { kind: "waiting"; label: string };

/** Seats a human or a Bot already holds. */
export function filledSeatCount(event: LimitedEventSummaryView): number {
    return event.seats.filter((s) => s.userId !== undefined || s.isBot).length;
}

/** The round the viewer plays next: matches already on their record + 1. */
function nextRound(event: LimitedEventSummaryView): number {
    const record = event.viewerMatchRecord;
    return record ? record.wins + record.losses + record.draws + 1 : 1;
}

/** The ONE primary action the viewer's phase calls for. `waiting` is the
 *  disabled shape: nothing for the viewer to do until the table fills or the
 *  other decks arrive. */
export function limitedHubCta(event: LimitedEventSummaryView): LimitedHubCta {
    switch (limitedEventStatusChip(event)) {
        case "drafting":
            return { kind: "draft", label: "Enter draft room" };
        case "building": {
            const viewerSeat = event.seats.find((s) => s.isViewer);
            if (viewerSeat && !viewerSeat.hasDeck) {
                return { kind: "build", label: "Build your deck" };
            }
            return {
                kind: "waiting",
                label: `Waiting — ${event.seatsWithDeck}/${event.seatCount} decks`,
            };
        }
        case "playing":
            return { kind: "play", label: `Play round ${nextRound(event)}` };
        case "waiting":
        case "history":
            return {
                kind: "waiting",
                label: `Waiting — ${filledSeatCount(event)}/${event.seatCount} seats`,
            };
    }
}

/** The chip's label as the hub words it. */
export const LIMITED_HUB_CHIP_LABEL: Record<LimitedEventStatusChip, string> = {
    waiting: "Waiting",
    drafting: "Drafting",
    building: "Building",
    playing: "Playing",
    history: "History",
};

// --- Pack Source ------------------------------------------------------------

/** The catalogue entry an event was created from. The event stores only its
 *  per-booster set codes, so the source is the one whose distinct sets are the
 *  event's distinct `packSlots`, in order (a block draft is INV → PLS → APC);
 *  a single-set event with no such entry still matches a source keyed on it. */
export function packSourceForEvent(
    event: Pick<LimitedEventSummaryView, "packSlots">,
    sources: readonly PackSourceInfo[]
): PackSourceInfo | undefined {
    const slots = [...new Set(event.packSlots)];
    const exact = sources.find(
        (source) =>
            source.sets.length === slots.length &&
            source.sets.every((set, i) => set.setCode === slots[i])
    );
    if (exact) return exact;
    return slots.length === 1
        ? sources.find((source) => source.key === slots[0])
        : undefined;
}

// --- Layout -----------------------------------------------------------------

/** Grid classes for tile `index` of "Your events" (the New event tile is the
 *  last, `index === eventCount`). One event: half a row each. Two or more: the
 *  first is a 2×2 lead; the New event tile takes the rest of its row when an
 *  even number of events sit beside the lead (half a row at 1 or 3 events),
 *  else the one cell left. Rows are a fixed height so tiles align. */
export function hubTileClasses(index: number, eventCount: number): string {
    const isNew = index === eventCount;
    if (eventCount === 1) return "lg:col-span-2";
    if (index === 0) return "sm:col-span-2 lg:row-span-2";
    if (isNew) {
        return (eventCount - 1) % 2 === 0
            ? "sm:col-span-2 lg:col-span-2"
            : "sm:col-span-1";
    }
    return "sm:col-span-1";
}

// LimitedEventListItem's viewer match record (issue #2357): the row already
// carried the phase chip via `limitedEventStatusHint`; this proves the new
// `viewerMatchRecord` field renders through the REAL `formatLimitedMatchRecord`
// helper (not a hand-built string) — present once rounds have started, blank
// (never a false "0-0") before that.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import LimitedEventListItem from "../limited-event-list-item";

afterEach(() => {
    cleanup();
});

function makeEvent(
    overrides: Partial<LimitedEventSummaryView>
): LimitedEventSummaryView {
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "started",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 0,
        packSlots: ["lea"],
        seats: [],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventSummaryView;
}

describe("LimitedEventListItem — viewer match record (issue #2357)", () => {
    it("renders no record segment when viewerMatchRecord is absent (event hasn't reached the play phase)", () => {
        render(
            <LimitedEventListItem
                event={makeEvent({ status: "started" })}
                viewerHasSeat
                onOpen={vi.fn()}
            />
        );
        // No stray "· 0-0" anywhere in the row.
        expect(screen.queryByText(/0-0/)).toBeNull();
    });

    it("renders 'wins-losses' once rounds are running, without a trailing draws segment when there are none", () => {
        render(
            <LimitedEventListItem
                event={makeEvent({
                    status: "playing",
                    viewerMatchRecord: { wins: 2, losses: 1, draws: 0 },
                })}
                viewerHasSeat
                onOpen={vi.fn()}
            />
        );
        expect(screen.getByText(/2-1/)).toBeTruthy();
        expect(screen.queryByText(/2-1-0/)).toBeNull();
    });

    it("appends the draws segment only when the viewer actually has one", () => {
        render(
            <LimitedEventListItem
                event={makeEvent({
                    status: "finished",
                    viewerMatchRecord: { wins: 1, losses: 0, draws: 1 },
                })}
                viewerHasSeat
                onOpen={vi.fn()}
            />
        );
        expect(screen.getByText(/1-0-1/)).toBeTruthy();
    });
});

// The row's stable DOM handle (issue #2822). `bun run check:ui`'s Limited
// walks used to select their subject by LIST POSITION, because nothing in the
// rendered DOM addressed one specific event — `key={event._id}` is a React
// key, not an attribute. These assertions read the attribute off the rendered
// element (`container.querySelector`), so they go red if the attribute is
// renamed, dropped, or emitted on the wrong node.
describe("LimitedEventListItem — fixture label handle (issue #2822)", () => {
    it("renders the seeded event's label as data-limited-event-label", () => {
        const { container } = render(
            <LimitedEventListItem
                event={makeEvent({ label: "ui-gate/draft" })}
                viewerHasSeat
                onOpen={vi.fn()}
            />
        );
        expect(
            container.querySelector(
                '[data-limited-event-label="ui-gate/draft"]'
            )
        ).toBeTruthy();
    });

    it("emits no label attribute for a player-created event (no label)", () => {
        const { container } = render(
            <LimitedEventListItem
                event={makeEvent({})}
                viewerHasSeat
                onOpen={vi.fn()}
            />
        );
        expect(
            container.querySelector("[data-limited-event-label]")
        ).toBeNull();
    });
});

// LimitedEventListItem is the hub's "Join a table" row (issue #5388): the
// event's name, the "Waiting for players" badge, one dot per seat, the free
// seats and Join. Rendered through the real component, never a hand-built
// string.
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

describe("LimitedEventListItem — seats (issue #5388)", () => {
    it("badges the table, draws one dot per seat and counts the free seats", () => {
        const { container } = render(
            <LimitedEventListItem
                event={makeEvent({
                    status: "open",
                    seatCount: 3,
                    seats: [
                        { seatIndex: 0, userId: "u", isBot: false },
                        { seatIndex: 1, isBot: true },
                        { seatIndex: 2, isBot: false },
                    ] as LimitedEventSummaryView["seats"],
                })}
                viewerHasSeat={false}
                onJoin={vi.fn()}
                onOpen={vi.fn()}
            />
        );
        expect(screen.getByText("Waiting for players")).toBeTruthy();
        expect(container.querySelectorAll("[data-seat-dot]")).toHaveLength(3);
        expect(
            container.querySelectorAll('[data-seat-dot="free"]')
        ).toHaveLength(1);
        expect(screen.getByText(/1 free seat$/)).toBeTruthy();
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

describe("LimitedEventListItem — Open Decklists (issue #5386)", () => {
    it("marks the row and warns beside Join for a seatless viewer", () => {
        const { container } = render(
            <LimitedEventListItem
                event={makeEvent({ status: "open", openDecklists: true })}
                viewerHasSeat={false}
                onJoin={vi.fn()}
                onOpen={vi.fn()}
            />
        );
        expect(screen.getByText(/· Open Decklists/)).toBeTruthy();
        expect(
            container.querySelector(
                '[data-slot="open-decklists-join-warning"]'
            )!.textContent
        ).toContain("your deck and pick order will be visible");
    });

    it("shows neither on an event without it", () => {
        const { container } = render(
            <LimitedEventListItem
                event={makeEvent({ status: "open", openDecklists: false })}
                viewerHasSeat={false}
                onJoin={vi.fn()}
                onOpen={vi.fn()}
            />
        );
        expect(screen.queryByText(/Open Decklists/)).toBeNull();
        expect(
            container.querySelector('[data-slot="open-decklists-join-warning"]')
        ).toBeNull();
    });
});

// The antechamber's compact avatar row + Table Ring dialog wiring (issue
// #2590): `LimitedTablePanel` used to render the full seat-tile grid inline;
// now it renders a compact avatar row, and "View Table" opens
// `LimitedTableRing` (ADR 0101 §6, issue #2587) as a dialog — the Ring
// already existed, this proves it is actually WIRED into the antechamber
// panel, not just still reachable from the Draft Room.
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedTablePanel from "../limited-table-panel";

// `LimitedTableRing` imports `lucide-react` icons and `@convex/limited/
// draftEngine`'s `passDirection` — both real, cheap, no mocking needed. It
// renders inside `GameDialog` -> `Dialog` (base-ui), which needs no provider
// mocking either (mirrors `limited-round-action.test.tsx`'s dialog coverage).

afterEach(() => cleanup());

function makeEvent(
    overrides: Partial<LimitedEventView> = {}
): LimitedEventView {
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "started",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 1,
        packSlots: ["lea"],
        seats: [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isBot: false,
                isViewer: true,
                poolCount: 40,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: null,
                hasDeck: true,
            },
            {
                seatIndex: 1,
                userId: undefined,
                nickname: undefined,
                isBot: false,
                isViewer: false,
                poolCount: null,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: null,
                hasDeck: false,
            },
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedTablePanel — compact avatar row + Table Ring dialog (issue #2590)", () => {
    it("renders one avatar per seat, and never the old full seat-tile grid text", () => {
        render(<LimitedTablePanel event={makeEvent()} showProgress={false} />);

        expect(screen.getByLabelText("Table seats")).toBeTruthy();
        // The old grid rendered "Open seat" as visible row text; the compact
        // row only carries it in the `title` attribute.
        expect(screen.queryByText("Open seat")).toBeNull();
    });

    it("does not render the Ring dialog content until View Table is clicked", () => {
        render(<LimitedTablePanel event={makeEvent()} showProgress={false} />);

        expect(screen.queryByText("The Table")).toBeNull();
    });

    it("opens the Table Ring dialog when View Table is clicked", () => {
        render(<LimitedTablePanel event={makeEvent()} showProgress={false} />);

        fireEvent.click(screen.getByText("View Table"));

        expect(screen.getByText("The Table")).toBeTruthy();
        // Both seats show up inside the ring, by nickname / seat fallback
        // (Alice appears twice: her own row, and as the "passes to" target
        // of the other seat with only two at the table).
        expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Seat 2/).length).toBeGreaterThan(0);
    });

    // Round-2 review finding: before issue #2590 the Ring was mounted only
    // from the Draft Room, where "packs passing" is always true. Mounting it
    // in the antechamber at every phase (this file) made the copy wrong for
    // any event not actually drafting — a Sealed event's default `makeEvent`
    // fixture (`type: "sealed"`, `status: "started"`, `completed: false`)
    // resolves to `limitedEventStatusHint === "deckbuilding"`, so the "packs
    // passing" clause must NOT appear.
    it("shows just the seat count, with no 'packs passing' copy, for a non-drafting event (Sealed, deckbuilding)", () => {
        render(<LimitedTablePanel event={makeEvent()} showProgress={false} />);

        fireEvent.click(screen.getByText("View Table"));

        // `GameDialog` renders the subtitle twice — once visible, once as a
        // sr-only `dialog-description` — so this asserts on the set of
        // matches rather than a single unique element.
        expect(screen.getAllByText("2 seats").length).toBeGreaterThan(0);
        expect(screen.queryByText(/packs passing/)).toBeNull();
    });

    it("keeps the full 'packs passing' subtitle for an event actually drafting", () => {
        render(
            <LimitedTablePanel
                event={makeEvent({
                    type: "draft",
                    status: "started",
                    draftCompletedAt: undefined,
                })}
                showProgress={false}
            />
        );

        fireEvent.click(screen.getByText("View Table"));

        expect(
            screen.getAllByText(/2 seats · packs passing/).length
        ).toBeGreaterThan(0);
    });

    it("still shows the decks-in progress bar when showProgress is true", () => {
        render(<LimitedTablePanel event={makeEvent()} showProgress />);

        expect(screen.getByText("1/2 decks in")).toBeTruthy();
        expect(screen.getByRole("progressbar")).toBeTruthy();
    });
});

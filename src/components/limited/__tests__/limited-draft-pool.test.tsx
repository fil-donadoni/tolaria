// Draft-time Pool surface tests (ADR 0060, issue #1247, seam 3). Drives
// `LimitedDraftPool` THROUGH the real reducer — `projectLimitedEvent`
// (`convex/limited/eventProjection.ts`), the same privacy-projection seam
// the client actually receives (per `.claude/rules/gre-development.md`'s
// "Frontend wiring analysis": a hand-built view/state masks a dropped
// field, so it doesn't count). Proves: (1) the old flat text list is gone —
// the shared deckbuilder surface (images, MV columns, Sideboard column)
// renders instead; (2) a card's Pool Arrangement placement (sideboard
// membership) survives the real projection and is honoured by the surface;
// (3) a Pool⇄Sideboard move fires `setPoolArrangementEntry` with the
// poolIndex resolved from the projected pool + arrangement, not a
// hand-picked index.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import LimitedDraftPool from "../limited-draft-pool";

const setPoolArrangementEntryMock = vi.fn().mockResolvedValue(null);
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

beforeEach(() => {
    vi.clearAllMocks();
    setPoolArrangementEntryMock.mockResolvedValue(null);
    useMutationMock.mockReturnValue(setPoolArrangementEntryMock);
});

afterEach(() => {
    cleanup();
    // Grouping/Ordering are per-USER preferences (issue #1620's
    // `deckViewPrefs` seam) written to `localStorage`, so a test that drives a
    // control would otherwise seed every later mount in this file.
    window.localStorage.clear();
});

const GROUPING_KEY = "tolaria:deckViewPrefs:grouping:";
const ORDERING_KEY = "tolaria:deckViewPrefs:ordering:";

// Real registry ids — the shared surface's `groupDeckIntoPiles` resolves
// each card via the card registry, so synthetic ids would throw.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function eventRow(
    poolArrangement?: LimitedEventRow["seats"][number]["poolArrangement"]
): LimitedEventRow {
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        draftCompletedAt: 1,
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                nickname: "Alice",
                pool: [
                    {
                        scryfallId: "s-bolt-1",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                    },
                    {
                        scryfallId: "s-bolt-2",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                    },
                    {
                        scryfallId: "s-plains",
                        cardId: PLAINS_ID,
                        cardName: "Plains",
                    },
                ],
                poolArrangement,
            },
            { seatIndex: 1, isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

describe("LimitedDraftPool through projectLimitedEvent (ADR 0060, issue #1247)", () => {
    it("renders the shared deckbuilder surface (MV columns, Sideboard column) — the old flat text list is gone", () => {
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;

        const { getByText, queryByText } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );

        // The shared surface's own headers (mana-value pile label + the
        // Sideboard column), not the old `LimitedPoolView` "N cards opened"
        // flat-list copy.
        expect(getByText("MV 1")).toBeTruthy();
        expect(getByText("Lands")).toBeTruthy();
        expect(getByText(/^Sideboard/)).toBeTruthy();
        expect(queryByText(/cards? opened/)).toBeNull();
    });

    it("with no Arrangement recorded, every card defaults to the Pool/Maindeck side — continuous draft→build, not the old all-Sideboard start", () => {
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.poolArrangement).toBeNull();

        const { getByText } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );
        expect(getByText(/^Pool 3/)).toBeTruthy();
        expect(getByText(/^Sideboard 0/)).toBeTruthy();
    });

    it("a card's Arrangement sideboard flag survives the real projection and renders in the Sideboard column", () => {
        const view = projectLimitedEvent(
            eventRow([{ poolIndex: 2, sideboard: true }]), // the Plains
            "user1"
        );
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.poolArrangement).toEqual([
            { poolIndex: 2, sideboard: true },
        ]);

        const { getByText } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );
        expect(getByText(/^Pool 2/)).toBeTruthy();
        expect(getByText(/^Sideboard 1/)).toBeTruthy();
    });

    it("moving a Pool card to the Sideboard resolves poolIndex from the PROJECTED pool + Arrangement and persists via setPoolArrangementEntry", () => {
        const view = projectLimitedEvent(
            eventRow([{ poolIndex: 0, sideboard: true }]), // first Bolt already sideboarded
            "user1"
        );
        const own = view.seats.find((s) => s.seatIndex === 0)!;

        const { getAllByTitle } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );

        // Two "Lightning Bolt" tiles now exist — one in the Pool column
        // (poolIndex 1, still main-side) and one in the Sideboard column
        // (poolIndex 0, already moved). The surface renders the Pool/Main
        // zone FIRST (left column), so index 0 is the movable one.
        const bolts = getAllByTitle(/Remove Lightning Bolt/);
        expect(bolts).toHaveLength(2);
        fireEvent.click(bolts[0]);
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 1,
            sideboard: true,
        });
    });

    it("stacks the Pool column's cards as an overlaid deckbuilder-style pile (absolute, staggered top per index)", () => {
        // Both Bolts default main-side into the MV 1 column → an overlaid
        // pile: each tile is `absolute` at a staggered `top` (idx 0, then 1).
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;

        const { getAllByTitle } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );

        const bolts = getAllByTitle(/Remove Lightning Bolt/) as HTMLElement[];
        expect(bolts).toHaveLength(2);
        for (const bolt of bolts) expect(bolt.className).toContain("absolute");
        // First card flush to the top, second revealed below it.
        expect(bolts[0].style.top).toContain("* 0");
        expect(bolts[1].style.top).toContain("* 1");
        expect(bolts[0].style.top).not.toEqual(bolts[1].style.top);
    });

    it("stacks the Sideboard column's cards as the SAME overlaid deckbuilder-style pile as the mana-value columns (issue #1574)", () => {
        // Both Bolts sideboarded → the Sideboard column must render an
        // overlaid pile identical in style to `LimitedPoolPile`: each tile
        // `absolute` at a staggered `top` offset, not a spaced flex list.
        const view = projectLimitedEvent(
            eventRow([
                { poolIndex: 0, sideboard: true },
                { poolIndex: 1, sideboard: true },
            ]),
            "user1"
        );
        const own = view.seats.find((s) => s.seatIndex === 0)!;

        const { getAllByTitle } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );

        const bolts = getAllByTitle(/Remove Lightning Bolt/) as HTMLElement[];
        expect(bolts).toHaveLength(2);
        for (const bolt of bolts) expect(bolt.className).toContain("absolute");
        expect(bolts[0].style.top).toContain("* 0");
        expect(bolts[1].style.top).toContain("* 1");
        expect(bolts[0].style.top).not.toEqual(bolts[1].style.top);
    });

    it("moving a Sideboard card back to the Pool persists sideboard: false at its resolved poolIndex", () => {
        const view = projectLimitedEvent(
            eventRow([{ poolIndex: 2, sideboard: true }]), // Plains sideboarded
            "user1"
        );
        const own = view.seats.find((s) => s.seatIndex === 0)!;

        const { getByTitle } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );

        fireEvent.click(getByTitle(/Remove Plains/));
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 2,
            sideboard: false,
        });
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The REDUCED draft bar (ADR 0075 §6, issue #1632). The draft Pool mounts the
// same `DeckZoneSurface` as both build views; what makes it the draft is
// exactly what it does NOT offer, so these assertions are all about absence —
// and absence is the failure mode nobody notices, which is why they are here
// rather than left to a glance at the screen.
// ────────────────────────────────────────────────────────────────────────────
describe("LimitedDraftPool — the reduced draft bar (ADR 0075 §6, issue #1632)", () => {
    function renderPool() {
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        return render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );
    }

    it("offers Grouping and Ordering on the Pool", () => {
        const { getByLabelText } = renderPool();
        expect(getByLabelText("Pool grouping")).toBeTruthy();
        expect(getByLabelText("Pool ordering")).toBeTruthy();
    });

    it("offers NO filter control — hiding cards mid-draft can hide picks you already made", () => {
        const { queryByLabelText } = renderPool();
        expect(queryByLabelText("Pool creature filter")).toBeNull();
        expect(queryByLabelText("Pool colour filter")).toBeNull();
        expect(queryByLabelText("Sideboard creature filter")).toBeNull();
        expect(queryByLabelText("Sideboard colour filter")).toBeNull();
    });

    it("offers NO column add/delete affordance — those are workbench gestures, not timed-draft ones", () => {
        const { queryByLabelText, container } = renderPool();
        expect(queryByLabelText("Add Pool column")).toBeNull();
        expect(queryByLabelText("Add Sideboard column")).toBeNull();
        // `DeckColumnActions` renders the per-column rename/delete controls;
        // the surface passes neither callback, so no column grows one.
        expect(
            container.querySelector('[aria-label^="Rename column"]')
        ).toBeNull();
        expect(
            container.querySelector('[aria-label^="Delete column"]')
        ).toBeNull();
        expect(
            container.querySelector('[aria-label^="Cannot delete column"]')
        ).toBeNull();
    });

    it("gives the narrow Sideboard strip no control bar of its own", () => {
        const { queryByLabelText } = renderPool();
        expect(queryByLabelText("Sideboard grouping")).toBeNull();
        expect(queryByLabelText("Sideboard ordering")).toBeNull();
    });

    it("renders the Catch-All Column exactly as elsewhere — always present (issue #1633), holding a card only when one falls through", () => {
        // Under Grouping `mv` with a registry-resolvable Pool nothing falls
        // through, so the Catch-All renders empty rather than not at all
        // (issue #1633 AC: "the Catch-All is always shown") — but it is
        // never CSS-hidden either, unlike an empty GENERATED column.
        {
            const { container } = renderPool();
            const catchAll = container.querySelector(
                '[data-column="catch-all"]'
            )!;
            expect(catchAll).toBeTruthy();
            expect(
                within(catchAll as HTMLElement).queryByRole("button")
            ).toBeNull();
            expect(catchAll.className.split(/\s+/)).not.toContain("hidden");
        }
        cleanup();

        // …and a card no generated Column claims lands in it, visible, rather
        // than vanishing — the whole guarantee the Catch-All exists for.
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        const { container } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={[
                    ...own.pool!,
                    {
                        scryfallId: "s-unknown",
                        cardId: "not-in-the-registry",
                        cardName: "Unresolvable Card",
                    },
                ]}
                arrangement={own.poolArrangement}
            />
        );
        const catchAll = container.querySelector('[data-column="catch-all"]')!;
        expect(catchAll).toBeTruthy();
        expect(
            within(catchAll as HTMLElement).getByTitle(
                /Remove Unresolvable Card/
            )
        ).toBeTruthy();
    });
});

describe("LimitedDraftPool — view preferences are the draft's own (issue #1632)", () => {
    function renderPool() {
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        return render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );
    }

    it("writes a Grouping change to the DRAFT key and leaves the build view's zones untouched", () => {
        const { getByLabelText } = renderPool();
        fireEvent.change(getByLabelText("Pool grouping"), {
            target: { value: "color" },
        });
        expect(window.localStorage.getItem(GROUPING_KEY + "draft")).toBe(
            '"color"'
        );
        expect(window.localStorage.getItem(GROUPING_KEY + "main")).toBeNull();
        expect(window.localStorage.getItem(GROUPING_KEY + "side")).toBeNull();
    });

    it("writes an Ordering change to the DRAFT key too", () => {
        const { getByLabelText } = renderPool();
        fireEvent.change(getByLabelText("Pool ordering"), {
            target: { value: "mv" },
        });
        expect(window.localStorage.getItem(ORDERING_KEY + "draft")).toBe(
            '"mv"'
        );
        expect(window.localStorage.getItem(ORDERING_KEY + "main")).toBeNull();
    });

    it("seeds from the DRAFT preference, not the build view's Maindeck one", () => {
        // The two disagree on purpose: a Pool reading `main` would render the
        // Mana-Value ladder, and a Pool reading nothing would render the `mv`
        // default — both distinguishable from the colour ladder below.
        window.localStorage.setItem(GROUPING_KEY + "draft", '"color"');
        window.localStorage.setItem(GROUPING_KEY + "main", '"mv"');
        const { getByText, queryByText } = renderPool();
        expect(getByText("Red")).toBeTruthy();
        expect(queryByText("MV 1")).toBeNull();
    });

    it("a Grouping change re-buckets the Pool live, and every Card Pin survives it (ADR 0075 §3)", () => {
        const view = projectLimitedEvent(
            eventRow([{ poolIndex: 0, pins: { mv: "mv:6" } }]),
            "user1"
        );
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        const { getByLabelText, container } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );
        const boltsIn = (columnId: string) =>
            within(
                container.querySelector(`[data-column="${columnId}"]`)!
            ).queryAllByTitle(/Remove Lightning Bolt/).length;

        expect(boltsIn("mv:6")).toBe(1);
        fireEvent.change(getByLabelText("Pool grouping"), {
            target: { value: "color" },
        });
        // The `mv` Pin is namespaced, so the colour view buckets by colour…
        expect(boltsIn("color:R")).toBe(2);
        fireEvent.change(getByLabelText("Pool grouping"), {
            target: { value: "mv" },
        });
        // …and flipping back finds the arrangement exactly as it was.
        expect(boltsIn("mv:6")).toBe(1);
    });
});

describe("LimitedDraftPool — the Booster and timer keep their vertical space (issue #1632)", () => {
    it("both panes clamp their own height so a big Pool scrolls inside them instead of growing the page", () => {
        // A flex child defaults to `min-height: auto` (= its content), which
        // is exactly what lets a 45-card Pool grow the row and push the
        // Booster and the descending timer off screen. Both panes must opt
        // out (`min-h-0`) and contain their own overflow; the surface's card
        // area (`flex-1 overflow-auto`) does the scrolling.
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        const { container } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );
        const root = container.firstElementChild as HTMLElement;
        const classesOf = (el: Element) => el.className.split(/\s+/);
        expect(classesOf(root)).toContain("min-h-0");
        expect(classesOf(root)).toContain("overflow-hidden");

        const [poolPane, sidePane] = [...root.children] as HTMLElement[];
        expect(classesOf(poolPane)).toContain("min-h-0");
        expect(classesOf(poolPane)).toContain("overflow-hidden");
        expect(classesOf(sidePane)).toContain("overflow-y-auto");

        // The scrolling actually happens in the surface's own card area.
        const scroller = poolPane.querySelector(".overflow-auto");
        expect(scroller).toBeTruthy();
        expect(classesOf(scroller!)).toContain("flex-1");
    });
});

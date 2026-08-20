// The Table Ring (ADR 0101 §6, issue #2587) — "seats, names, queued packs per
// seat, direction arrows, self at the bottom".
//
// Driven through the REAL projection: three of the four things the dialog
// renders (`poolCount`, `packQueueCount`, `isViewer`) are decided BY the
// projection, one of them per-seat differently, so a hand-built seat array
// would let the dialog pass while showing another seat's private state.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import LimitedTableRing from "../limited-table-ring";

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

afterEach(() => cleanup());

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

function poolOf(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        scryfallId: `s-${i}`,
        cardId: BOLT_ID,
        cardName: "Lightning Bolt",
    }));
}

/** Four seats, the viewer in the MIDDLE (seat 1) — the arrangement that makes
 *  "self at the bottom" a real rotation rather than a coincidence. */
function row(draftRound: number): LimitedEventRow {
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "draft",
        status: "started",
        seatCount: 4,
        packSlots: ["lea", "lea", "lea"],
        draftRound,
        seats: [
            { seatIndex: 0, isBot: true, nickname: "Bot 1", pool: poolOf(3) },
            {
                seatIndex: 1,
                userId: "user1",
                nickname: "Alice",
                pool: poolOf(3),
                currentPack: [],
                packQueue: [[], []],
            },
            { seatIndex: 2, isBot: true, nickname: "Bot 3", pool: poolOf(2) },
            { seatIndex: 3, isBot: true, nickname: "Bot 4", pool: poolOf(3) },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

function mountRing(draftRound: number) {
    const event = projectLimitedEvent(row(draftRound), "user1");
    render(
        <LimitedTableRing
            open
            onOpenChange={() => {}}
            event={event as never}
            round={draftRound}
        />
    );
    return [
        ...document.querySelectorAll("[data-slot=table-ring] li"),
    ] as HTMLElement[];
}

describe("LimitedTableRing (issue #2587)", () => {
    it("puts the viewer's own seat LAST, whatever its seat index", () => {
        const rows = mountRing(0);

        expect(rows.map((li) => li.dataset.seatIndex)).toEqual([
            "2",
            "3",
            "0",
            "1",
        ]);
        expect(rows.at(-1)!.dataset.isViewer).toBe("true");
        expect(rows.at(-1)!.textContent).toContain("Alice");
    });

    it("names each seat's downstream neighbour, and flips it when the round does", () => {
        // Round 0 passes LEFT (+1): seat 1 hands to seat 2.
        const left = mountRing(0);
        expect(
            left.find((li) => li.dataset.seatIndex === "1")!.textContent
        ).toContain("Bot 3");
        cleanup();

        // Round 1 passes RIGHT (-1): the same seat hands to seat 0 instead.
        // The direction comes from the server's `passDirection`, so this is
        // the assertion that would catch a client-side second opinion.
        const right = mountRing(1);
        expect(
            right.find((li) => li.dataset.seatIndex === "1")!.textContent
        ).toContain("Bot 1");
    });

    it("shows every seat's picks made, and a queued-pack count only where the wire carries one", () => {
        const rows = mountRing(0);
        const bySeat = (i: string) =>
            rows.find((li) => li.dataset.seatIndex === i)!;

        // `poolCount` is public for every seat, so the pace of the whole
        // table is readable.
        expect(bySeat("2").textContent).toContain("2 picked");
        expect(bySeat("1").textContent).toContain("3 picked");

        // `packQueueCount` is the viewer's own seat ONLY (the projection
        // strips it everywhere else) — the dialog must render that absence,
        // never a fabricated zero.
        expect(
            bySeat("1").querySelector("[data-slot=queued-packs]")!.textContent
        ).toBe("2 queued");
        expect(
            bySeat("0").querySelector("[data-slot=queued-packs]")!.textContent
        ).toBe("· · ·");
    });
});

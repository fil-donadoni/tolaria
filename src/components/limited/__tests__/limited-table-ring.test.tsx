// The Table Ring (ADR 0101 §6, issues #2587 / #5390) — seats on a ring with
// the viewer at the bottom, a queued-pack badge on EVERY seat while drafting,
// pass-direction arrows.
//
// Driven through the REAL projection: `packQueueCount` and `isViewer` are
// decided BY the projection, so a hand-built seat array would let the ring
// pass while the wire carries something else.
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
        ...document.querySelectorAll(
            "[data-slot=table-ring] [data-seat-index]"
        ),
    ] as HTMLElement[];
}

describe("LimitedTableRing (issues #2587, #5390)", () => {
    it("places the viewer's own seat at the bottom whatever its seat index", () => {
        const seats = mountRing(0);
        const me = seats.find((el) => el.dataset.isViewer === "true")!;
        expect(me.dataset.seatIndex).toBe("1");
        const slot = me.parentElement!;
        expect(parseFloat(slot.style.left)).toBeCloseTo(50);
        expect(parseFloat(slot.style.top)).toBeGreaterThan(80);
    });

    it("draws a pass arrow per seat, and flips them when the round does", () => {
        mountRing(0);
        const arrow = (from: string) =>
            document.querySelector(
                `[data-slot=pass-arrow][data-from="${from}"]`
            )!;
        // Round 0 passes LEFT (+1): seat 1 hands to seat 2.
        expect((arrow("1") as HTMLElement).dataset.to).toBe("2");
        cleanup();
        // Round 1 passes RIGHT (-1): the server's `passDirection`, not a
        // client-side second opinion.
        mountRing(1);
        expect((arrow("1") as HTMLElement).dataset.to).toBe("0");
    });

    it("shows a queued-pack badge on every seat from the projection's counts (issue #5390)", () => {
        const seats = mountRing(0);
        const badge = (i: string) =>
            seats
                .find((el) => el.dataset.seatIndex === i)!
                .querySelector("[data-slot=queued-packs]")?.textContent;
        expect(badge("1")).toBe("2 queued");
        expect(badge("0")).toBe("0 queued");
        expect(badge("2")).toBe("0 queued");
        expect(badge("3")).toBe("0 queued");
    });

    it("marks bots distinctly from humans", () => {
        const seats = mountRing(0);
        const kind = (i: string) =>
            seats.find((el) => el.dataset.seatIndex === i)!.dataset.seatKind;
        expect(kind("1")).toBe("human");
        expect(kind("0")).toBe("bot");
    });

    it("keeps each seat's picks made while drafting", () => {
        const seats = mountRing(0);
        const picked = (i: string) =>
            seats
                .find((el) => el.dataset.seatIndex === i)!
                .querySelector("[data-slot=picked]")?.textContent;
        expect(picked("2")).toBe("2 picked");
        expect(picked("1")).toBe("3 picked");
    });
});

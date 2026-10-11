// Pure placement for the table ring (issue #5390): viewer at the bottom, seat
// order following Draft adjacency, arrows following the round's direction.
import { describe, it, expect } from "vitest";
import {
    passArrows,
    placeSeatsOnRing,
    seatRecord,
    tableSummaryLine,
} from "../limitedTableRing";

const bySeat = (slots: ReturnType<typeof placeSeatsOnRing>, i: number) =>
    slots.find((s) => s.seatIndex === i)!;

describe("placeSeatsOnRing", () => {
    it("puts the viewer at the bottom centre whatever their seat index", () => {
        for (const viewer of [0, 1, 2, 3]) {
            const slots = placeSeatsOnRing([0, 1, 2, 3], viewer);
            const me = bySeat(slots, viewer);
            expect(me.x).toBeCloseTo(50);
            expect(me.y).toBeGreaterThan(80);
        }
    });

    it("follows Draft adjacency: seat +1 is the next slot clockwise (to the viewer's left)", () => {
        const slots = placeSeatsOnRing([0, 1, 2, 3], 1);
        // viewer = 1 at the bottom; 2 on the left, 3 on top, 0 on the right.
        expect(bySeat(slots, 2).x).toBeLessThan(20);
        expect(bySeat(slots, 3).y).toBeLessThan(20);
        expect(bySeat(slots, 0).x).toBeGreaterThan(80);
    });

    it("anchors seat 0 at the bottom for a viewer-less event", () => {
        const slots = placeSeatsOnRing([0, 1, 2], undefined);
        expect(bySeat(slots, 0).y).toBeGreaterThan(80);
    });
});

describe("passArrows", () => {
    const slots = placeSeatsOnRing([0, 1, 2, 3], 0);

    it("points each seat at its downstream neighbour, and flips with the round", () => {
        const left = passArrows(slots, 0);
        expect(left.find((a) => a.fromSeatIndex === 1)!.toSeatIndex).toBe(2);
        const right = passArrows(slots, 1);
        expect(right.find((a) => a.fromSeatIndex === 1)!.toSeatIndex).toBe(0);
    });

    it("draws nothing for a single seat", () => {
        expect(passArrows(placeSeatsOnRing([0], 0), 0)).toEqual([]);
    });
});

describe("seatRecord / tableSummaryLine", () => {
    const standings = [
        { seatIndex: 0, matchWins: 2, matchLosses: 1, matchDraws: 0 },
        { seatIndex: 1, matchWins: 0, matchLosses: 0, matchDraws: 0 },
        { seatIndex: 2, matchWins: 1, matchLosses: 1, matchDraws: 1 },
    ] as never;

    it("formats the record, null before any decided match", () => {
        expect(seatRecord({ standings }, 0)).toBe("2-1");
        expect(seatRecord({ standings }, 1)).toBeNull();
        expect(seatRecord({ standings }, 2)).toBe("1-1-1");
    });

    it("summarises humans, bots and open seats", () => {
        expect(
            tableSummaryLine([
                { isBot: false, userId: "a" },
                { isBot: true },
                { isBot: false },
            ])
        ).toBe("3 seats · 1 human · 1 bot · 1 open");
    });
});

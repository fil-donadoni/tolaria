// Draft Room Booster size modes (issue #9166). Pure numbers: the Fit all
// layout and its CEILING (the Read size) — with 2 cards left Fit all must not
// render posters.
import { describe, it, expect } from "vitest";
import { fitAllLayout, readCardWidth } from "../draftPackSizing";

const AREA = { width: 1300, height: 500 };
const CEILING = readCardWidth(1440);

describe("readCardWidth", () => {
    it("is 24% of the viewport, clamped to 224..352px", () => {
        expect(readCardWidth(400)).toBe(224);
        expect(readCardWidth(1000)).toBe(240);
        expect(readCardWidth(3000)).toBe(352);
    });
});

describe("fitAllLayout", () => {
    it("15 cards: the largest uncapped layout that fits the area", () => {
        const { columns, cardWidth } = fitAllLayout({
            count: 15,
            ...AREA,
            ceiling: CEILING,
        });
        // 8 columns x 2 rows: width-bound at (1300 - 7*12) / 8 = 152px.
        expect(columns).toBe(8);
        expect(cardWidth).toBe(152);
        const rows = Math.ceil(15 / columns);
        expect(
            rows * ((cardWidth * 7) / 5) + (rows - 1) * 12
        ).toBeLessThanOrEqual(AREA.height);
    });

    it("2 cards: capped at the Read size, never poster-sized, one row", () => {
        const { columns, cardWidth } = fitAllLayout({
            count: 2,
            ...AREA,
            ceiling: CEILING,
        });
        expect(cardWidth).toBe(CEILING);
        expect(columns).toBe(2);
    });

    it("never exceeds the ceiling for any pack size", () => {
        for (let count = 1; count <= 15; count++) {
            const { cardWidth } = fitAllLayout({
                count,
                width: 3000,
                height: 2000,
                ceiling: CEILING,
            });
            expect(cardWidth).toBeLessThanOrEqual(CEILING);
        }
    });

    it("an empty pack degrades to the ceiling in one column", () => {
        expect(fitAllLayout({ count: 0, ...AREA, ceiling: CEILING })).toEqual({
            columns: 1,
            cardWidth: CEILING,
        });
    });
});

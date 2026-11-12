// Issue #9326 — the focus veil's geometry: which DOM elements a lit node is,
// and the clip path that cuts them out of the veil.
import { describe, it, expect } from "vitest";
import { focusNodeSelectors, veilClipPath } from "../arrow-focus";
import { zonePileNodeId } from "../target-arrow-geometry";

const holeCount = (d: string) => (d.match(/ M /g) ?? []).length;

describe("focusNodeSelectors", () => {
    it("a zone pile node is its pile anchor", () => {
        expect(focusNodeSelectors(zonePileNodeId("graveyard", "p2"))).toEqual([
            '[data-arrow-anchor-graveyard="p2"]',
        ]);
    });

    it("any other node is looked up as a stack row, a permanent and a player", () => {
        expect(focusNodeSelectors("x1")).toEqual([
            '[data-arrow-anchor-stack="x1"]',
            '[data-arrow-anchor-permanent="x1"]',
            '[data-arrow-anchor-player="x1"]',
        ]);
    });
});

describe("veilClipPath", () => {
    const r = (left: number, top: number) => ({
        left,
        top,
        width: 100,
        height: 40,
    });

    it("cuts one hole per separate lit element", () => {
        expect(holeCount(veilClipPath([r(0, 0), r(500, 500)], 1000, 800))).toBe(
            2
        );
    });

    it("merges overlapping holes — two counter-clockwise holes would wind the overlap back into the veil", () => {
        // The same box twice (a spell row that is both source and target) and
        // two boxes overlapping by a few px both collapse to one hole.
        expect(holeCount(veilClipPath([r(0, 0), r(0, 0)], 1000, 800))).toBe(1);
        expect(holeCount(veilClipPath([r(0, 0), r(90, 30)], 1000, 800))).toBe(
            1
        );
    });

    it("no lit element: the veil is the whole viewport", () => {
        expect(veilClipPath([], 1000, 800)).toBe("M 0 0 H 1000 V 800 H 0 Z");
    });
});

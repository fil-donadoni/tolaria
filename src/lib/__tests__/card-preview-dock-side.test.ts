// Issue #8955 — the hover dock docks LEFT when the hovered card sits in the
// right-edge band the dock would occupy, else RIGHT. Pure decision.
import { describe, it, expect } from "vitest";
import {
    DOCK_WIDTH,
    chooseDockSide,
    dockWidth,
} from "../card-preview-placement";

const VP = { width: 1440, height: 900 };
const card = (left: number, width = 90) => ({ left, right: left + width });
/** An off-battlefield card (zone pile, hand, stack): its rect is tested. */
const off = (left: number, width = 90) =>
    ({ kind: "elsewhere", rect: card(left, width) }) as const;

describe("chooseDockSide (issue #8955)", () => {
    it("card clear of the right band → right", () => {
        expect(chooseDockSide(off(600), DOCK_WIDTH, VP)).toBe("right");
    });

    it("card flush-right (inside the band) → left", () => {
        expect(chooseDockSide(off(1440 - 8 - 90), DOCK_WIDTH, VP)).toBe("left");
    });

    it("card ending exactly at the band's left edge is clear → right", () => {
        const bandLeft = VP.width - 8 - DOCK_WIDTH;
        expect(
            chooseDockSide(
                { kind: "elsewhere", rect: { left: 0, right: bandLeft } },
                DOCK_WIDTH,
                VP
            )
        ).toBe("right");
    });

    it("a double-width dock widens the band", () => {
        const left = VP.width - 8 - DOCK_WIDTH - 100; // outside 1x band
        expect(chooseDockSide(off(left, 50), dockWidth(false), VP)).toBe(
            "right"
        );
        expect(chooseDockSide(off(left, 50), dockWidth(true), VP)).toBe("left");
    });
});

// Issue #9500 — on the battlefield the BOARD decides: the back row's right
// block (planeswalkers, battles, noncreature artifacts / enchantments) docks
// left, any other permanent docks right whatever its rect; and the dock keeps
// the hovered card's lit relationship clear (Serra Angel attacking a
// right-band planeswalker docks left).
describe("chooseDockSide — battlefield rule + lit relationship (issue #9500)", () => {
    const BF = { kind: "battlefield" } as const;
    const liliana = card(1440 - 8 - 90);

    it("back row right block (board-preferred) → left", () => {
        expect(chooseDockSide({ kind: "preferred-left" }, DOCK_WIDTH, VP)).toBe(
            "left"
        );
    });

    it("a battlefield creature docks right even inside the right band", () => {
        expect(chooseDockSide(BF, DOCK_WIDTH, VP)).toBe("right");
    });

    it("an attacker whose target sits in the right band → left", () => {
        expect(chooseDockSide(BF, DOCK_WIDTH, VP, [liliana])).toBe("left");
    });

    it("related nodes in BOTH bands → right", () => {
        expect(chooseDockSide(BF, DOCK_WIDTH, VP, [liliana, card(20)])).toBe(
            "right"
        );
    });

    it("an off-battlefield card keeps the rect rule and the relationship rule", () => {
        expect(chooseDockSide(off(600), DOCK_WIDTH, VP, [liliana])).toBe(
            "left"
        );
    });
});

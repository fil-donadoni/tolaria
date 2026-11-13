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

describe("chooseDockSide (issue #8955)", () => {
    it("card clear of the right band → right", () => {
        expect(chooseDockSide(card(600), DOCK_WIDTH, VP)).toBe("right");
    });

    it("card flush-right (inside the band) → left", () => {
        expect(chooseDockSide(card(1440 - 8 - 90), DOCK_WIDTH, VP)).toBe(
            "left"
        );
    });

    it("card ending exactly at the band's left edge is clear → right", () => {
        const bandLeft = VP.width - 8 - DOCK_WIDTH;
        expect(
            chooseDockSide({ left: 0, right: bandLeft }, DOCK_WIDTH, VP)
        ).toBe("right");
    });

    it("a double-width dock widens the band", () => {
        const left = VP.width - 8 - DOCK_WIDTH - 100; // outside 1x band
        expect(chooseDockSide(card(left, 50), dockWidth(false), VP)).toBe(
            "right"
        );
        expect(chooseDockSide(card(left, 50), dockWidth(true), VP)).toBe(
            "left"
        );
    });
});

// Issue #9500 — the dock also keeps the hovered card's lit relationship
// clear: Serra Angel (centre) attacking Liliana (right band) docks LEFT.
describe("chooseDockSide — keeps the arrow's far end clear (issue #9500)", () => {
    const liliana = card(1440 - 8 - 90);
    it("related node in the right band, left band free → left", () => {
        expect(chooseDockSide(card(600), DOCK_WIDTH, VP, [liliana])).toBe(
            "left"
        );
    });
    it("related nodes in BOTH bands → stays right (the card's own rule only)", () => {
        expect(
            chooseDockSide(card(600), DOCK_WIDTH, VP, [liliana, card(20)])
        ).toBe("right");
    });
    it("no relationship → unchanged", () => {
        expect(chooseDockSide(card(600), DOCK_WIDTH, VP, [])).toBe("right");
    });
});

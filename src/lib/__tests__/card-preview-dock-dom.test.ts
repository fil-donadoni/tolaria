// @vitest-environment happy-dom
// Issue #9500 — how the hover dock classifies the hovered element: the
// board's `data-preview-dock-side="left"` request wins, any other
// battlefield permanent is `battlefield` (its rect never moves the dock), and
// anything else is `elsewhere` (the #8955 rect rule). Lit nodes skip the
// hovered card itself.
import { describe, it, expect, afterEach } from "vitest";
import { dockAnchorOf, litNodeRects } from "../card-preview-dock-dom";

afterEach(() => {
    document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.querySelector<HTMLElement>("[data-hovered]")!;
}

describe("dockAnchorOf (issue #9500)", () => {
    it("a permanent the board marks for the left dock", () => {
        const el = mount(
            '<div data-arrow-anchor-permanent="pw" data-preview-dock-side="left"><div data-hovered></div></div>'
        );
        expect(dockAnchorOf(el)).toEqual({ kind: "preferred-left" });
    });

    it("any other battlefield permanent", () => {
        const el = mount(
            '<div data-arrow-anchor-permanent="bear"><div data-hovered></div></div>'
        );
        expect(dockAnchorOf(el)).toEqual({ kind: "battlefield" });
    });

    it("off the battlefield: its rect", () => {
        const el = mount("<div data-hovered></div>");
        expect(dockAnchorOf(el).kind).toBe("elsewhere");
    });
});

describe("litNodeRects (issue #9500)", () => {
    it("measures every lit node but the hovered card", () => {
        const el = mount(
            '<div data-arrow-anchor-permanent="angel"><div data-hovered></div></div>' +
                '<div data-arrow-anchor-permanent="pw"></div>' +
                '<div data-arrow-anchor-player="p2"></div>'
        );
        expect(litNodeRects(new Set(["angel", "pw", "p2"]), el)).toHaveLength(
            2
        );
        expect(litNodeRects(null, el)).toEqual([]);
    });
});

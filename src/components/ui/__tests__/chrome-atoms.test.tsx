import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CornerFiligree from "../corner-filigree";
import CornerFiligreeFrame from "../corner-filigree-frame";
import CornerBracket from "../corner-bracket";
import CornerBracketFrame from "../corner-bracket-frame";
import SunburstIcon from "../sunburst-icon";
import OrnamentalDivider from "../ornamental-divider";
import SubtitleFlourish from "../subtitle-flourish";

describe("CornerFiligree (issue #595)", () => {
    it("renders an SVG tagged with its corner", () => {
        const { container } = render(<CornerFiligree corner="tr" />);
        const svg = container.querySelector('[data-slot="corner-filigree"]')!;
        expect(svg.tagName.toLowerCase()).toBe("svg");
        expect(svg.getAttribute("data-corner")).toBe("tr");
    });
});

describe("CornerFiligreeFrame", () => {
    it("renders four corners and wraps children by default", () => {
        const { container } = render(
            <CornerFiligreeFrame>
                <span>inside</span>
            </CornerFiligreeFrame>
        );
        expect(
            container.querySelectorAll('[data-slot="corner-filigree"]')
        ).toHaveLength(4);
        expect(screen.getByText("inside")).toBeTruthy();
        const frame = container.querySelector(
            '[data-slot="corner-filigree-frame"]'
        )!;
        expect(frame.className).toContain("relative");
    });

    it("overlay mode stretches inset-0 without collapsing", () => {
        const { container } = render(<CornerFiligreeFrame overlay />);
        const frame = container.querySelector(
            '[data-slot="corner-filigree-frame"]'
        )!;
        expect(frame.className).toContain("absolute");
        expect(frame.className).toContain("inset-0");
    });
});

// ADR 0101 §2 / issue #2581 — the v3 Panel frame. Every geometric number
// (10px arm, 1px stroke, 4px inset, .5 opacity) is a CSS token read by
// `.panel-bracket`, so the values are asserted in
// `src/__tests__/design-tokens.test.ts` where the stylesheet is parsed;
// happy-dom resolves no custom properties and would report empty strings here.
describe("CornerBracket (issue #2581)", () => {
    it("renders a token-driven bracket tagged with its corner", () => {
        const { container } = render(<CornerBracket corner="br" />);
        const el = container.querySelector('[data-slot="corner-bracket"]')!;
        expect(el.getAttribute("data-corner")).toBe("br");
        expect(el.className).toContain("panel-bracket");
        // decorative only — never announced, never a hit target
        expect(el.getAttribute("aria-hidden")).toBe("true");
    });
});

describe("CornerBracketFrame", () => {
    it("stretches inset-0 and renders one bracket per corner", () => {
        const { container } = render(<CornerBracketFrame />);
        const frame = container.querySelector(
            '[data-slot="corner-bracket-frame"]'
        )!;
        expect(frame.className).toContain("absolute");
        expect(frame.className).toContain("inset-0");
        expect(frame.className).toContain("pointer-events-none");
        const corners = Array.from(
            container.querySelectorAll('[data-slot="corner-bracket"]')
        ).map((c) => c.getAttribute("data-corner"));
        expect(corners.sort()).toEqual(["bl", "br", "tl", "tr"]);
    });
});

describe("SunburstIcon", () => {
    it("renders the well with its glyph child", () => {
        const { container } = render(
            <SunburstIcon>
                <span>glyph</span>
            </SunburstIcon>
        );
        const well = container.querySelector('[data-slot="sunburst-icon"]')!;
        expect(well.className).toContain("sunburst-well");
        expect(screen.getByText("glyph")).toBeTruthy();
    });
});

describe("OrnamentalDivider", () => {
    it("renders a line + node + line", () => {
        const { container } = render(<OrnamentalDivider />);
        expect(container.querySelectorAll(".divider-line")).toHaveLength(2);
        expect(container.querySelectorAll(".divider-node")).toHaveLength(1);
    });
});

describe("SubtitleFlourish", () => {
    it("mirrors itself for the right side", () => {
        const { container } = render(<SubtitleFlourish side="right" />);
        const el = container.querySelector('[data-slot="subtitle-flourish"]')!;
        expect(el.getAttribute("data-side")).toBe("right");
        expect(el.className).toContain("flex-row-reverse");
    });
});

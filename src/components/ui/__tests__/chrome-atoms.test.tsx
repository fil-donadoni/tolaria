import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CornerFiligree from "../corner-filigree";
import CornerFiligreeFrame from "../corner-filigree-frame";
import SunburstIcon from "../sunburst-icon";
import StatChip from "../stat-chip";
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

describe("StatChip", () => {
    it("renders a single chip when `to` is omitted", () => {
        render(<StatChip from={20} />);
        expect(screen.getByText("20")).toBeTruthy();
        expect(screen.queryByText("▸")).toBeNull();
    });

    it("renders `from ▸ to` when both provided", () => {
        render(<StatChip from={20} to={17} />);
        expect(screen.getByText("20")).toBeTruthy();
        expect(screen.getByText("17")).toBeTruthy();
        expect(screen.getByText("▸")).toBeTruthy();
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

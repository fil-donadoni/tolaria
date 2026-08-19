import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Panel, PanelHeader, PanelBody, PanelFooter } from "../panel";

describe("Panel", () => {
    it("renders children", () => {
        render(<Panel>Hello</Panel>);
        expect(screen.getByText("Hello")).toBeTruthy();
    });

    it("renders the physical bezel", () => {
        const { container } = render(<Panel>content</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.className).toContain("panel-physical");
    });

    // ADR 0101 §2 / issue #2581: the v3 frame is four 10px inset brackets at
    // 1px / opacity .5. The 40px filigree is no longer the default frame —
    // it survives only behind the explicit `ornament` opt-in.
    it("renders v3 corner brackets at all four corners, and no filigree", () => {
        const { container } = render(<Panel>content</Panel>);
        const corners = container.querySelectorAll(
            '[data-slot="corner-bracket"]'
        );
        expect(corners).toHaveLength(4);
        const positions = Array.from(corners).map((c) =>
            c.getAttribute("data-corner")
        );
        expect(positions.sort()).toEqual(["bl", "br", "tl", "tr"]);
        expect(
            container.querySelectorAll('[data-slot="corner-filigree"]')
        ).toHaveLength(0);
    });

    it("ornament opts back into the filigree, keeping brackets as the phone fallback", () => {
        const { container } = render(<Panel ornament>content</Panel>);
        expect(
            container.querySelectorAll('[data-slot="corner-filigree"]')
        ).toHaveLength(4);
        // Both frames are mounted; CSS picks one. `compact-chrome` is the
        // phone-shaped variant, so the ornament shows only above 844x390.
        const filigree = container.querySelector(
            '[data-slot="corner-filigree-frame"]'
        )!;
        expect(filigree.className).toContain("compact-chrome:hidden");
        const brackets = container.querySelector(
            '[data-slot="corner-bracket-frame"]'
        )!;
        expect(brackets.className).toContain("hidden");
        expect(brackets.className).toContain("compact-chrome:block");
    });

    it("applies neutral tone border by default", () => {
        const { container } = render(<Panel>x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.className).toContain("border-border-subtle");
    });

    it("applies accent tone border", () => {
        const { container } = render(<Panel tone="accent">x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.className).toContain("border-accent");
    });

    // v3 density (ADR 0101 §2): the rung is published as `data-density` and
    // the padding comes from `--panel-pad`, which the `[data-density]` rules
    // in `src/index.css` set per rung. The three rungs' PADDING VALUES are
    // asserted against the stylesheet in `src/__tests__/design-tokens.test.ts`
    // — happy-dom cannot resolve a custom property, so the class here is all
    // this layer can prove, and the stylesheet parse is what proves the rest.
    it("defaults to the roomy rung", () => {
        const { container } = render(<Panel>x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.getAttribute("data-density")).toBe("roomy");
        expect(panel.className).toContain("p-[var(--panel-pad)]");
    });

    it.each(["compact", "comfortable", "roomy"] as const)(
        "publishes the %s rung as data-density",
        (density) => {
            const { container } = render(<Panel density={density}>x</Panel>);
            const panel = container.querySelector('[data-slot="panel"]')!;
            expect(panel.getAttribute("data-density")).toBe(density);
        }
    );

    it("applies size classes", () => {
        const { container } = render(<Panel size="wide">x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.className).toContain("max-w-[90vw]");
    });

    it("merges custom className", () => {
        const { container } = render(<Panel className="my-custom">x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.className).toContain("my-custom");
    });

    it("overlay mode renders only the bracket frame stretched inset-0", () => {
        const { container } = render(<Panel overlay />);
        // no opaque bezel in overlay mode
        expect(container.querySelector('[data-slot="panel"]')).toBeNull();
        const frame = container.querySelector(
            '[data-slot="corner-bracket-frame"]'
        )!;
        expect(frame.className).toContain("inset-0");
        expect(
            container.querySelectorAll('[data-slot="corner-bracket"]')
        ).toHaveLength(4);
    });
});

describe("PanelHeader", () => {
    it("renders title with Beleren font in an engraved band", () => {
        render(<PanelHeader title="Test Title" />);
        const heading = screen.getByRole("heading", { name: "Test Title" });
        expect(heading.className).toContain("heading-panel");
    });

    // ADR 0101 §2: title LEFT, a 1px rule beneath, and no centred diamond
    // node (it contradicts a left-aligned title).
    it("left-aligns the title and drops the centred diamond node", () => {
        const { container } = render(<PanelHeader title="T" />);
        const heading = screen.getByRole("heading", { name: "T" });
        expect(heading.className).toContain("text-left");
        expect(container.querySelectorAll(".divider-node")).toHaveLength(0);
        expect(container.querySelectorAll(".panel-rule")).toHaveLength(1);
    });

    // The band bleeds to the panel border by cancelling `--panel-pad`, and the
    // title starts at `--panel-header-pad-x` from that border — the quantity
    // the bracket-clearance guard compares against the bracket reach.
    it("insets the title by the header padding token, measured from the panel border", () => {
        const { container } = render(<PanelHeader title="T" />);
        const band = container.querySelector(".panel-header-band")!;
        expect(band.className).toContain("-mx-[var(--panel-pad)]");
        expect(band.className).toContain("px-[var(--panel-header-pad-x)]");
    });

    it("renders subtitle when provided", () => {
        render(<PanelHeader title="T" subtitle="Sub" />);
        expect(screen.getByText("Sub")).toBeTruthy();
    });

    it("omits subtitle when not provided", () => {
        const { container } = render(<PanelHeader title="T" />);
        const header = container.querySelector('[data-slot="panel-header"]')!;
        expect(
            header.querySelectorAll('[data-slot="subtitle-flourish"]')
        ).toHaveLength(0);
    });

    it("renders a collapse chevron and fires onToggleCollapse", () => {
        const onToggle = vi.fn();
        render(
            <PanelHeader title="T" collapsible onToggleCollapse={onToggle} />
        );
        const btn = screen.getByRole("button", { name: "Collapse" });
        fireEvent.click(btn);
        expect(onToggle).toHaveBeenCalledOnce();
    });

    it("wires titleId onto the heading element", () => {
        render(<PanelHeader title="T" titleId="my-title" />);
        const heading = screen.getByRole("heading", { name: "T" });
        expect(heading.id).toBe("my-title");
    });
});

describe("PanelBody", () => {
    it("renders children", () => {
        render(<PanelBody>Body content</PanelBody>);
        expect(screen.getByText("Body content")).toBeTruthy();
    });
});

describe("PanelFooter", () => {
    it("renders children", () => {
        render(<PanelFooter>Footer</PanelFooter>);
        expect(screen.getByText("Footer")).toBeTruthy();
    });

    // ADR 0101 §2: right-aligned from `sm` up, stacked full-width on a phone.
    it("stacks full-width on phone and right-aligns from sm up", () => {
        const { container } = render(<PanelFooter>Foot</PanelFooter>);
        const footer = container.querySelector('[data-slot="panel-footer"]')!;
        expect(footer.className).toContain("flex-col");
        expect(footer.className).toContain("items-stretch");
        expect(footer.className).toContain("sm:flex-row");
        expect(footer.className).toContain("sm:justify-end");
    });
});

describe("Panel composition", () => {
    it("renders all sub-components together", () => {
        render(
            <Panel>
                <PanelHeader title="Title" subtitle="Sub" />
                <PanelBody>Body</PanelBody>
                <PanelFooter>Foot</PanelFooter>
            </Panel>
        );
        expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
        expect(screen.getByText("Sub")).toBeTruthy();
        expect(screen.getByText("Body")).toBeTruthy();
        expect(screen.getByText("Foot")).toBeTruthy();
    });

    it("works without PanelHeader (body-only usage)", () => {
        const { container } = render(
            <Panel density="compact">
                <span>row content</span>
            </Panel>
        );
        expect(screen.getByText("row content")).toBeTruthy();
        const corners = container.querySelectorAll(
            '[data-slot="corner-bracket"]'
        );
        expect(corners).toHaveLength(4);
    });
});

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

    it("renders SVG corner filigree at all four corners", () => {
        const { container } = render(<Panel>content</Panel>);
        const corners = container.querySelectorAll(
            '[data-slot="corner-filigree"]'
        );
        expect(corners).toHaveLength(4);
        const positions = Array.from(corners).map((c) =>
            c.getAttribute("data-corner")
        );
        expect(positions.sort()).toEqual(["bl", "br", "tl", "tr"]);
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

    it("applies compact density", () => {
        const { container } = render(<Panel density="compact">x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.className).toContain("p-2");
        expect(panel.className).not.toContain("p-6");
    });

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

    it("overlay mode renders only the filigree frame stretched inset-0", () => {
        const { container } = render(<Panel overlay />);
        // no opaque bezel in overlay mode
        expect(container.querySelector('[data-slot="panel"]')).toBeNull();
        const frame = container.querySelector(
            '[data-slot="corner-filigree-frame"]'
        )!;
        expect(frame.className).toContain("inset-0");
        expect(
            container.querySelectorAll('[data-slot="corner-filigree"]')
        ).toHaveLength(4);
    });
});

describe("PanelHeader", () => {
    it("renders title with Beleren font in an engraved band", () => {
        render(<PanelHeader title="Test Title" />);
        const heading = screen.getByRole("heading", { name: "Test Title" });
        expect(heading.className).toContain("heading-panel");
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
            '[data-slot="corner-filigree"]'
        );
        expect(corners).toHaveLength(4);
    });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Panel, PanelHeader, PanelBody, PanelFooter } from "../panel";

describe("Panel", () => {
    it("renders children", () => {
        render(<Panel>Hello</Panel>);
        expect(screen.getByText("Hello")).toBeTruthy();
    });

    it("always renders corner brackets", () => {
        const { container } = render(<Panel>content</Panel>);
        const brackets = container.querySelectorAll(
            '[data-slot="corner-bracket"]'
        );
        expect(brackets).toHaveLength(4);
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
        expect(panel.className).not.toContain("p-4");
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
});

describe("PanelHeader", () => {
    it("renders title with Beleren font", () => {
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
        expect(header.querySelectorAll("p")).toHaveLength(0);
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
        const brackets = container.querySelectorAll(
            '[data-slot="corner-bracket"]'
        );
        expect(brackets).toHaveLength(4);
    });
});

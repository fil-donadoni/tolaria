import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Panel, PanelHeader, PanelBody, PanelFooter } from "../panel";

/** Token-exact className assertion (issue #2666): a bare `toContain` is a raw
 *  substring match, so `"border"` would be satisfied by `border-t` and
 *  `"border-[var(--hairline)]"` by `border-[var(--hairline-strong)]` — which
 *  is exactly the pair of edges this file has to tell apart. */
function classTokens(el: Element): string[] {
    return el.className.split(/\s+/).filter(Boolean);
}

describe("Panel", () => {
    it("renders children", () => {
        render(<Panel>Hello</Panel>);
        expect(screen.getByText("Hello")).toBeTruthy();
    });

    it("renders the panel material", () => {
        const { container } = render(<Panel>content</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.className).toContain("panel-physical");
    });

    // ADR 0103 §5 / issue #2723: the v4 frame is the panel's own EDGE — a 1px
    // translucent-ivory border on a `--panel-radius` corner. Nothing is drawn
    // at the corners any more: the 40px filigree (issue #595) and the 10px
    // brackets that replaced it (issue #2581) are both gone from Panel.
    it("draws no corner ornament of any kind — neither brackets nor filigree", () => {
        const { container } = render(<Panel>content</Panel>);
        expect(
            container.querySelectorAll('[data-slot="corner-bracket"]')
        ).toHaveLength(0);
        expect(
            container.querySelectorAll('[data-slot="corner-filigree"]')
        ).toHaveLength(0);
    });

    it("frames itself with the hairline edge on the panel corner", () => {
        const { container } = render(<Panel>content</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(classTokens(panel)).toContain("border");
        expect(classTokens(panel)).toContain("rounded-[var(--panel-radius)]");
    });

    // The `ornament` prop outlived its behaviour on purpose: two call sites
    // still pass it and this slice changes no consumer file (#2734 removes the
    // prop and those call sites together). Accepted, and inert — a Panel that
    // asks for the ornament must NOT get a corner ornament back.
    it("accepts the retired ornament prop and renders nothing extra for it", () => {
        const plain = render(<Panel>content</Panel>).container.innerHTML;
        const { container } = render(<Panel ornament>content</Panel>);
        expect(
            container.querySelectorAll('[data-slot="corner-filigree"]')
        ).toHaveLength(0);
        expect(
            container.querySelectorAll('[data-slot="corner-bracket"]')
        ).toHaveLength(0);
        expect(container.innerHTML).toBe(plain);
    });

    // Both tones are the TRANSLUCENT hairline pair, never the flattened
    // `border-*` hexes: a Panel over card art or a gradient would paint a
    // visible grey line with a flattened edge.
    it("applies the neutral hairline edge by default", () => {
        const { container } = render(<Panel>x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(classTokens(panel)).toContain("border-[var(--hairline)]");
    });

    it("applies the strong hairline edge for the accent tone", () => {
        const { container } = render(<Panel tone="accent">x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(classTokens(panel)).toContain("border-[var(--hairline-strong)]");
    });

    // v3 density (ADR 0101 §2): the rung is published as `data-density` and
    // the padding comes from `--panel-pad`, which the `[data-density]` rules
    // in `src/index.css` set per rung. The three rungs' PADDING VALUES are
    // asserted against the stylesheet in `src/__tests__/design-tokens.test.ts`
    // — happy-dom cannot resolve a custom property, so the class here is all
    // this layer can prove, and the stylesheet parse is what proves the rest.
    //
    // No explicit `density` prop (issue #2595): Panel renders NO
    // `data-density` attribute of its own — it inherits the ambient rung
    // from the nearest ancestor that sets one, which since #2595 is
    // `<html data-density>` (the user's Settings preference, defaulting to
    // "roomy" there so a page with no Settings row still renders exactly as
    // it always did). See `applyDocumentPreferences`
    // (`src/lib/user-preferences.ts`) for the mechanism.
    it("renders no data-density attribute when the prop is omitted — inherits the ambient rung", () => {
        const { container } = render(<Panel>x</Panel>);
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(panel.hasAttribute("data-density")).toBe(false);
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

    it("overlay mode renders only the edge, stretched inset-0", () => {
        const { container } = render(<Panel overlay />);
        // no material in overlay mode — the caller owns the box
        expect(container.querySelector('[data-slot="panel"]')).toBeNull();
        const frame = container.querySelector('[data-slot="panel-frame"]')!;
        const tokens = classTokens(frame);
        expect(tokens).toContain("absolute");
        expect(tokens).toContain("inset-0");
        expect(tokens).toContain("border");
        expect(tokens).toContain("border-[var(--hairline)]");
        expect(tokens).toContain("rounded-[var(--panel-radius)]");
        // decorative: it lies over the caller's own content
        expect(tokens).toContain("pointer-events-none");
        expect(frame.getAttribute("aria-hidden")).toBe("true");
    });
});

describe("PanelHeader", () => {
    it("renders the title in the header band", () => {
        render(<PanelHeader title="Test Title" />);
        const heading = screen.getByRole("heading", { name: "Test Title" });
        expect(heading.className).toContain("heading-panel");
    });

    // ADR 0101 §2: title LEFT, ONE hairline rule beneath, and no centred
    // diamond node (it contradicts a left-aligned title).
    it("left-aligns the title and drops the centred diamond node", () => {
        const { container } = render(<PanelHeader title="T" />);
        const heading = screen.getByRole("heading", { name: "T" });
        expect(heading.className).toContain("text-left");
        expect(container.querySelectorAll(".divider-node")).toHaveLength(0);
        expect(container.querySelectorAll(".panel-rule")).toHaveLength(1);
    });

    // The band bleeds to the panel border by cancelling `--panel-pad`, and the
    // title starts at `--panel-header-pad-x` from that border.
    it("insets the title by the header padding token, measured from the panel border", () => {
        const { container } = render(<PanelHeader title="T" />);
        const band = container.querySelector(".panel-header-band")!;
        expect(band.className).toContain("-mx-[var(--panel-pad)]");
        expect(band.className).toContain("px-[var(--panel-header-pad-x)]");
    });

    // The icon well used to be a sibling COLUMN of the band. The band's own
    // `-mx-[--panel-pad]` bleed then ran UNDER the icon while the title and
    // subtitle were squeezed into what was left (~200px on the auth screens,
    // wrapping "Create Account" and the subtitle to three lines). The icon
    // belongs inside the band, and the subtitle spans the header.
    it("renders the icon INSIDE the header band, not as a sibling column", () => {
        const { container } = render(
            <PanelHeader title="T" icon={<span>i</span>} />
        );
        const band = container.querySelector(".panel-header-band")!;
        expect(band.querySelector('[data-slot="sunburst-icon"]')).toBeTruthy();
        const header = container.querySelector('[data-slot="panel-header"]')!;
        // the header itself is a plain column: no side-by-side split that
        // takes width away from the band
        expect(header.className).toContain("flex-col");
        expect(header.className).not.toContain("sm:flex-row");
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

    // The subtitle is clasp-flanked on BOTH sides — a symmetric treatment, so
    // it centres under the (left-aligned) title rather than hugging the left
    // edge with one flourish stranded across the panel.
    it("centres the clasp-flanked subtitle across the full header width", () => {
        const { container } = render(<PanelHeader title="T" subtitle="Sub" />);
        const row = screen.getByText("Sub").parentElement!;
        expect(row.className).toContain("justify-center");
        expect(
            container.querySelectorAll('[data-slot="subtitle-flourish"]')
        ).toHaveLength(2);
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

    // A caller cannot opt out of the responsive row from the outside:
    // `className="flex-col"` does not cancel `sm:flex-row` (tailwind-merge has
    // no unprefixed counterpart to drop), so above 640px the row came back —
    // the auth screens' "No account? Sign up" wrapped into a ~60px column
    // beside the CTA. `layout="stack"` is the opt-out.
    it("keeps the column at every width under layout=stack", () => {
        const { container } = render(
            <PanelFooter layout="stack">Foot</PanelFooter>
        );
        const footer = container.querySelector('[data-slot="panel-footer"]')!;
        expect(footer.getAttribute("data-layout")).toBe("stack");
        expect(footer.className).toContain("flex-col");
        expect(footer.className).not.toContain("sm:flex-row");
        expect(footer.className).not.toContain("sm:justify-end");
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
        const panel = container.querySelector('[data-slot="panel"]')!;
        expect(classTokens(panel)).toContain("border-[var(--hairline)]");
    });
});

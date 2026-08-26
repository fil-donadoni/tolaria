// The v4 Banner contract (ADR 0103 §5 / PRD #2721 story 28, issue #2723):
// "banners and toasts as compact hairline strips with a coloured dot".
//
// The census behind the assertions — every production call site, by tone:
//   danger      19 sites (error banners, join/auth failures, bug report)
//   info         5 sites (attack-direction, incompleteness, cube availability)
//   prominent    1 site  (active-game notice)
//   success      1 site  (limited event winner)
//   neutral      0 sites (declared, kept for callers that want the quiet note)
// Every one of them passes `tone` and nothing else that touches the skin, so
// the tone table below is the whole surface this change can move.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Banner, type BannerTone } from "../banner";

const TONES: readonly BannerTone[] = [
    "danger",
    "info",
    "prominent",
    "success",
    "neutral",
];

function classTokens(el: Element): string[] {
    return el.className.split(/\s+/).filter(Boolean);
}

function renderBanner(tone: BannerTone, extra: Record<string, unknown> = {}) {
    const { container } = render(
        <Banner tone={tone} {...extra}>
            body
        </Banner>
    );
    return container.querySelector('[data-slot="banner"]')!;
}

describe("Banner — v4 hairline strip (ADR 0103 §5)", () => {
    it.each(TONES)("tone %s renders a status dot", (tone) => {
        const banner = renderBanner(tone);
        const dot = banner.querySelector('[data-slot="banner-dot"]')!;
        expect(dot, tone).toBeTruthy();
        // decorative: the tone is also carried by the text, so a screen reader
        // must not be handed a bare bullet
        expect(dot.getAttribute("aria-hidden")).toBe("true");
    });

    // THE regression this file exists for. v3 tinted the whole box
    // (`bg-danger-soft/40`, `bg-accent-soft/30`, `bg-accent/15`), so five
    // simultaneous notices read as five different components and a plain
    // heads-up looked like an error. In v4 every tone sits on the SAME strip
    // fill and the hue lives in the dot and the edge.
    it.each(TONES)(
        "tone %s sits on the one strip fill, not a tinted wash",
        (tone) => {
            const tokens = classTokens(renderBanner(tone));
            const fills = tokens.filter((t) => t.startsWith("bg-"));
            expect(fills, tone).toEqual(["bg-surface"]);
        }
    );

    // ...and the edge is a single hairline, never the v3 2px accent border
    // `prominent` used to carry (a banner that outweighed the panel it sat in).
    it.each(TONES)("tone %s draws exactly one 1px edge", (tone) => {
        const tokens = classTokens(renderBanner(tone));
        expect(tokens, tone).toContain("border");
        expect(
            tokens.filter((t) => t === "border-2"),
            tone
        ).toEqual([]);
    });

    it("publishes the tone so a consumer can style or query by it", () => {
        for (const tone of TONES) {
            expect(renderBanner(tone).getAttribute("data-tone")).toBe(tone);
        }
    });

    // `danger` is the ONE tone that keeps a text colour: an error message must
    // survive being skimmed. `danger-strong` is 7.99:1 on surface — plain
    // `danger` as text was a phase-3 contrast failure at 3.43:1.
    it("keeps danger's high-contrast text colour", () => {
        expect(classTokens(renderBanner("danger"))).toContain(
            "text-danger-strong"
        );
    });

    it("does not colour the body text of the non-error tones", () => {
        for (const tone of ["info", "prominent", "success"] as const) {
            expect(classTokens(renderBanner(tone)), tone).not.toContain(
                "text-danger-strong"
            );
        }
    });
});

describe("Banner — content slots", () => {
    // A caller-supplied icon REPLACES the dot. Rendering both would give the
    // strip two leading marks and shift the text by 18px on exactly the
    // banners that already carry an icon.
    it("an explicit icon replaces the dot rather than joining it", () => {
        const { container } = render(
            <Banner tone="info" icon={<span>icon</span>}>
                body
            </Banner>
        );
        expect(screen.getByText("icon")).toBeTruthy();
        expect(
            container.querySelectorAll('[data-slot="banner-dot"]')
        ).toHaveLength(0);
    });

    it("renders the small-caps lead-in before the body when title is given", () => {
        render(
            <Banner tone="info" title="Incompleteness Notice">
                the body
            </Banner>
        );
        const lead = screen.getByText(/Incompleteness Notice/);
        expect(classTokens(lead)).toContain("uppercase");
        expect(screen.getByText(/the body/)).toBeTruthy();
    });

    it("passes arbitrary div props through (role, aria-live)", () => {
        const { container } = render(
            <Banner tone="danger" role="alert" aria-live="assertive">
                boom
            </Banner>
        );
        const banner = container.querySelector('[data-slot="banner"]')!;
        expect(banner.getAttribute("role")).toBe("alert");
        expect(banner.getAttribute("aria-live")).toBe("assertive");
    });
});

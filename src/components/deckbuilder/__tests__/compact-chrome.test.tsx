// Issue #2511 — the deckbuilder's card zones were laid out SHORTER than one
// card tile on a phone (measured 24px and 66px around 101-158px tiles, on both
// `/decks/create` and `/limited/<id>/build`), because the zones are `flex-1`
// children of a fixed-height column that also carries the header band, the ADD
// BASIC bar, the per-zone control rows, the legality panel and the save bar.
// The fix has two halves and this file guards both:
//
//   1. the chrome GIVES WAY on a phone-shaped viewport (`CompactChromeDisclosure`)
//   2. the card strip takes a floor of one card row, and nothing above it clips
//      that floor any more (the `compact-chrome:` class contracts)
//
// Half 2 is CSS-only: happy-dom evaluates no media query and has no layout, so
// its observable is the className contract, asserted as source text the way
// `deck-builder-height.test.ts` already does for `short-viewport:`. The PIXEL
// proof is the browser probe in the PR — that is the whole reason
// `.claude/rules/chrome-debug.md` exists.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ViewportMode } from "~/hooks/useViewportMode";
import CompactChromeDisclosure from "../compact-chrome-disclosure";

// The single seam under test — driven explicitly so happy-dom's media-query
// support never decides the branch (same pattern as
// `board/__tests__/controller-landscape.test.tsx`).
let mode: ViewportMode = "desktop";
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => mode,
}));

afterEach(() => {
    cleanup();
    mode = "desktop";
});

const DIR = join(__dirname, "..");
const ZONE_SRC = readFileSync(join(DIR, "deck-zone-surface.tsx"), "utf8");
const ZONES_SRC = readFileSync(join(DIR, "deck-zones-surface.tsx"), "utf8");
const SHELL_SRC = readFileSync(join(DIR, "deck-builder-shell.tsx"), "utf8");
const CSS_SRC = readFileSync(
    join(__dirname, "..", "..", "..", "index.css"),
    "utf8"
);

describe("CompactChromeDisclosure (issue #2511)", () => {
    it("renders the band verbatim on a desktop-shaped viewport — no toggle", () => {
        mode = "desktop";
        render(
            <CompactChromeDisclosure label="Filters">
                <button type="button">Colour</button>
            </CompactChromeDisclosure>
        );
        expect(screen.getByRole("button", { name: "Colour" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Filters/ })).toBeNull();
    });

    for (const phone of ["portrait", "landscape-compact"] as const) {
        it(`folds the band behind a toggle on ${phone}, and unfolds it on press`, () => {
            mode = phone;
            render(
                <CompactChromeDisclosure label="Filters">
                    <button type="button">Colour</button>
                </CompactChromeDisclosure>
            );
            // UNMOUNTED, not `display: none` — a CSS-hidden band leaves its
            // buttons in the document at zero size, which is both a dead tab
            // stop and what the browser probe counts as a `zero` control.
            expect(screen.queryByRole("button", { name: "Colour" })).toBeNull();

            const toggle = screen.getByRole("button", { name: /Filters/ });
            expect(toggle.getAttribute("aria-expanded")).toBe("false");

            fireEvent.click(toggle);
            expect(screen.getByRole("button", { name: "Colour" })).toBeTruthy();
            expect(
                screen
                    .getByRole("button", { name: /Filters/ })
                    .getAttribute("aria-expanded")
            ).toBe("true");
        });
    }
});

describe("compact-chrome variant (issue #2511)", () => {
    // The bug this test exists for, caught in the browser and not by any
    // type-check: `@custom-variant compact-chrome (@media A, B)` SPLITS on the
    // comma and keeps only `A`, so the landscape-phone half silently never
    // generated and 844x390 kept the desktop rules. The block-with-two-`@slot`s
    // form below is the one that emits both.
    it("covers BOTH phone shapes — portrait-narrow AND landscape-short", () => {
        const block = CSS_SRC.slice(
            CSS_SRC.indexOf("@custom-variant compact-chrome"),
            CSS_SRC.indexOf("@custom-variant compact-chrome") + 400
        );
        expect(block).toContain(
            "@media (orientation: portrait) and (max-width: 767px)"
        );
        expect(block).toContain(
            "@media (orientation: landscape) and (max-height: 500px)"
        );
    });

    it("mirrors useViewportMode's own two queries verbatim", () => {
        const hook = readFileSync(
            join(__dirname, "..", "..", "..", "hooks", "useViewportMode.ts"),
            "utf8"
        );
        expect(hook).toContain(
            "(orientation: portrait) and (max-width: 767px)"
        );
        expect(hook).toContain(
            "(orientation: landscape) and (max-height: 500px)"
        );
    });
});

describe("card-zone floor (issue #2511)", () => {
    it("the card strip takes a one-card-row floor derived from --card-h", () => {
        expect(ZONE_SRC).toContain(
            "compact-chrome:min-h-[calc(var(--card-h)+3.5rem)]"
        );
        // …and stops flexing, so the floor is a floor and not a target the
        // surrounding chrome can bid away.
        expect(ZONE_SRC).toContain("compact-chrome:flex-none");
    });

    it("nothing between the strip and the shell's scroller clips that floor", () => {
        // The zone pair and each zone wrapper.
        expect(
            ZONES_SRC.match(/compact-chrome:overflow-visible/g)?.length ?? 0
        ).toBeGreaterThanOrEqual(3);
        // The shell's zone pane.
        expect(SHELL_SRC).toContain("compact-chrome:overflow-visible");
        expect(SHELL_SRC).toContain("compact-chrome:basis-auto");
    });

    it("the zone header's control cluster may shrink at every width, so it wraps instead of overflowing off-screen", () => {
        // `shrink-0` at every width pinned the cluster at max-content inside a
        // clipped pane, stranding 4 controls outside the viewport at 844x390.
        // Review finding #2 (issue #2585/PR #2653) dropped `shrink-0`
        // entirely (not just its `md:` gate): the source-panel dock narrows
        // the SAME pane at 1440x900/1180x820, and `md:shrink-0` pinned this
        // cluster there too — measured back to 0 stranded/occluded at all
        // five viewports once the cluster can shrink unconditionally.
        expect(ZONE_SRC).toContain(
            'className="ml-auto flex min-w-0 flex-wrap items-center gap-2 self-center"'
        );
    });
});

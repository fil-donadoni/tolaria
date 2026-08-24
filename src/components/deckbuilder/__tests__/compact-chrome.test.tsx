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
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ViewportMode } from "~/hooks/useViewportMode";
import CompactChromeDisclosure from "../compact-chrome-disclosure";
import { TABLET_PORTRAIT_QUERY } from "../useCompactChromeFold";

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

/** Evaluates a `(feature: value) and (feature: value) ...` media query
 *  against a simulated viewport for real, instead of a query-string lookup
 *  table the test pre-decides the answer for. Issue #2671 review round 2 L1:
 *  a lookup table lets a test claim it exercises the `max-height` term while
 *  actually hard-coding the answer — this evaluator is what makes the TALL
 *  portrait case below fail when `TABLET_PORTRAIT_QUERY` regresses to
 *  unbounded, because only a query that GENUINELY carries a height term can
 *  ever turn `false` on a tall-but-narrow viewport. Covers exactly the
 *  feature vocabulary `TABLET_PORTRAIT_QUERY` and `useViewportMode`'s own
 *  `PORTRAIT_QUERY` use — an unhandled feature throws rather than silently
 *  matching, so a query this evaluator can't parse fails loudly, not green. */
function evaluateMediaQuery(
    query: string,
    viewport: { width: number; height: number }
): boolean {
    return query.split(" and ").every((rawTerm) => {
        const term = rawTerm.trim().replace(/^\(|\)$/g, "");
        const [feature, rawValue] = term.split(":").map((s) => s.trim());
        if (feature === "orientation") {
            const isPortrait = viewport.height >= viewport.width;
            return rawValue === "portrait" ? isPortrait : !isPortrait;
        }
        const px = parseInt(rawValue, 10);
        switch (feature) {
            case "min-width":
                return viewport.width >= px;
            case "max-width":
                return viewport.width <= px;
            case "min-height":
                return viewport.height >= px;
            case "max-height":
                return viewport.height <= px;
            default:
                throw new Error(
                    `evaluateMediaQuery: unhandled feature "${feature}" in "${query}"`
                );
        }
    });
}

describe("useIsTabletPortrait / TABLET_PORTRAIT_QUERY (issue #2671)", () => {
    // A real `matchMedia` global that evaluates every query against a
    // simulated viewport (`evaluateMediaQuery` above) rather than a
    // pre-decided lookup table — so a test that sets `viewport` is actually
    // exercising the query's own terms (width, orientation, height), not the
    // test author's guess at the answer.
    let viewport = { width: 1440, height: 900 };

    function installMatchMedia() {
        vi.stubGlobal("matchMedia", (query: string) => ({
            media: query,
            get matches() {
                return evaluateMediaQuery(query, viewport);
            },
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            onchange: null,
            dispatchEvent: () => true,
        }));
    }

    beforeEach(() => {
        viewport = { width: 1440, height: 900 };
        installMatchMedia();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("is the width-complement of useViewportMode's own PORTRAIT_QUERY (orientation: portrait, min-width: 768px), height-bounded (issue #2671 review M2)", () => {
        expect(TABLET_PORTRAIT_QUERY).toBe(
            "(orientation: portrait) and (min-width: 768px) and (max-height: 1300px)"
        );
    });

    it("folds the band on a tablet-portrait viewport even though useViewportMode() still reads 'desktop'", () => {
        // The exact bug this issue fixes: 820x1180 is `useViewportMode()`'s
        // "desktop" bucket (width > 767px), so a fold gated on that hook
        // ALONE never engages here — this is the regression's reproduction.
        mode = "desktop";
        viewport = { width: 820, height: 1180 };
        render(
            <CompactChromeDisclosure label="View">
                <button type="button">Colour</button>
            </CompactChromeDisclosure>
        );
        expect(screen.queryByRole("button", { name: "Colour" })).toBeNull();
        expect(screen.getByRole("button", { name: /View/ })).toBeTruthy();
    });

    it("stays verbatim on a desktop-shaped LANDSCAPE viewport — the query never matches without orientation: portrait", () => {
        // 1440x900 / 1180x820 (this issue's own AC): landscape (width >
        // height), so `evaluateMediaQuery`'s `orientation: portrait` term
        // genuinely fails regardless of width.
        mode = "desktop";
        viewport = { width: 1440, height: 900 };
        render(
            <CompactChromeDisclosure label="View">
                <button type="button">Colour</button>
            </CompactChromeDisclosure>
        );
        expect(screen.getByRole("button", { name: "Colour" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    });

    it("stays verbatim on a TALL portrait viewport past the height bound (issue #2671 review round 2 L1)", () => {
        // 1440x2560: same orientation/width band as the failing 820x1180 AC
        // case (portrait, width >= 768), but taller than the query's own
        // `max-height: 1300px` term — `evaluateMediaQuery` computes the
        // match for real from these numbers and `TABLET_PORTRAIT_QUERY`'s
        // actual string, so this case is load-bearing on the height term
        // specifically: reverting `TABLET_PORTRAIT_QUERY` to the unbounded
        // query (dropping "and (max-height: 1300px)") makes the evaluator
        // return `true` here too, folding the band and turning this
        // assertion red (proof-of-failure, verified — see PR receipt).
        mode = "desktop";
        viewport = { width: 1440, height: 2560 };
        render(
            <CompactChromeDisclosure label="View">
                <button type="button">Colour</button>
            </CompactChromeDisclosure>
        );
        expect(screen.getByRole("button", { name: "Colour" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    });

    it("active=false still forces verbatim even when the tablet-portrait query matches", () => {
        mode = "desktop";
        viewport = { width: 820, height: 1180 };
        render(
            <CompactChromeDisclosure label="View" active={false}>
                <button type="button">Colour</button>
            </CompactChromeDisclosure>
        );
        expect(screen.getByRole("button", { name: "Colour" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    });
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

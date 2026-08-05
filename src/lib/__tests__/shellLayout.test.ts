// Issue #2274: the app shell's scroll contract, checked as ARITHMETIC.
//
// Issue #2056 moved the scroll container from the document to `<main>` for
// every route, but the change was only measured inside the short-viewport
// branch (under 300px). It is not media-gated. jsdom computes no layout, so a
// test asserting `className` contains `overflow-y-auto` cannot tell you
// anything about whether a page scrolls — the contract has to live in a pure
// function that can be swept across heights, the way `~/lib/cardSizing.ts`
// carries the deckbuilder's floor for `deck-builder-height.test.ts` (#2275).
//
// These tests pin the MODEL. `app-shell-scroll-contract.test.tsx` feeds the
// model with flags derived from the real rendered `<AppShell>` DOM, so the two
// together cover "the arithmetic is right" and "the shell actually has the
// shape the arithmetic assumes".
import { describe, it, expect } from "vitest";
import {
    SHELL_HEADER_BAND_PX,
    VIEWPORT_HEIGHT_CLASSES,
    deriveHeightClaim,
    deriveShellModel,
    resolveShellLayout,
    type ShellModel,
} from "../shellLayout";

/** The shape `app-shell.tsx` ships today. */
const SHIPPED: ShellModel = {
    rootBounded: true,
    headerPinned: true,
    mainCanShrink: true,
    mainScrolls: true,
};

/** Desktop heights the app is actually used at, plus the two HITL sizes. */
const DESKTOP_HEIGHTS_PX = [500, 600, 720, 768, 800, 900, 1080, 1200, 1440];

describe("resolveShellLayout — the shipped shell, at desktop heights (issue #2274)", () => {
    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: a route claiming the shell's remainder and scrolling its own excess needs no scrollbar anywhere",
        (viewportHeightPx) => {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                {
                    kind: "remaining",
                    overflow: "scrolls",
                    heightPx: viewportHeightPx * 3,
                }
            );
            expect(layout.mainHeightPx).toBe(
                viewportHeightPx - SHELL_HEADER_BAND_PX
            );
            expect(layout.mainOverflowPx).toBe(0);
            expect(layout.clippedPx).toBe(0);
            expect(layout.scrollers).toEqual([]);
            expect(layout.bottomReachable).toBe(true);
        }
    );

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: a route TALLER than the viewport scrolls to its own bottom through <main>, and only <main>",
        (viewportHeightPx) => {
            const contentPx = viewportHeightPx * 3;
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                { kind: "intrinsic", heightPx: contentPx }
            );
            // Exactly one scroll container, and it is the one the shell owns.
            expect(layout.scrollers).toEqual(["main"]);
            expect(layout.documentMaxScrollTopPx).toBe(0);
            // Scrolling `<main>` to its end puts the content's last pixel on
            // screen — the whole point of relocating the scroll container.
            expect(layout.mainMaxScrollTopPx).toBe(
                contentPx - layout.mainHeightPx
            );
            expect(layout.bottomReachable).toBe(true);
        }
    );

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: a route claiming a WHOLE viewport under the header overflows <main> by exactly the header band",
        (viewportHeightPx) => {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                { kind: "viewport" }
            );
            // This is the defect issue #2274 names: the same overflow shape
            // #2056 removed, relocated from the document onto `<main>`. The
            // number is the header band, at EVERY height — which is why it was
            // invisible to a measurement taken only under 300px, where the band
            // had already been shrunk by the short-viewport treatment.
            expect(layout.mainOverflowPx).toBe(SHELL_HEADER_BAND_PX);
            expect(layout.scrollers).toEqual(["main"]);
        }
    );

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: `min-h-full` (the fixed state screens) fills the remainder with no overflow",
        (viewportHeightPx) => {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                { kind: "atLeastRemaining", heightPx: 240 }
            );
            expect(layout.contentHeightPx).toBe(layout.mainHeightPx);
            expect(layout.mainOverflowPx).toBe(0);
            expect(layout.scrollers).toEqual([]);
        }
    );

    it("`min-h-full` is a FLOOR, not a cap — content taller than the remainder still reaches its bottom through <main>", () => {
        const layout = resolveShellLayout(
            SHIPPED,
            { viewportHeightPx: 900, headerBandHeightPx: SHELL_HEADER_BAND_PX },
            { kind: "atLeastRemaining", heightPx: 2000 }
        );
        expect(layout.contentHeightPx).toBe(2000);
        expect(layout.scrollers).toEqual(["main"]);
        expect(layout.mainMaxScrollTopPx).toBe(2000 - layout.mainHeightPx);
        expect(layout.bottomReachable).toBe(true);
    });

    it("a route with NO shared header (`/game`) gets the whole viewport, and the arithmetic is unchanged", () => {
        const layout = resolveShellLayout(
            SHIPPED,
            { viewportHeightPx: 1080, headerBandHeightPx: 0 },
            { kind: "remaining", overflow: "scrolls", heightPx: 3000 }
        );
        expect(layout.mainHeightPx).toBe(1080);
        expect(layout.mainOverflowPx).toBe(0);
        expect(layout.scrollers).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The clipping route root — issue #2274's blocking finding.
//
// `resolveShellLayout` originally had NO input for a route root's overflow: a
// `remaining` claim was assumed to absorb its own deficit in an internal
// scroller. True for the deckbuilder (#2275), false for the lobby, whose root
// was `flex-1 overflow-hidden` with only per-panel scrollers. The model
// therefore reported `/` as "no overflow, `<main>` scrolls" while in reality
// nothing scrolled and `LobbyFooter` was unreachable at every desktop height.
// ────────────────────────────────────────────────────────────────────────────
describe("a `flex-1` route root that HIDES its overflow clips the page (issue #2274)", () => {
    /** The lobby's measured content column against the two HITL viewports. */
    const LOBBY_COLUMN_PX = 1030;

    it.each([
        [900, 1440], // 1440x900
        [1080, 1920], // 1920x1080
    ])(
        "at %ipx (the %ipx-wide HITL size): the bottom is NOT reachable, and no scrollbar exists to reach it",
        (viewportHeightPx) => {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                {
                    kind: "remaining",
                    overflow: "clips",
                    heightPx: LOBBY_COLUMN_PX,
                }
            );
            const mainHeightPx = viewportHeightPx - SHELL_HEADER_BAND_PX;
            // The box is EXACTLY the remainder — the excess is hidden, not
            // handed to `<main>`, so `<main>` sees nothing to scroll.
            expect(layout.mainHeightPx).toBe(mainHeightPx);
            expect(layout.mainOverflowPx).toBe(0);
            expect(layout.mainMaxScrollTopPx).toBe(0);
            expect(layout.documentMaxScrollTopPx).toBe(0);
            expect(layout.scrollers).toEqual([]);
            // ...and this is the difference that `mainOverflowPx` alone cannot
            // express: content is LOST, not merely off-screen.
            expect(layout.clippedPx).toBe(LOBBY_COLUMN_PX - mainHeightPx);
            expect(layout.bottomReachable).toBe(false);
        }
    );

    it("a clipping root whose content FITS the remainder is fine — the flag tracks the content, not the class", () => {
        const layout = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 1440,
                headerBandHeightPx: SHELL_HEADER_BAND_PX,
            },
            { kind: "remaining", overflow: "clips", heightPx: 400 }
        );
        expect(layout.clippedPx).toBe(0);
        expect(layout.bottomReachable).toBe(true);
    });

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: the SAME content in a root that SPILLS instead reaches its bottom through <main>",
        (viewportHeightPx) => {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                {
                    kind: "remaining",
                    overflow: "spills",
                    heightPx: viewportHeightPx * 3,
                }
            );
            expect(layout.clippedPx).toBe(0);
            expect(layout.scrollers).toEqual(["main"]);
            expect(layout.mainMaxScrollTopPx).toBe(
                viewportHeightPx * 3 - layout.mainHeightPx
            );
            expect(layout.bottomReachable).toBe(true);
        }
    );

    it("the lobby's post-fix claim (`min-h-full`) reaches the same content's bottom at both HITL heights", () => {
        for (const viewportHeightPx of [900, 1080]) {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                { kind: "atLeastRemaining", heightPx: LOBBY_COLUMN_PX }
            );
            expect(layout.clippedPx).toBe(0);
            expect(layout.bottomReachable).toBe(true);
            expect(layout.mainMaxScrollTopPx).toBe(
                LOBBY_COLUMN_PX - layout.mainHeightPx
            );
        }
    });
});

// The regressions the shipped shape exists to prevent. Each of these is a
// shape that was actually shipped (or actually attempted) at some point, and
// each is what goes red if the corresponding class is dropped from
// `app-shell.tsx` — see the proof-of-failure note in the PR.
describe("resolveShellLayout — the shapes the contract rules out (issue #2056 / #2274)", () => {
    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: an UNBOUNDED root (min-h-dvh) pushes the scroll back onto the DOCUMENT",
        (viewportHeightPx) => {
            const contentPx = viewportHeightPx * 3;
            const layout = resolveShellLayout(
                { ...SHIPPED, rootBounded: false },
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                { kind: "intrinsic", heightPx: contentPx }
            );
            // `flex-1` resolves against CONTENT once nothing above it is
            // bounded, so `<main>` grows to the whole page and never scrolls;
            // the document does instead. Browser-measured as
            // document.scrollHeight 1199 against a 277px viewport (#2056).
            expect(layout.mainHeightPx).toBeGreaterThanOrEqual(contentPx);
            expect(layout.mainMaxScrollTopPx).toBe(0);
            expect(layout.scrollers).toEqual(["document"]);
        }
    );

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: <main> without min-h-0 refuses to shrink, so the document overflows and the header band is squeezed",
        (viewportHeightPx) => {
            const contentPx = viewportHeightPx * 3;
            const layout = resolveShellLayout(
                { ...SHIPPED, mainCanShrink: false, headerPinned: false },
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                { kind: "intrinsic", heightPx: contentPx }
            );
            expect(layout.mainHeightPx).toBe(contentPx);
            expect(layout.documentMaxScrollTopPx).toBeGreaterThan(0);
            expect(layout.headerHeightPx).toBeLessThan(SHELL_HEADER_BAND_PX);
        }
    );

    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: <main> without overflow-y-auto cannot scroll, so the overflow spills back onto the document",
        (viewportHeightPx) => {
            const contentPx = viewportHeightPx * 3;
            const layout = resolveShellLayout(
                { ...SHIPPED, mainScrolls: false },
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_HEADER_BAND_PX,
                },
                { kind: "intrinsic", heightPx: contentPx }
            );
            expect(layout.mainMaxScrollTopPx).toBe(0);
            expect(layout.scrollers).toEqual(["document"]);
        }
    );

    it("a pinned header keeps its full band even when <main> refuses to shrink", () => {
        const layout = resolveShellLayout(
            { ...SHIPPED, mainCanShrink: false },
            { viewportHeightPx: 900, headerBandHeightPx: SHELL_HEADER_BAND_PX },
            { kind: "intrinsic", heightPx: 3000 }
        );
        expect(layout.headerHeightPx).toBe(SHELL_HEADER_BAND_PX);
    });
});

describe("deriveShellModel / deriveHeightClaim (issue #2274)", () => {
    it("reads the shipped shell's shape out of its class strings", () => {
        expect(
            deriveShellModel({
                root: "flex h-dvh flex-col bg-surface-base text-text",
                headerWrapper:
                    "relative z-20 mx-auto w-full max-w-6xl shrink-0 px-6 pt-6",
                main: "flex flex-1 min-h-0 flex-col overflow-y-auto",
            })
        ).toEqual({
            rootBounded: true,
            headerPinned: true,
            mainCanShrink: true,
            mainScrolls: true,
        });
    });

    it("a bare min-h-dvh root does NOT read as bounded (it is a minimum, not a bound)", () => {
        expect(
            deriveShellModel({
                root: "flex min-h-dvh flex-col",
                headerWrapper: "shrink-0",
                main: "flex flex-1 min-h-0 flex-col overflow-y-auto",
            }).rootBounded
        ).toBe(false);
    });

    it("a route with no shared header counts as pinned (there is no band to squeeze)", () => {
        expect(
            deriveShellModel({
                root: "flex h-dvh flex-col",
                headerWrapper: null,
                main: "flex flex-1 min-h-0 flex-col overflow-y-auto",
            }).headerPinned
        ).toBe(true);
    });

    it.each(VIEWPORT_HEIGHT_CLASSES)(
        "classifies `%s` as a whole-viewport claim",
        (token) => {
            expect(
                deriveHeightClaim(`relative flex ${token} flex-col`).kind
            ).toBe("viewport");
        }
    );

    it("classifies `min-h-full` as the shell's remainder-as-a-floor", () => {
        expect(deriveHeightClaim("flex min-h-full items-center", 240)).toEqual({
            kind: "atLeastRemaining",
            heightPx: 240,
        });
    });

    it("classifies `flex-1` as the shell's remainder, SPILLING its excess to <main>", () => {
        expect(deriveHeightClaim("flex flex-1 min-h-0 flex-col", 1800)).toEqual(
            {
                kind: "remaining",
                overflow: "spills",
                heightPx: 1800,
            }
        );
    });

    it("classifies `flex-1 overflow-hidden` as CLIPPING — the lobby's pre-fix root", () => {
        expect(
            deriveHeightClaim(
                "relative flex-1 overflow-hidden bg-surface-base text-text",
                1030
            )
        ).toEqual({ kind: "remaining", overflow: "clips", heightPx: 1030 });
    });

    it("a clipping root that is DECLARED to own a whole-column scroller reads as scrolling", () => {
        expect(
            deriveHeightClaim("flex flex-1 overflow-hidden", 1030, {
                hasOwnScroller: true,
            })
        ).toEqual({ kind: "remaining", overflow: "scrolls", heightPx: 1030 });
    });

    it("`hasOwnScroller` defaults to FALSE — an unclassified clipping root reads as clipping, never as safe", () => {
        // Fail-closed. The fail-open default is what certified the lobby.
        expect(deriveHeightClaim("flex flex-1 overflow-hidden", 1030)).toEqual({
            kind: "remaining",
            overflow: "clips",
            heightPx: 1030,
        });
    });

    it("a root that scrolls ITSELF reads as scrolling without any declaration", () => {
        expect(
            deriveHeightClaim("flex flex-1 min-h-0 overflow-y-auto", 1030)
        ).toEqual({ kind: "remaining", overflow: "scrolls", heightPx: 1030 });
    });

    it.each(["min-h-[100dvh]", "h-[100vh]", "min-h-[110svh]"])(
        "classifies the arbitrary-value claim `%s` as a whole viewport",
        (token) => {
            expect(
                deriveHeightClaim(`relative flex ${token} flex-col`).kind
            ).toBe("viewport");
        }
    );

    it.each(["min-h-[60dvh]", "h-[min(30rem,60vh)]", "max-h-[80vh]"])(
        "does NOT read the FRACTIONAL viewport value `%s` as a whole-viewport claim",
        (token) => {
            // Both live idioms (`not-found-page.tsx`, `sideboarding-dialog.tsx`).
            // Flagging them would buy allowlist entries and no safety.
            expect(
                deriveHeightClaim(`relative flex ${token} flex-col`).kind
            ).not.toBe("viewport");
        }
    );

    it("classifies anything else as an ordinary intrinsic-height page", () => {
        expect(deriveHeightClaim("relative", 1800)).toEqual({
            kind: "intrinsic",
            heightPx: 1800,
        });
    });
});

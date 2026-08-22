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
    SHELL_BOTTOM_NAV_BAND_PX,
    SHELL_BROWSE_BAND_PX,
    SHELL_BROWSE_COMPACT_BAND_PX,
    SHELL_CONTEXTUAL_BAND_PX,
    SHELL_CONTEXTUAL_COMPACT_BAND_PX,
    SHELL_RETURN_BANNER_PX,
    VIEWPORT_HEIGHT_CLASSES,
    deriveHeightClaim,
    deriveShellModel,
    resolveShellLayout,
    shellBands,
    type RouteRootOverflow,
    type ShellHeightClaim,
    type ShellHeightClaimKind,
    type ShellModel,
} from "../shellLayout";

/** The shape `app-shell.tsx` ships today. */
const SHIPPED: ShellModel = {
    rootBounded: true,
    headerPinned: true,
    bottomPinned: true,
    mainCanShrink: true,
    mainScrolls: true,
};

/** Desktop heights the app is actually used at, plus the two HITL sizes. */
const DESKTOP_HEIGHTS_PX = [500, 600, 720, 768, 800, 900, 1080, 1200, 1440];
/**
 * A route root's height claim. `overflow` and `shrinks` are stated at every
 * call site because `ShellHeightClaim` makes them REQUIRED — a claim that
 * could omit its overflow is what certified the clipping lobby as correct
 * twice (issue #2274). `shrinks` defaults to `true`, the CLAMPABLE case: a
 * route root is a shrinkable flex child of `<main>` unless it says otherwise.
 */
function claim(
    kind: ShellHeightClaimKind,
    overflow: RouteRootOverflow,
    heightPx = 0,
    shrinks = true
): ShellHeightClaim {
    return { kind, heightPx, overflow, shrinks };
}

describe("resolveShellLayout — the shipped shell, at desktop heights (issue #2274)", () => {
    it.each(DESKTOP_HEIGHTS_PX)(
        "at %ipx: a route claiming the shell's remainder and scrolling its own excess needs no scrollbar anywhere",
        (viewportHeightPx) => {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("remaining", "scrolls", viewportHeightPx * 3)
            );
            expect(layout.mainHeightPx).toBe(
                viewportHeightPx - SHELL_BROWSE_BAND_PX
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("intrinsic", "spills", contentPx)
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("viewport", "spills")
            );
            // This is the defect issue #2274 names: the same overflow shape
            // #2056 removed, relocated from the document onto `<main>`. The
            // number is the header band, at EVERY height — which is why it was
            // invisible to a measurement taken only under 300px, where the band
            // had already been shrunk by the short-viewport treatment.
            expect(layout.mainOverflowPx).toBe(SHELL_BROWSE_BAND_PX);
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("atLeastRemaining", "spills", 240)
            );
            expect(layout.contentHeightPx).toBe(layout.mainHeightPx);
            expect(layout.mainOverflowPx).toBe(0);
            expect(layout.scrollers).toEqual([]);
        }
    );

    it("`min-h-full` is a FLOOR, not a cap — content taller than the remainder still reaches its bottom through <main>", () => {
        const layout = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 900,
                headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                bottomBandHeightPx: 0,
            },
            claim("atLeastRemaining", "spills", 2000)
        );
        expect(layout.contentHeightPx).toBe(2000);
        expect(layout.scrollers).toEqual(["main"]);
        expect(layout.mainMaxScrollTopPx).toBe(2000 - layout.mainHeightPx);
        expect(layout.bottomReachable).toBe(true);
    });

    it("a route with NO shared header (`/game`) gets the whole viewport, and the arithmetic is unchanged", () => {
        const layout = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 1080,
                headerBandHeightPx: 0,
                bottomBandHeightPx: 0,
            },
            claim("remaining", "scrolls", 3000)
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("remaining", "clips", LOBBY_COLUMN_PX)
            );
            const mainHeightPx = viewportHeightPx - SHELL_BROWSE_BAND_PX;
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
                headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                bottomBandHeightPx: 0,
            },
            claim("remaining", "clips", 400)
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("remaining", "spills", viewportHeightPx * 3)
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("atLeastRemaining", "spills", LOBBY_COLUMN_PX)
            );
            expect(layout.clippedPx).toBe(0);
            expect(layout.bottomReachable).toBe(true);
            expect(layout.mainMaxScrollTopPx).toBe(
                LOBBY_COLUMN_PX - layout.mainHeightPx
            );
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The clip, not the height claim, is what makes the bottom unreachable.
//
// Round 2 of issue #2274 "fixed" the lobby by changing `flex-1
// overflow-hidden` to `min-h-full overflow-hidden`, and Chrome measured the
// result as byte-identical to the bug (root 788, `<main>.scrollHeight` 788,
// `maxScrollTop` 0, footer unreachable at 1440x900 AND 1920x1080), while the
// same root WITHOUT the clip grew to 3252 and scrolled (`maxScrollTop` 2464).
// The model agreed with the fix because `overflow` was a field of ONE claim
// variant. These sweep the SAME clipping root across every claim kind.
// ────────────────────────────────────────────────────────────────────────────
describe("a clipping route root hides its bottom whatever height it claims (issue #2274)", () => {
    const LOBBY_COLUMN_PX = 1030;

    it.each([
        ["remaining", 900],
        ["remaining", 1080],
        ["atLeastRemaining", 900],
        ["atLeastRemaining", 1080],
        ["intrinsic", 900],
        ["intrinsic", 1080],
    ] as [ShellHeightClaimKind, number][])(
        "a `%s` root that CLIPS is unreachable at %ipx — the round-2 no-op, seen by the model",
        (kind, viewportHeightPx) => {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim(kind, "clips", LOBBY_COLUMN_PX)
            );
            const mainHeightPx = viewportHeightPx - SHELL_BROWSE_BAND_PX;
            expect(layout.clippedPx).toBe(LOBBY_COLUMN_PX - mainHeightPx);
            expect(layout.scrollers).toEqual([]);
            expect(layout.bottomReachable).toBe(false);
        }
    );

    it.each([
        ["remaining", 900],
        ["remaining", 1080],
        ["atLeastRemaining", 900],
        ["atLeastRemaining", 1080],
        ["intrinsic", 900],
        ["intrinsic", 1080],
    ] as [ShellHeightClaimKind, number][])(
        "...and the SAME `%s` root reaches its bottom at %ipx once the clip is dropped — the round-3 fix",
        (kind, viewportHeightPx) => {
            const layout = resolveShellLayout(
                SHIPPED,
                {
                    viewportHeightPx,
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim(kind, "spills", LOBBY_COLUMN_PX)
            );
            expect(layout.clippedPx).toBe(0);
            expect(layout.scrollers).toEqual(["main"]);
            expect(layout.mainMaxScrollTopPx).toBe(
                LOBBY_COLUMN_PX - layout.mainHeightPx
            );
            expect(layout.bottomReachable).toBe(true);
        }
    );

    it("a whole-viewport root that CLIPS loses everything past the viewport, header band or no", () => {
        const layout = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 900,
                headerBandHeightPx: 0,
                bottomBandHeightPx: 0,
            },
            claim("viewport", "clips", 4000)
        );
        expect(layout.clippedPx).toBe(4000 - 900);
        expect(layout.bottomReachable).toBe(false);
    });

    it("a `shrink-0` root is the one shape a clip does NOT clamp — it grows and <main> scrolls to it", () => {
        // Browser-measured: an unshrinkable root grew to 3252px with
        // `overflow-hidden` still on it, where the shrinkable one boxed out at
        // 788. This is why `shrinks` is an input and not an assumption.
        const layout = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 900,
                headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                bottomBandHeightPx: 0,
            },
            claim("atLeastRemaining", "clips", 3212, false)
        );
        expect(layout.clippedPx).toBe(0);
        expect(layout.scrollers).toEqual(["main"]);
        expect(layout.bottomReachable).toBe(true);
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("intrinsic", "spills", contentPx)
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("intrinsic", "spills", contentPx)
            );
            expect(layout.mainHeightPx).toBe(contentPx);
            expect(layout.documentMaxScrollTopPx).toBeGreaterThan(0);
            expect(layout.headerHeightPx).toBeLessThan(SHELL_BROWSE_BAND_PX);
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
                    headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                    bottomBandHeightPx: 0,
                },
                claim("intrinsic", "spills", contentPx)
            );
            expect(layout.mainMaxScrollTopPx).toBe(0);
            expect(layout.scrollers).toEqual(["document"]);
        }
    );

    it("a pinned header keeps its full band even when <main> refuses to shrink", () => {
        const layout = resolveShellLayout(
            { ...SHIPPED, mainCanShrink: false },
            {
                viewportHeightPx: 900,
                headerBandHeightPx: SHELL_BROWSE_BAND_PX,
                bottomBandHeightPx: 0,
            },
            claim("intrinsic", "spills", 3000)
        );
        expect(layout.headerHeightPx).toBe(SHELL_BROWSE_BAND_PX);
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
            bottomPinned: true,
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
            overflow: "spills",
            shrinks: true,
        });
    });

    // The round-2 fix for this issue changed the lobby's root from `flex-1
    // overflow-hidden` to `min-h-full overflow-hidden` and was measured in
    // Chrome to be a NO-OP (identical 788px box, identical maxScrollTop 0).
    // The model could not see it: `overflow` lived only on the `remaining`
    // variant, so re-classifying the SAME clipping root dropped the field.
    it("reads the overflow of a `min-h-full` root too — the claim that hid the round-2 no-op", () => {
        expect(
            deriveHeightClaim(
                "relative min-h-full overflow-hidden bg-surface-base",
                1030
            )
        ).toEqual({
            kind: "atLeastRemaining",
            heightPx: 1030,
            overflow: "clips",
            shrinks: true,
        });
    });

    it("reads the overflow of an INTRINSIC root too — no claim kind is exempt", () => {
        expect(deriveHeightClaim("relative overflow-hidden", 1030)).toEqual({
            kind: "intrinsic",
            heightPx: 1030,
            overflow: "clips",
            shrinks: true,
        });
    });

    it("reads the overflow of a WHOLE-VIEWPORT root too", () => {
        expect(
            deriveHeightClaim(
                "relative flex h-dvh flex-col overflow-hidden",
                1030
            )
        ).toEqual({
            kind: "viewport",
            heightPx: 1030,
            overflow: "clips",
            shrinks: true,
        });
    });

    it.each(["shrink-0", "flex-none"])(
        "reads `%s` as a root that refuses to be squeezed by <main>",
        (token) => {
            expect(
                deriveHeightClaim(`relative ${token} overflow-hidden`, 1030)
                    .shrinks
            ).toBe(false);
        }
    );

    it("a root with no shrink opt-out is SHRINKABLE — the clampable case is the default", () => {
        expect(deriveHeightClaim("relative min-h-full", 1030).shrinks).toBe(
            true
        );
    });

    it("classifies `flex-1` as the shell's remainder, SPILLING its excess to <main>", () => {
        expect(deriveHeightClaim("flex flex-1 min-h-0 flex-col", 1800)).toEqual(
            {
                kind: "remaining",
                overflow: "spills",
                heightPx: 1800,
                shrinks: true,
            }
        );
    });

    it("classifies `flex-1 overflow-hidden` as CLIPPING — the lobby's pre-fix root", () => {
        expect(
            deriveHeightClaim(
                "relative flex-1 overflow-hidden bg-surface-base text-text",
                1030
            )
        ).toEqual({
            kind: "remaining",
            overflow: "clips",
            heightPx: 1030,
            shrinks: true,
        });
    });

    it("a clipping root that is DECLARED to own a whole-column scroller reads as scrolling", () => {
        expect(
            deriveHeightClaim("flex flex-1 overflow-hidden", 1030, {
                hasOwnScroller: true,
            })
        ).toEqual({
            kind: "remaining",
            overflow: "scrolls",
            heightPx: 1030,
            shrinks: true,
        });
    });

    it("`hasOwnScroller` defaults to FALSE — an unclassified clipping root reads as clipping, never as safe", () => {
        // Fail-closed. The fail-open default is what certified the lobby.
        expect(deriveHeightClaim("flex flex-1 overflow-hidden", 1030)).toEqual({
            kind: "remaining",
            overflow: "clips",
            heightPx: 1030,
            shrinks: true,
        });
    });

    it("a root that scrolls ITSELF reads as scrolling without any declaration", () => {
        expect(
            deriveHeightClaim("flex flex-1 min-h-0 overflow-y-auto", 1030)
        ).toEqual({
            kind: "remaining",
            overflow: "scrolls",
            heightPx: 1030,
            shrinks: true,
        });
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
            overflow: "spills",
            shrinks: true,
        });
    });
});

// ────────────────────────────────────────────────────────────────────────────
// The v3 bands (issue #2582, ADR 0101). `shellBands` is the ONE place the
// (mode × viewport × banner) matrix turns into numbers, and the reason the
// bottom nav is in this module at all: it costs `<main>` height exactly as a
// header does, and the pre-v3 model had no axis for a band below `<main>`.
// ────────────────────────────────────────────────────────────────────────────
describe("shellBands — mode x viewport (issue #2582)", () => {
    it("gives the board no band at all: <main> IS the viewport", () => {
        for (const viewport of [
            "portrait",
            "landscape-compact",
            "desktop",
        ] as const) {
            expect(
                shellBands({
                    mode: "immersive",
                    ownChrome: true,
                    viewport,
                    returnBanner: false,
                }),
                viewport
            ).toEqual({ headerBandHeightPx: 0, bottomBandHeightPx: 0 });
        }
    });

    it("charges the board nothing even when a banner would otherwise show", () => {
        // Belt and braces with `shellShowsReturnBanner`, which already refuses
        // the banner on an `ownChrome` route: the two must not be able to
        // disagree about a height (the #2274 shape).
        expect(
            shellBands({
                mode: "immersive",
                ownChrome: true,
                viewport: "desktop",
                returnBanner: true,
            })
        ).toEqual({ headerBandHeightPx: 0, bottomBandHeightPx: 0 });
    });

    it("gives Browse the 56px top bar on desktop and no bottom band", () => {
        expect(
            shellBands({
                mode: "browse",
                ownChrome: false,
                viewport: "desktop",
                returnBanner: false,
            })
        ).toEqual({
            headerBandHeightPx: SHELL_BROWSE_BAND_PX,
            bottomBandHeightPx: 0,
        });
    });

    it("cuts the Browse bar to 40px on a landscape phone instead of adding a bottom nav", () => {
        // A landscape phone has 375-430px of height in total: two bands would
        // spend a quarter of it on chrome.
        expect(
            shellBands({
                mode: "browse",
                ownChrome: false,
                viewport: "landscape-compact",
                returnBanner: false,
            })
        ).toEqual({
            headerBandHeightPx: SHELL_BROWSE_COMPACT_BAND_PX,
            bottomBandHeightPx: 0,
        });
    });

    it("moves phone-portrait Browse navigation to the BOTTOM band and drops the top bar", () => {
        expect(
            shellBands({
                mode: "browse",
                ownChrome: false,
                viewport: "portrait",
                returnBanner: false,
            })
        ).toEqual({
            headerBandHeightPx: 0,
            bottomBandHeightPx: SHELL_BOTTOM_NAV_BAND_PX,
        });
    });

    it("adds the home indicator's safe-area inset ON TOP of the bottom nav's own height", () => {
        // `min-h-14` + `pb-[env(safe-area-inset-bottom)]`: border-box padding
        // GROWS the band rather than eating the items, so the model must add
        // the inset, not absorb it.
        expect(
            shellBands({
                mode: "browse",
                ownChrome: false,
                viewport: "portrait",
                returnBanner: false,
                safeAreaBottomPx: 34,
            }).bottomBandHeightPx
        ).toBe(SHELL_BOTTOM_NAV_BAND_PX + 34);
    });

    it("never charges the safe-area inset to a band that is not the bottom nav", () => {
        for (const viewport of ["landscape-compact", "desktop"] as const) {
            expect(
                shellBands({
                    mode: "browse",
                    ownChrome: false,
                    viewport,
                    returnBanner: false,
                    safeAreaBottomPx: 34,
                }).bottomBandHeightPx,
                viewport
            ).toBe(0);
        }
    });

    it("gives every immersive non-board route the contextual bar, sized per viewport (issue #2662)", () => {
        // 44px in portrait/desktop; 36px on a landscape phone — the same
        // height-driven split the Browse branch above already applies
        // (`SHELL_BROWSE_BAND_PX` / `SHELL_BROWSE_COMPACT_BAND_PX`).
        const expected = {
            portrait: SHELL_CONTEXTUAL_BAND_PX,
            "landscape-compact": SHELL_CONTEXTUAL_COMPACT_BAND_PX,
            desktop: SHELL_CONTEXTUAL_BAND_PX,
        } as const;
        for (const viewport of [
            "portrait",
            "landscape-compact",
            "desktop",
        ] as const) {
            expect(
                shellBands({
                    mode: "immersive",
                    ownChrome: false,
                    viewport,
                    returnBanner: false,
                }),
                viewport
            ).toEqual({
                headerBandHeightPx: expected[viewport],
                bottomBandHeightPx: 0,
            });
        }
    });

    it("adds the return banner to the TOP band in every mode and viewport", () => {
        const cases = [
            ["browse", false, "desktop", SHELL_BROWSE_BAND_PX],
            [
                "browse",
                false,
                "landscape-compact",
                SHELL_BROWSE_COMPACT_BAND_PX,
            ],
            ["browse", false, "portrait", 0],
            ["immersive", false, "desktop", SHELL_CONTEXTUAL_BAND_PX],
            [
                "immersive",
                false,
                "landscape-compact",
                SHELL_CONTEXTUAL_COMPACT_BAND_PX,
            ],
        ] as const;
        for (const [mode, ownChrome, viewport, base] of cases) {
            expect(
                shellBands({
                    mode,
                    ownChrome,
                    viewport,
                    returnBanner: true,
                }).headerBandHeightPx,
                `${mode}/${viewport}`
            ).toBe(base + SHELL_RETURN_BANNER_PX);
        }
    });
});

describe("resolveShellLayout — the BOTTOM band costs <main> height (issue #2582)", () => {
    it("subtracts the bottom nav from <main> exactly as it subtracts a header", () => {
        // The bug this guards is the whole reason the bottom nav entered this
        // module: a band the model does not know about leaves `<main>` sized
        // against the full viewport, so the last row of every page sits UNDER
        // the nav, unreachable.
        const withBottom = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 844,
                headerBandHeightPx: 0,
                bottomBandHeightPx: SHELL_BOTTOM_NAV_BAND_PX + 34,
            },
            claim("remaining", "scrolls")
        );
        const withHeaderOfTheSameSize = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 844,
                headerBandHeightPx: SHELL_BOTTOM_NAV_BAND_PX + 34,
                bottomBandHeightPx: 0,
            },
            claim("remaining", "scrolls")
        );
        expect(withBottom.mainHeightPx).toBe(844 - (56 + 34));
        expect(withBottom.mainHeightPx).toBe(
            withHeaderOfTheSameSize.mainHeightPx
        );
    });

    it("keeps the document unscrollable with BOTH bands showing", () => {
        // Both bands + `<main>` must still add up to the viewport, or the page
        // grows a document scrollbar (#2056) with chrome pinned at both ends.
        const layout = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 844,
                headerBandHeightPx: SHELL_RETURN_BANNER_PX,
                bottomBandHeightPx: SHELL_BOTTOM_NAV_BAND_PX,
            },
            claim("remaining", "scrolls")
        );
        expect(layout.documentMaxScrollTopPx).toBe(0);
        expect(
            layout.headerHeightPx + layout.mainHeightPx + layout.bottomHeightPx
        ).toBe(844);
        expect(layout.bottomReachable).toBe(true);
    });

    it("reports the bottom band squeezed when it is NOT pinned", () => {
        // `shrink-0` on the nav is what stops a stubborn page from eating it;
        // dropping that class must be visible in the model, not silent.
        const unpinned: ShellModel = {
            ...SHIPPED,
            bottomPinned: false,
            mainCanShrink: false,
        };
        const layout = resolveShellLayout(
            unpinned,
            {
                viewportHeightPx: 400,
                headerBandHeightPx: 0,
                bottomBandHeightPx: SHELL_BOTTOM_NAV_BAND_PX,
            },
            claim("intrinsic", "spills", 900)
        );
        expect(layout.bottomHeightPx).toBeLessThan(SHELL_BOTTOM_NAV_BAND_PX);
    });

    it("keeps the bottom band at full height when it IS pinned, however long the page", () => {
        const layout = resolveShellLayout(
            SHIPPED,
            {
                viewportHeightPx: 400,
                headerBandHeightPx: 0,
                bottomBandHeightPx: SHELL_BOTTOM_NAV_BAND_PX,
            },
            claim("intrinsic", "spills", 4000)
        );
        expect(layout.bottomHeightPx).toBe(SHELL_BOTTOM_NAV_BAND_PX);
    });
});

describe("deriveShellModel — the bottom band's pin (issue #2582)", () => {
    it("reads `shrink-0` off the bottom band element", () => {
        expect(
            deriveShellModel({
                root: "flex h-dvh flex-col",
                headerWrapper: null,
                main: "flex flex-1 min-h-0 flex-col overflow-y-auto",
                bottomBand: "flex min-h-14 shrink-0 items-stretch",
            }).bottomPinned
        ).toBe(true);
    });

    it("flags a bottom band that can be squeezed", () => {
        expect(
            deriveShellModel({
                root: "flex h-dvh flex-col",
                headerWrapper: null,
                main: "flex flex-1 min-h-0 flex-col overflow-y-auto",
                bottomBand: "flex min-h-14 items-stretch",
            }).bottomPinned
        ).toBe(false);
    });

    it("treats a route with no bottom band as pinned — there is nothing to squeeze", () => {
        expect(
            deriveShellModel({
                root: "flex h-dvh flex-col",
                headerWrapper: "shrink-0",
                main: "flex flex-1 min-h-0 flex-col overflow-y-auto",
                bottomBand: null,
            }).bottomPinned
        ).toBe(true);
    });
});

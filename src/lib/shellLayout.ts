/**
 * Layout arithmetic for the app shell's scroll contract (issue #2274).
 *
 * Issue #2056 moved the app's scroll container from the DOCUMENT to `<main>`
 * for EVERY route — the shell root took a hard `h-dvh` bound and `<main>` took
 * `flex-1 min-h-0 overflow-y-auto`. That change was only ever verified by a
 * browser pass at viewport heights under 300px (inside the `max-height: 500px`
 * media branch), yet it is not media-gated: it applies at every height. What
 * was missing was not a measurement at one more height — it was a statement of
 * the contract that could be checked at all of them.
 *
 * jsdom computes no layout, so a test asserting `className` contains
 * `overflow-y-auto` proves nothing about scrolling. This module is the seam
 * that makes the contract checkable: the shell's box chain expressed as
 * arithmetic (`resolveShellLayout`), plus derivations that read the model and
 * the route's height claim OFF THE REAL RENDERED DOM (`deriveShellModel`,
 * `deriveHeightClaim`) so a test traverses the actual component output rather
 * than a hand-built stand-in. Same shape as `~/lib/cardSizing.ts` +
 * `deck-builder-height.test.ts` (issue #2275): put the number in a pure
 * function, then sweep it.
 *
 * Every rule below is a flexbox behaviour that issues #2056 / #2275 established
 * by browser measurement — this module restates them, it does not invent them:
 *
 *  - An UNBOUNDED root (`min-h-dvh`, a minimum) makes `flex-1` resolve against
 *    CONTENT rather than the viewport, so `<main>` grows past the leftover
 *    space and the DOCUMENT scrolls. Measured: `document.scrollHeight` 1199
 *    against a 277px viewport (#2056 defect 3, the amplified regression).
 *  - Without `min-h-0`, a flex item refuses to shrink below its content's
 *    min-content size, so `<main>` again outgrows the space it was given.
 *  - A `shrink-0` header band keeps its full height; an unpinned one is
 *    squashed by a sibling that refuses to shrink.
 *  - A route root that claims a WHOLE viewport (`h-dvh` / `h-screen`) while
 *    sitting UNDER the header band overflows `<main>` by exactly the header's
 *    height — the same overflow shape #2056 removed, relocated rather than
 *    eliminated. That is the defect this module's `mainOverflowPx` names.
 */

/** A box that can scroll in the shell's chain. */
export type ShellScroller = "document" | "main";

/** How a route's own root element claims vertical space inside `<main>`. */
export type ShellHeightClaim =
    /** `h-dvh` / `h-screen` / `min-h-dvh` — a WHOLE viewport, header or no. */
    | { kind: "viewport" }
    /** `flex-1` (+ `min-h-0`) — whatever the shell has left after the header. */
    | { kind: "remaining" }
    /**
     * `min-h-full` — the shell's remainder as a FLOOR: fills it when the
     * content is shorter, grows past it when the content is taller (so
     * `<main>` scrolls to the excess rather than the box clipping it).
     */
    | { kind: "atLeastRemaining"; heightPx: number }
    /** An ordinary long page: as tall as its content wants to be. */
    | { kind: "intrinsic"; heightPx: number };

/** The chrome a route is rendered into. */
export interface ShellChrome {
    viewportHeightPx: number;
    /** The header band's height, or 0 when `shellShowsHeader()` is false. */
    headerBandHeightPx: number;
}

/**
 * The shell's structural contract, derived from the rendered DOM rather than
 * asserted class-by-class — each flag is a layout CAPABILITY, and the
 * arithmetic below is what turns it into an observable consequence.
 */
export interface ShellModel {
    /** Root carries a HARD height bound (`h-dvh`), not a bare `min-h-dvh`. */
    rootBounded: boolean;
    /** The header band is `shrink-0`, so it keeps its height. */
    headerPinned: boolean;
    /** `<main>` carries `min-h-0`, so it may shrink below its content. */
    mainCanShrink: boolean;
    /** `<main>` carries `overflow-y-auto`, so it is the app-level scroller. */
    mainScrolls: boolean;
}

export interface ShellLayout {
    rootHeightPx: number;
    headerHeightPx: number;
    mainHeightPx: number;
    contentHeightPx: number;
    /** How far the route's content outgrows `<main>`'s box (0 when it fits). */
    mainOverflowPx: number;
    mainMaxScrollTopPx: number;
    documentMaxScrollTopPx: number;
    /** Every box that actually has something to scroll, outermost first. */
    scrollers: ShellScroller[];
    /** Whether the content's last pixel can be brought into view at all. */
    bottomReachable: boolean;
}

/**
 * The shared header band, measured in the browser during issue #2056 (852x277):
 * `AppHeader`'s own ~88px plus the shell wrapper's `pt-6` (24px). Used as the
 * representative value in sweeps; every function here takes the band as a
 * parameter, so nothing depends on it being exactly right.
 */
export const SHELL_HEADER_BAND_PX = 112;

/**
 * Tailwind height utilities that claim a WHOLE viewport. A component rendered
 * under the shared header must never carry one — it would overflow `<main>` by
 * the header band. Exported so the repo-wide guard and `deriveHeightClaim`
 * share one list instead of two drifting regexes.
 */
export const VIEWPORT_HEIGHT_CLASSES = [
    "h-dvh",
    "h-screen",
    "min-h-dvh",
    "min-h-screen",
] as const;

function hasClass(className: string, token: string): boolean {
    return className.split(/\s+/).includes(token);
}

/**
 * Read the shell's structural contract off the rendered elements. Taking the
 * real `className` strings (rather than a hand-written model) is what makes a
 * test using this traverse the component's actual output: change `h-dvh` to
 * `min-h-dvh` in `app-shell.tsx` and every consequence below flips.
 */
export function deriveShellModel(elements: {
    root: string;
    /** `null` for a route with no shared header (`shellShowsHeader()` false). */
    headerWrapper: string | null;
    main: string;
}): ShellModel {
    return {
        rootBounded:
            hasClass(elements.root, "h-dvh") ||
            hasClass(elements.root, "h-screen"),
        headerPinned:
            elements.headerWrapper === null ||
            hasClass(elements.headerWrapper, "shrink-0"),
        mainCanShrink: hasClass(elements.main, "min-h-0"),
        mainScrolls:
            hasClass(elements.main, "overflow-y-auto") ||
            hasClass(elements.main, "overflow-auto"),
    };
}

/**
 * Classify a route root's own height claim from its rendered `className`.
 *
 * `intrinsicHeightPx` is only consulted for the `intrinsic` case — a route that
 * claims neither a viewport nor the shell's remainder is as tall as its content.
 */
export function deriveHeightClaim(
    className: string,
    intrinsicHeightPx = 0
): ShellHeightClaim {
    const claimsViewport = VIEWPORT_HEIGHT_CLASSES.some((token) =>
        hasClass(className, token)
    );
    if (claimsViewport) return { kind: "viewport" };
    if (hasClass(className, "min-h-full"))
        return { kind: "atLeastRemaining", heightPx: intrinsicHeightPx };
    if (hasClass(className, "flex-1")) return { kind: "remaining" };
    return { kind: "intrinsic", heightPx: intrinsicHeightPx };
}

/**
 * The route's own intrinsic demand — what it would be tall enough to need if
 * nothing constrained it. A `remaining` claim demands nothing of its own: it
 * takes what it is given and (per #2275) absorbs any deficit in its own
 * internal scroller.
 */
function naturalContentPx(
    claim: ShellHeightClaim,
    chrome: ShellChrome
): number {
    switch (claim.kind) {
        case "viewport":
            return chrome.viewportHeightPx;
        case "intrinsic":
        case "atLeastRemaining":
            return claim.heightPx;
        case "remaining":
            return 0;
    }
}

/** Resolve the shell's box chain for one route at one viewport height. */
export function resolveShellLayout(
    model: ShellModel,
    chrome: ShellChrome,
    claim: ShellHeightClaim
): ShellLayout {
    const { viewportHeightPx, headerBandHeightPx } = chrome;
    const natural = naturalContentPx(claim, chrome);

    // An unbounded root grows with its content — that is exactly why `flex-1`
    // then resolves against content instead of the viewport (#2056 defect 3).
    const rootHeightPx = model.rootBounded
        ? viewportHeightPx
        : Math.max(viewportHeightPx, headerBandHeightPx + natural);

    const availableForMain = Math.max(0, rootHeightPx - headerBandHeightPx);
    // Without `min-h-0` a flex item cannot shrink below its content.
    const mainHeightPx = model.mainCanShrink
        ? availableForMain
        : Math.max(availableForMain, natural);

    // A main that refuses to shrink squashes an unpinned header band.
    const overshoot = Math.max(
        0,
        headerBandHeightPx + mainHeightPx - rootHeightPx
    );
    const headerHeightPx = model.headerPinned
        ? headerBandHeightPx
        : Math.max(0, headerBandHeightPx - overshoot);

    const contentHeightPx =
        claim.kind === "remaining"
            ? mainHeightPx
            : claim.kind === "atLeastRemaining"
              ? Math.max(mainHeightPx, natural)
              : natural;

    const mainOverflowPx = Math.max(0, contentHeightPx - mainHeightPx);
    const mainMaxScrollTopPx = model.mainScrolls ? mainOverflowPx : 0;

    // What the document has to lay out: the header band, `<main>`'s own box,
    // and — only when `<main>` does NOT scroll — the overflow spilling past it.
    const documentContentHeightPx =
        headerHeightPx +
        mainHeightPx +
        (model.mainScrolls ? 0 : mainOverflowPx);
    const documentMaxScrollTopPx = Math.max(
        0,
        documentContentHeightPx - viewportHeightPx
    );

    const scrollers: ShellScroller[] = [];
    if (documentMaxScrollTopPx > 0) scrollers.push("document");
    if (mainMaxScrollTopPx > 0) scrollers.push("main");

    const bottomReachable = model.mainScrolls
        ? mainMaxScrollTopPx >= mainOverflowPx
        : headerHeightPx + contentHeightPx - documentMaxScrollTopPx <=
          viewportHeightPx;

    return {
        rootHeightPx,
        headerHeightPx,
        mainHeightPx,
        contentHeightPx,
        mainOverflowPx,
        mainMaxScrollTopPx,
        documentMaxScrollTopPx,
        scrollers,
        bottomReachable,
    };
}

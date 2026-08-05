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
 *  - Per CSS Flexbox §4.5, a flex item whose computed `overflow` is not
 *    `visible` gets `min-width/min-height: auto` → 0. So a `flex-1
 *    overflow-hidden` route root resolves to EXACTLY `<main>`'s height and
 *    CLIPS everything past it: `<main>.scrollHeight === clientHeight`, its
 *    `overflow-y-auto` never engages, and there is no scrollbar ANYWHERE. That
 *    is the defect this module's `clippedPx` names — see `RemainderOverflow`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EPISTEMIC LIMIT — read before trusting any sweep that runs through here.
 * This module is a MODEL of flexbox, authored alongside the tests that consume
 * it. Every height sweep in issue #2274 runs through it, so a wrong premise
 * INSIDE it is invisible to all of them at once. That is not hypothetical: the
 * first cut of `resolveShellLayout` assumed a `remaining` claim always absorbs
 * its own deficit in an internal scroller (true for the deckbuilder, false for
 * the lobby), and every route certified through it inherited the assumption.
 * `RemainderOverflow` exists because that assumption had to become an INPUT.
 * A browser pass is the only independent check on the model itself.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A box that can scroll in the shell's chain. */
export type ShellScroller = "document" | "main";

/**
 * What a route root whose box is a HARD height does with content taller than
 * that box.
 *
 * Only the `remaining` claim is a hard box among the claims a route can make:
 * `flex: 1 1 0%` resolves to exactly the space `<main>` has, and (CSS Flexbox
 * §4.5) hiding its overflow drops the `min-height: auto` floor that would
 * otherwise let it grow. `min-h-full` / `intrinsic` are content-sized, so
 * hiding their overflow clips nothing.
 *
 * This is the input `resolveShellLayout` originally lacked. Without it a
 * clipping route root is indistinguishable from one that scrolls internally,
 * and the model certifies both as fine.
 */
export type RemainderOverflow =
    /**
     * The route scrolls its own excess — its root, or a wrapper spanning the
     * whole content column, is a scroller. Issue #2275's deckbuilder shape:
     * the deficit is absorbed inside the route and `<main>` stays disengaged.
     */
    | "scrolls"
    /**
     * `overflow-hidden` (or `-clip`) with nothing scrolling: the excess is
     * CLIPPED. `<main>` sees no overflow, so its `overflow-y-auto` never
     * engages and no scrollbar exists anywhere — the bottom of the page is
     * unreachable. Issue #2274's lobby.
     */
    | "clips"
    /**
     * `overflow: visible`: the excess contributes to `<main>`'s scrollable
     * overflow region, so `<main>` scrolls to it.
     */
    | "spills";

/** How a route's own root element claims vertical space inside `<main>`. */
export type ShellHeightClaim =
    /** `h-dvh` / `h-screen` / `min-h-dvh` — a WHOLE viewport, header or no. */
    | { kind: "viewport" }
    /**
     * `flex-1` — whatever the shell has left after the header, as a HARD box.
     * `overflow` says what happens to content taller than that box, and
     * `heightPx` is what the route's content would need if nothing constrained
     * it. Both are required: a default would fail OPEN, which is precisely the
     * hole this variant exists to close.
     */
    | { kind: "remaining"; overflow: RemainderOverflow; heightPx: number }
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
    /**
     * Content the route's own root HIDES: a hard box (`flex-1`) with its
     * overflow hidden and nothing scrolling it. This never reaches `<main>` —
     * it is not overflow, it is loss — so `mainOverflowPx` stays 0, no
     * scrollbar appears, and `bottomReachable` is false. Issue #2274's lobby.
     */
    clippedPx: number;
    /**
     * Whether the content's last pixel can be brought into view AT ALL, by
     * scrolling every box in the chain to its end.
     *
     * Deliberately derived from the route's own demand (`Math.max(mainHeight,
     * natural)`) rather than from `contentHeightPx` — the latter is already the
     * CLIPPED height for a hard box, so comparing against it would be `x >= x`
     * and could never be false. This field carries issue #2274's acceptance
     * criterion ("every route reaches its bottom"); it has to be falsifiable.
     */
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
    // `svh` / `lvh` are the same claim against a different viewport definition,
    // and `min-h-svh` is a LIVE idiom in this repo (`auth-gate.tsx`,
    // `auth-form.tsx` — both legitimately outside the shell). Omitting them is
    // what would let the next headered component copy that idiom unseen.
    "h-svh",
    "min-h-svh",
    "h-lvh",
    "min-h-lvh",
    // `svh` / `lvh` are the same claim against a different viewport definition,
    // and `min-h-svh` is a LIVE idiom in this repo (`auth-gate.tsx`,
    // `auth-form.tsx` — both legitimately outside the shell). Omitting them is
    // what would let the next headered component copy that idiom unseen.
] as const;

/**
 * Tailwind classes that make a box scroll its own overflow. Shared with the
 * repo-wide guard so the two never drift.
 */
export const SCROLLER_CLASSES = [
    "overflow-y-auto",
    "overflow-auto",
    "overflow-y-scroll",
    "overflow-scroll",
] as const;

/** Tailwind classes that HIDE a box's overflow (it is clipped, not scrolled). */
export const CLIPPING_CLASSES = [
    "overflow-hidden",
    "overflow-y-hidden",
    "overflow-clip",
    "overflow-y-clip",
] as const;

function hasClass(className: string, token: string): boolean {
    return className.split(/\s+/).includes(token);
}

function hasAnyClass(className: string, tokens: readonly string[]): boolean {
    return tokens.some((token) => hasClass(className, token));
}

/**
 * An arbitrary-value height utility claiming a WHOLE viewport —
 * `h-[100dvh]`, `min-h-[100vh]`, `h-[110svh]`. Tailwind's bracket syntax is
 * invisible to a token list, and this is the shape a future component reaches
 * for once the named utilities are guarded.
 *
 * Only >= 100% counts. `not-found-page.tsx`'s 60dvh floor and
 * `sideboarding-dialog.tsx`'s 60vh-clamped dialog height are FRACTIONS of the
 * viewport, not claims on the whole of it, and forcing them onto an allowlist
 * would buy a stale entry and no safety. (Their literals are deliberately NOT
 * quoted here: `cardSizingGuard.test.ts` scans raw source, comments included,
 * for an un-floored viewport clamp — issue #2056.)
 */
const ARBITRARY_VIEWPORT_RE =
    /(?:^|[^\w-])(?:min-)?h-\[(\d+(?:\.\d+)?)(?:d|s|l)?vh\]/g;

/** Every whole-viewport arbitrary-value claim in a source string. */
export function arbitraryViewportClaims(source: string): string[] {
    const found: string[] = [];
    for (const m of source.matchAll(ARBITRARY_VIEWPORT_RE)) {
        if (Number(m[1]) >= 100) found.push(m[0].trim());
    }
    return found;
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
 * `intrinsicHeightPx` is the route's own content demand — what it would be tall
 * enough to need if nothing constrained it.
 *
 * `hasOwnScroller` says whether the route absorbs its own deficit in a nested
 * scroller that spans the WHOLE content column (issue #2275's deckbuilder
 * shape). It cannot be read off the root's `className` — the scroller is a
 * descendant — so it is an explicit input, and it defaults to `false`: a
 * `flex-1 overflow-hidden` root whose inner structure nobody has classified
 * reads as CLIPPING. Fail-closed on purpose. A false red here is loud; the
 * fail-open default is what certified the lobby as correct.
 */
export function deriveHeightClaim(
    className: string,
    intrinsicHeightPx = 0,
    route: { hasOwnScroller?: boolean } = {}
): ShellHeightClaim {
    const claimsViewport =
        hasAnyClass(className, VIEWPORT_HEIGHT_CLASSES) ||
        arbitraryViewportClaims(className).length > 0;
    if (claimsViewport) return { kind: "viewport" };
    if (hasClass(className, "min-h-full"))
        return { kind: "atLeastRemaining", heightPx: intrinsicHeightPx };
    if (hasClass(className, "flex-1")) {
        const scrolls =
            hasAnyClass(className, SCROLLER_CLASSES) ||
            route.hasOwnScroller === true;
        const overflow: RemainderOverflow = scrolls
            ? "scrolls"
            : hasAnyClass(className, CLIPPING_CLASSES)
              ? "clips"
              : "spills";
        return { kind: "remaining", overflow, heightPx: intrinsicHeightPx };
    }
    return { kind: "intrinsic", heightPx: intrinsicHeightPx };
}

/**
 * The route's own intrinsic demand — what it would be tall enough to need if
 * nothing constrained it.
 *
 * A `remaining` claim used to return a flat 0 here, on the premise that such a
 * route always absorbs its own deficit internally (#2275's deckbuilder). That
 * premise is exactly what made the model certify the clipping lobby as
 * correct: only `overflow: "scrolls"` earns it.
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
            return claim.overflow === "scrolls" ? 0 : claim.heightPx;
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

    // `remaining` is a HARD box: `flex: 1 1 0%` gives it exactly what `<main>`
    // has left, and hiding its overflow drops the `min-height: auto` floor
    // (CSS Flexbox §4.5) that would otherwise let it grow. So both `scrolls`
    // and `clips` box out at the remainder — the difference is not the BOX, it
    // is whether the excess is reachable, which `clippedPx` below names.
    // `spills` keeps that floor and grows with its content.
    const contentHeightPx =
        claim.kind === "remaining"
            ? claim.overflow === "spills"
                ? Math.max(mainHeightPx, natural)
                : mainHeightPx
            : claim.kind === "atLeastRemaining"
              ? Math.max(mainHeightPx, natural)
              : natural;

    // Content the route's root HIDES rather than hands to `<main>`. It is not
    // overflow — `<main>.scrollHeight` never sees it, so no scrollbar appears
    // anywhere and the excess is unreachable by any means (issue #2274).
    const clippedPx =
        claim.kind === "remaining" && claim.overflow === "clips"
            ? Math.max(0, natural - mainHeightPx)
            : 0;

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

    // ── bottomReachable, from two INDEPENDENT quantities ────────────────────
    // The previous derivation was `mainMaxScrollTopPx >= mainOverflowPx` with
    // `mainMaxScrollTopPx` DEFINED as `mainScrolls ? mainOverflowPx : 0` —
    // i.e. `x >= x`. Replacing it with the literal `true` left the whole suite
    // green, so the one output carrying issue #2274's acceptance criterion
    // proved nothing. These two quantities share no term:
    //
    //   routeContentBottomPx — where the route's own content ENDS, taken from
    //     its demand, never from `contentHeightPx` (already clipped for a hard
    //     box). A route that scrolls its own excess ends at its own box.
    //   reachableBottomPx — how far down the viewer's window can be pushed once
    //     every scroller in the chain is scrolled to its end.
    const routeContentBottomPx =
        claim.kind === "remaining" && claim.overflow === "scrolls"
            ? mainHeightPx
            : Math.max(mainHeightPx, natural);
    const reachableBottomPx =
        mainHeightPx + mainMaxScrollTopPx + documentMaxScrollTopPx;
    const bottomReachable = routeContentBottomPx <= reachableBottomPx;

    return {
        rootHeightPx,
        headerHeightPx,
        mainHeightPx,
        contentHeightPx,
        mainOverflowPx,
        mainMaxScrollTopPx,
        documentMaxScrollTopPx,
        scrollers,
        clippedPx,
        bottomReachable,
    };
}

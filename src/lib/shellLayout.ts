/**
 * Layout arithmetic for the app shell's scroll contract (issue #2274), widened
 * to the v3 shell's two modes and TWO bands (issue #2582, ADR 0101).
 *
 * The v3 widening in one sentence: the shell no longer has "a header or no
 * header" — it has a TOP band whose height depends on the route's shell mode
 * and the viewport regime (56px Browse bar / 40px landscape-compact bar / 44px
 * Immersive contextual bar / 36px landscape-compact contextual bar (issue
 * #2662) / 0 on the board), and a BOTTOM band that exists
 * only in phone-portrait Browse (the 56px bottom nav plus its safe-area
 * inset). Both are `shrink-0` siblings of `<main>` in the same flex column, so
 * both are subtracted from `<main>` identically — which is precisely why the
 * bottom nav had to enter THIS module rather than be added beside it. See
 * `shellBands`.
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
 *    `visible` gets `min-width/min-height: auto` → 0. A route root is a flex
 *    ITEM of `<main>` with the default `flex-shrink: 1`, so once that floor is
 *    dropped `<main>`'s height CLAMPS it — WHATEVER height it claims — and the
 *    excess is CLIPPED: `<main>.scrollHeight === clientHeight`, its
 *    `overflow-y-auto` never engages, and there is no scrollbar ANYWHERE. That
 *    is the defect this module's `clippedPx` names — see `RouteRootOverflow`.
 *
 *    Browser-measured (issue #2274, round 3; real stylesheet, shell box chain
 *    reproduced, 3212px content, 1440x900): `flex-1 overflow-hidden` and
 *    `min-h-full overflow-hidden` produce the IDENTICAL box — root 788,
 *    `<main>.scrollHeight` 788, `maxScrollTop` 0, footer UNREACHABLE — while
 *    the same roots WITHOUT the clip grow to 3252 and scroll (`maxScrollTop`
 *    2464). The clip is the cause; the height claim is not. That is why
 *    `overflow` is a field of EVERY claim here and not of one variant: the
 *    first attempt at this fix put it on `remaining` alone, and changing the
 *    lobby's claim to `min-h-full` simply moved the same defect into the
 *    neighbouring variant, which had no overflow field to fail on.
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
 * What a route root does with content taller than the box `<main>` gives it.
 *
 * This is the input `resolveShellLayout` originally lacked. Without it a
 * clipping route root is indistinguishable from one that scrolls internally,
 * and the model certifies both as fine.
 *
 * It belongs to EVERY height claim, not to one variant. The `remaining`-only
 * version of this field was measured to be a hole: the route root is a
 * shrinkable flex item, so the clip — not the height claim — decides whether
 * the box is clamped to `<main>` and the excess lost. `min-h-full
 * overflow-hidden` clips exactly as hard as `flex-1 overflow-hidden` (see the
 * measurement in the module header).
 */
export type RouteRootOverflow =
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

/**
 * The FLOOR a route's own root element claims inside `<main>` — how tall the
 * box is before its content is taken into account.
 *
 *  - `viewport` — `h-dvh` / `h-screen` / `min-h-dvh`: a WHOLE viewport, header
 *    or no. A hard, definite height: browser-measured in #2056 to overflow
 *    `<main>` by exactly the header band rather than shrink into it.
 *  - `remaining` — `flex-1`: whatever the shell has left after the header.
 *  - `atLeastRemaining` — `min-h-full`: the same remainder as a FLOOR, so the
 *    box may grow past it when the content is taller.
 *  - `intrinsic` — no claim at all: as tall as its content wants to be.
 *
 * Whether the box actually GROWS past that floor is decided by `overflow` and
 * `shrinks`, not by the kind — see `RouteRootOverflow`.
 */
export type ShellHeightClaimKind =
    | "viewport"
    | "remaining"
    | "atLeastRemaining"
    | "intrinsic";

/**
 * How a route's own root element claims vertical space inside `<main>`.
 *
 * A flat record, deliberately NOT a discriminated union with per-variant
 * fields: every field is required, so a new call site (or a new kind) cannot
 * silently omit one and fail OPEN. That is exactly how the lobby escaped the
 * first version of this model — `overflow` existed only on the `remaining`
 * variant, and re-classifying the same clipping root as `atLeastRemaining`
 * dropped the field on the floor with no type error and no red test.
 */
export interface ShellHeightClaim {
    kind: ShellHeightClaimKind;
    /**
     * What the route's content would need if nothing constrained it. For
     * `viewport` the claim itself is a floor on this: such a root is at least
     * a whole viewport tall whatever it contains.
     */
    heightPx: number;
    /** What happens to content taller than the box `<main>` gives the root. */
    overflow: RouteRootOverflow;
    /**
     * The root is a SHRINKABLE flex item of `<main>` — i.e. it does NOT carry
     * `shrink-0` / `flex-none`. True for every route root in this repo today;
     * a `shrink-0` root is the one shape that genuinely grows with its content
     * even while hiding its overflow (browser-measured: root 3252 vs 788).
     */
    shrinks: boolean;
}

/** The chrome a route is rendered into. */
export interface ShellChrome {
    viewportHeightPx: number;
    /**
     * The TOP band's height: the Browse top bar, or the Immersive contextual
     * bar, plus the return banner when one is showing. 0 when the route owns
     * its chrome (`/game`) or when the phone-portrait Browse layout has moved
     * its navigation to the bottom. Produced by `shellBands`.
     */
    headerBandHeightPx: number;
    /**
     * The BOTTOM band's height — the phone-portrait Browse nav, including its
     * safe-area inset. 0 everywhere else.
     *
     * This field is REQUIRED, not optional-defaulting-to-0, and that is the
     * whole point of issue #2582 touching this module at all: a bottom nav
     * costs `<main>` exactly as much height as a header does, and an optional
     * field would let every existing call site keep certifying a layout that
     * silently lost 56px + the home-indicator inset. Same fail-closed argument
     * `RouteRootOverflow` records for `ShellHeightClaim`.
     */
    bottomBandHeightPx: number;
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
    /** The bottom band (phone Browse nav) is `shrink-0`, so it keeps its
     *  height. `true` when there is no bottom band at all. */
    bottomPinned: boolean;
    /** `<main>` carries `min-h-0`, so it may shrink below its content. */
    mainCanShrink: boolean;
    /** `<main>` carries `overflow-y-auto`, so it is the app-level scroller. */
    mainScrolls: boolean;
}

export interface ShellLayout {
    rootHeightPx: number;
    headerHeightPx: number;
    /** The bottom band's realised height (squeezed only if it is unpinned). */
    bottomHeightPx: number;
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

// ────────────────────────────────────────────────────────────────────────────
// The shell's BANDS (issue #2582, ADR 0101).
//
// Before v3 there was one band and one number: the shared header, measured in
// the browser during issue #2056 at 112px (`AppHeader`'s own ~88px plus the
// shell wrapper's `pt-6`). v3 replaces it with a mode/viewport-dependent pair —
// a top band and a BOTTOM band — because a phone-portrait bottom nav costs
// `<main>` height without being a header at all, and the 112px model has no
// axis for that. Each constant matches a Tailwind height class on the element
// that produces it, named beside it; `design-tokens.test.ts` owns the tokens,
// these own the shell's own boxes.
// ────────────────────────────────────────────────────────────────────────────

/** Browse top bar on desktop/tablet — `AppHeader`'s `h-14`. */
export const SHELL_BROWSE_BAND_PX = 56;

/**
 * Browse top bar on a landscape phone — `AppHeader`'s `short-viewport:h-10`.
 * A landscape phone has 375-430px of height in total (see `useViewportMode`),
 * so the bar is cut rather than supplemented with a bottom nav.
 */
export const SHELL_BROWSE_COMPACT_BAND_PX = 40;

/** Immersive contextual bar (Exit + title + overflow) — `AppContextBar`'s
 *  `min-h-11` (issue #2594: was a fixed `h-11`, now a floor so a real
 *  safe-area inset grows the bar instead of squeezing its content), i.e.
 *  the 44px coarse control height of `--control-h-coarse` as the baseline. */
export const SHELL_CONTEXTUAL_BAND_PX = 44;

/**
 * Immersive contextual bar on a landscape phone (issue #2662) —
 * `AppContextBar`'s `short-viewport:min-h-[calc(2.25rem_+_env(safe-area-inset-top))]`
 * (the inset folded into the floor itself, issue #2662 review round 2). The
 * 44px baseline above is the coarse-POINTER comfort target (ADR 0101 §2), not
 * a viewport rule; on a ~390px-tall landscape phone it alone ate ~11% of the
 * screen before the surface below it drew anything. 36px keeps the bar's own
 * controls at the WCAG 2.2 AA floor (24x24 CSS px, SC 2.5.8) via
 * `--control-h-xs` (28px) with
 * a few px of vertical margin, same pairing as `SHELL_BROWSE_COMPACT_BAND_PX`
 * beside `SHELL_BROWSE_BAND_PX`.
 */
export const SHELL_CONTEXTUAL_COMPACT_BAND_PX = 36;

/**
 * Phone-portrait Browse bottom nav — `AppBottomNav`'s `h-14`, EXCLUDING the
 * safe-area inset, which is a device fact and therefore an input to
 * `shellBands` rather than a constant.
 */
export const SHELL_BOTTOM_NAV_BAND_PX = 56;

/** The global return banner (`AppReturnBanner`) — `h-9`. It sits in the TOP
 *  band in every mode, above `<main>`, so it is added to the header band. */
export const SHELL_RETURN_BANNER_PX = 36;

/** The three layout regimes `useViewportMode` reports, restated here so this
 *  module stays importable from a test that mounts no React at all. */
export type ShellViewportMode = "portrait" | "landscape-compact" | "desktop";

export interface ShellBandInputs {
    mode: "browse" | "immersive";
    /** The route draws its own chrome — the shell contributes no band. */
    ownChrome: boolean;
    viewport: ShellViewportMode;
    /** Whether the global return banner is showing. */
    returnBanner: boolean;
    /** `env(safe-area-inset-bottom)` in px; only the bottom nav pays it. */
    safeAreaBottomPx?: number;
}

/**
 * The heights the shell's own chrome takes from `<main>`, for one route in one
 * viewport regime. This is the ONE place the mode/viewport matrix turns into
 * numbers — `AppShell` renders the bands, this function says what they cost,
 * and every height sweep in the repo asks it rather than a literal.
 */
export function shellBands(inputs: ShellBandInputs): {
    headerBandHeightPx: number;
    bottomBandHeightPx: number;
} {
    if (inputs.ownChrome) {
        // `/game`: no bar, no nav, no banner. `<main>` IS the viewport.
        return { headerBandHeightPx: 0, bottomBandHeightPx: 0 };
    }
    const banner = inputs.returnBanner ? SHELL_RETURN_BANNER_PX : 0;
    if (inputs.mode === "immersive") {
        // Landscape phone (issue #2662) discriminates the same way the Browse
        // branch below already does — by HEIGHT (`landscape-compact`), never
        // a width breakpoint, since a sideways phone is wide but short.
        const contextualBand =
            inputs.viewport === "landscape-compact"
                ? SHELL_CONTEXTUAL_COMPACT_BAND_PX
                : SHELL_CONTEXTUAL_BAND_PX;
        return {
            headerBandHeightPx: contextualBand + banner,
            bottomBandHeightPx: 0,
        };
    }
    switch (inputs.viewport) {
        case "portrait":
            // The destinations move under the thumb; no top bar at all.
            return {
                headerBandHeightPx: banner,
                bottomBandHeightPx:
                    SHELL_BOTTOM_NAV_BAND_PX + (inputs.safeAreaBottomPx ?? 0),
            };
        case "landscape-compact":
            return {
                headerBandHeightPx: SHELL_BROWSE_COMPACT_BAND_PX + banner,
                bottomBandHeightPx: 0,
            };
        case "desktop":
            return {
                headerBandHeightPx: SHELL_BROWSE_BAND_PX + banner,
                bottomBandHeightPx: 0,
            };
    }
}

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
 * Only >= 100% counts. `not-found-page.tsx`'s `min-h-[60dvh]` and
 * `sideboarding-dialog.tsx`'s `h-[min(30rem,60vh)]` are FRACTIONS of the
 * viewport, not claims on the whole of it, and forcing them onto an allowlist
 * would buy a stale entry and no safety.
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
    /** `null` for a route the shell renders no top band for. */
    headerWrapper: string | null;
    main: string;
    /** `null` for a route the shell renders no bottom band for — i.e.
     *  everything except phone-portrait Browse. */
    bottomBand?: string | null;
}): ShellModel {
    const bottomBand = elements.bottomBand ?? null;
    return {
        rootBounded:
            hasClass(elements.root, "h-dvh") ||
            hasClass(elements.root, "h-screen"),
        headerPinned:
            elements.headerWrapper === null ||
            hasClass(elements.headerWrapper, "shrink-0"),
        bottomPinned: bottomBand === null || hasClass(bottomBand, "shrink-0"),
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
    // Read the OVERFLOW and the shrink behaviour first, for every kind: they
    // are properties of the ELEMENT, and reading them per height-claim branch
    // is what let the lobby's clip disappear when its claim changed.
    const scrolls =
        hasAnyClass(className, SCROLLER_CLASSES) ||
        route.hasOwnScroller === true;
    const overflow: RouteRootOverflow = scrolls
        ? "scrolls"
        : hasAnyClass(className, CLIPPING_CLASSES)
          ? "clips"
          : "spills";
    const shrinks =
        !hasClass(className, "shrink-0") && !hasClass(className, "flex-none");
    const base = { heightPx: intrinsicHeightPx, overflow, shrinks };

    const claimsViewport =
        hasAnyClass(className, VIEWPORT_HEIGHT_CLASSES) ||
        arbitraryViewportClaims(className).length > 0;
    if (claimsViewport) return { kind: "viewport", ...base };
    if (hasClass(className, "min-h-full"))
        return { kind: "atLeastRemaining", ...base };
    if (hasClass(className, "flex-1")) return { kind: "remaining", ...base };
    return { kind: "intrinsic", ...base };
}

/**
 * The route's own intrinsic demand — what it would be tall enough to need if
 * nothing constrained it, and therefore what it PUSHES onto `<main>`.
 *
 * A `remaining` claim used to return a flat 0 here, on the premise that such a
 * route always absorbs its own deficit internally (#2275's deckbuilder). That
 * premise is exactly what made the model certify the clipping lobby as
 * correct — and the premise belongs to the OVERFLOW, not to the kind: only
 * `overflow: "scrolls"` earns the 0, whatever height the root claims.
 */
function naturalContentPx(
    claim: ShellHeightClaim,
    chrome: ShellChrome
): number {
    if (claim.overflow === "scrolls") return 0;
    // A whole-viewport root is at least a viewport tall whatever it holds.
    return claim.kind === "viewport"
        ? Math.max(chrome.viewportHeightPx, claim.heightPx)
        : claim.heightPx;
}

/** Resolve the shell's box chain for one route at one viewport height. */
export function resolveShellLayout(
    model: ShellModel,
    chrome: ShellChrome,
    claim: ShellHeightClaim
): ShellLayout {
    const { viewportHeightPx, headerBandHeightPx, bottomBandHeightPx } = chrome;
    const natural = naturalContentPx(claim, chrome);

    // Both bands are siblings of `<main>` in the same flex column, so they cost
    // the same thing: a phone-portrait bottom nav takes 56px + the home
    // indicator's inset off `<main>` exactly as a header takes 56px off it.
    const bandsHeightPx = headerBandHeightPx + bottomBandHeightPx;

    // An unbounded root grows with its content — that is exactly why `flex-1`
    // then resolves against content instead of the viewport (#2056 defect 3).
    const rootHeightPx = model.rootBounded
        ? viewportHeightPx
        : Math.max(viewportHeightPx, bandsHeightPx + natural);

    const availableForMain = Math.max(0, rootHeightPx - bandsHeightPx);
    // Without `min-h-0` a flex item cannot shrink below its content.
    const mainHeightPx = model.mainCanShrink
        ? availableForMain
        : Math.max(availableForMain, natural);

    // A main that refuses to shrink squashes an unpinned band. Each band is
    // charged the WHOLE overshoot rather than a share of it: the model's job
    // here is to make an unpinned band's loss loud, and a proportional split
    // would report a band as "mostly fine" in exactly the configuration
    // `shrink-0` exists to prevent.
    const overshoot = Math.max(0, bandsHeightPx + mainHeightPx - rootHeightPx);
    const headerHeightPx = model.headerPinned
        ? headerBandHeightPx
        : Math.max(0, headerBandHeightPx - overshoot);
    const bottomHeightPx = model.bottomPinned
        ? bottomBandHeightPx
        : Math.max(0, bottomBandHeightPx - overshoot);

    // The floor the root's own height CLAIM puts under its box, before any
    // content is taken into account.
    const claimFloorPx =
        claim.kind === "viewport"
            ? viewportHeightPx
            : claim.kind === "remaining" || claim.kind === "atLeastRemaining"
              ? mainHeightPx
              : 0;
    // What the box would be if `<main>` never clamped it.
    const unclampedHeightPx = Math.max(claimFloorPx, natural);

    // ...and `<main>` DOES clamp it. The route root is a flex ITEM of `<main>`
    // with the default `flex-shrink: 1`, so once its `min-height: auto` floor
    // is dropped — which any non-`visible` overflow does, CSS Flexbox §4.5 —
    // it is squeezed to exactly the remainder WHATEVER height it claimed.
    // Browser-measured: `flex-1 overflow-hidden` and `min-h-full
    // overflow-hidden` give the identical 788px box against a 788px `<main>`
    // (issue #2274, round 3). Two shapes escape the clamp:
    //   - `spills` keeps the `min-height: auto` floor, so the box grows with
    //     its content and the excess reaches `<main>`'s scrollable region;
    //   - `shrink-0` refuses to be squeezed at all (measured: 3252px).
    // A `viewport` claim is a HARD definite height, neither grown by content
    // nor squeezed into the remainder — that is the #2056 shape, measured to
    // overflow `<main>` by exactly the header band.
    const clampedByMain =
        claim.kind !== "viewport" &&
        claim.shrinks &&
        claim.overflow !== "spills";
    const rootBoxPx =
        claim.kind === "viewport"
            ? viewportHeightPx
            : clampedByMain
              ? Math.min(unclampedHeightPx, mainHeightPx)
              : unclampedHeightPx;

    // Only a spilling root hands its excess to `<main>`; anything else is
    // either scrolled inside the route or lost.
    const contentHeightPx =
        claim.overflow === "spills" ? unclampedHeightPx : rootBoxPx;

    // Content the route's root HIDES rather than hands to `<main>`. It is not
    // overflow — `<main>.scrollHeight` never sees it, so no scrollbar appears
    // anywhere and the excess is unreachable by any means (issue #2274).
    const clippedPx =
        claim.overflow === "clips"
            ? Math.max(0, unclampedHeightPx - rootBoxPx)
            : 0;

    const mainOverflowPx = Math.max(0, contentHeightPx - mainHeightPx);
    const mainMaxScrollTopPx = model.mainScrolls ? mainOverflowPx : 0;

    // What the document has to lay out: both bands, `<main>`'s own box, and —
    // only when `<main>` does NOT scroll — the overflow spilling past it.
    const documentContentHeightPx =
        headerHeightPx +
        mainHeightPx +
        bottomHeightPx +
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
    //     its UNCLAMPED demand, never from `contentHeightPx` (already clipped
    //     for a clamped box). A route that scrolls its own excess ends at its
    //     own box. Keyed on the overflow, not the kind: the kind-keyed version
    //     read `min-h-full overflow-hidden` as reaching its bottom.
    //   reachableBottomPx — how far down the viewer's window can be pushed once
    //     every scroller in the chain is scrolled to its end.
    const routeContentBottomPx =
        claim.overflow === "scrolls" ? rootBoxPx : unclampedHeightPx;
    const reachableBottomPx =
        mainHeightPx + mainMaxScrollTopPx + documentMaxScrollTopPx;
    const bottomReachable = routeContentBottomPx <= reachableBottomPx;

    return {
        rootHeightPx,
        headerHeightPx,
        bottomHeightPx,
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

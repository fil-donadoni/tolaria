// The app shell: one place that decides what chrome a route wears (issue
// #2582, ADR 0101 §"AppShell"; was "which routes wear the shared header").
//
// TWO MODES, resolved per route by `resolveShellChrome` (`~/lib/shellChrome`):
//
//   Browse    — desktop/tablet: the 56px `AppHeader`. Landscape phone: the
//               same bar at 40px (its own `short-viewport:` treatment).
//               Portrait phone: NO top bar — the destinations move to
//               `AppBottomNav` under the thumb, with safe-area padding.
//   Immersive — no destinations at all: a 44px `AppContextBar` with an
//               explicit Exit and an overflow. Except on `/game`, which owns
//               its chrome (pause menu, dev rail) and gets no shell band.
//
// Plus one band that crosses both: `AppReturnBanner`, whenever a game or a
// Limited event is running somewhere else.
//
// EVERY band is a `shrink-0` flex sibling of `<main>`, and every one of them
// is modelled in `~/lib/shellLayout` (`shellBands` → `resolveShellLayout`).
// That is not bookkeeping: issues #2056 and #2274 were both a height that no
// module owned, and a bottom nav is the first band this app has ever had that
// costs `<main>` height without being a header. `app-shell-scroll-contract`
// reads these class names off the REAL rendered DOM and runs them through that
// arithmetic, so dropping a `shrink-0` or a `min-h-0` here changes a verdict
// there.
import { Outlet, useRouterState } from "@tanstack/react-router";
import { resolveShellChrome, shellShowsReturnBanner } from "@/lib/shellChrome";
import { useViewportMode } from "~/hooks/useViewportMode";
import { useActiveSession } from "~/hooks/useActiveSession";
import AppHeader from "./app-header";
import AppBottomNav from "./app-bottom-nav";
import AppContextBar from "./app-context-bar";
import AppReturnBanner from "./app-return-banner";

export default function AppShell() {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    });
    const chrome = resolveShellChrome(pathname);
    const viewport = useViewportMode();
    const session = useActiveSession();

    const phonePortrait = viewport === "portrait";
    const showsBottomNav =
        chrome.mode === "browse" && !chrome.ownChrome && phonePortrait;
    const showsTopBar =
        chrome.mode === "browse" && !chrome.ownChrome && !phonePortrait;
    const showsContextBar = chrome.mode === "immersive" && !chrome.ownChrome;
    const showsBanner = shellShowsReturnBanner(pathname, {
        hasGame: session.game !== null,
        eventId: session.event?.eventId ?? null,
    });
    const gameBadge = session.game !== null;
    const limitedBadge = session.event !== null;

    return (
        // Column layout, not "header then page": pages fill the REMAINING
        // height (`flex-1`) instead of each claiming `min-h-dvh`, which would
        // otherwise add the bands' height to every page and leave a permanent
        // stray scrollbar.
        //
        // `h-dvh`, not `min-h-dvh` (issue #2056 defect 3, regression found by
        // browser measurement on the fix/issue-2056 branch: `document.
        // scrollHeight` was 1199 against a 277px viewport — 8x worse than the
        // bug this file was meant to fix). `min-h-dvh` is a MINIMUM, not a
        // bound: an unbounded-height flex container makes `flex-1` resolve
        // against its CONTENT, not the viewport, so `<main>`'s `flex-1
        // min-h-0` had nothing to shrink against and grew to the page's full
        // intrinsic height instead. `h-dvh` gives the chain a hard cap at the
        // root, which is what `min-h-0` further down needs to have any effect
        // at all.
        <div className="flex h-dvh flex-col bg-surface-base text-text">
            {showsTopBar && (
                // No vertical padding at all (it used to be `pt-6`, 24px of
                // the measured 112px band): the band IS the bar's own height,
                // which is what lets `SHELL_BROWSE_BAND_PX` be one number
                // rather than a sum nobody can check.
                <div className="relative z-20 mx-auto w-full max-w-6xl shrink-0 px-4 short-viewport:px-2">
                    <AppHeader
                        gameBadge={gameBadge}
                        limitedBadge={limitedBadge}
                    />
                </div>
            )}
            {showsContextBar && (
                <div className="relative z-20 shrink-0">
                    <AppContextBar
                        title={chrome.title}
                        exitTo={chrome.exitTo}
                    />
                </div>
            )}
            {showsBanner && (
                <div className="relative z-20 shrink-0">
                    <AppReturnBanner session={session} />
                </div>
            )}
            {/* `min-h-0` (issue #2056 defect 3): without it this flex item
                defaults to `min-height: auto`, which refuses to shrink below
                its content's natural size — so a page rendering more than
                the remaining viewport height (e.g. the deckbuilder's own
                `h-dvh` before this fix) grows `<main>` past the leftover
                space instead of being clipped/scrolled internally.
                `overflow-y-auto`: now that the root is a hard bound, `<main>`
                is the ONE place ordinary long pages (the lobby's deck lists,
                `/limited` events, admin surfaces — none of which have their
                own internal scroller) scroll. Nothing in the app scrolls the
                document/`window`, and every existing `position: sticky`
                header already lives inside its OWN nested `overflow-y-auto`
                panel (deck-builder's `ResultsGrid`, `cards-pile`), not the
                document — a fact `shell-height-claims.guard` now enforces
                repo-wide rather than asserting in prose. The deckbuilder
                route surfaces still claim `flex-1 min-h-0` and manage their
                own internal scrollers so they fit exactly inside `<main>`
                without ever needing this fallback scrollbar — it only engages
                if something upstream miscalculates, containing the overflow
                to `<main>` instead of blowing out the whole document again. */}
            <main className="flex flex-1 min-h-0 flex-col overflow-y-auto">
                <Outlet />
            </main>
            {showsBottomNav && (
                // Wrapped, like every other band: the `shrink-0` that keeps a
                // band out of the flex squeeze lives on the SHELL's element,
                // never inside the component, so `deriveShellModel` can read
                // all four bands off the same kind of node and
                // `app-shell-scroll-contract` can mock the component without
                // mocking away the contract.
                <div className="relative z-20 shrink-0">
                    <AppBottomNav
                        gameBadge={gameBadge}
                        limitedBadge={limitedBadge}
                    />
                </div>
            )}
        </div>
    );
}

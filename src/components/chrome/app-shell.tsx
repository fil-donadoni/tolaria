// The app shell: one place that decides which routes wear the shared header.
// Before this, the header (`DashboardTopBar`) was mounted by `lobby.tsx`, so
// every other section — the whole `/limited` flow, the deck builder, the
// developer surfaces — rendered with no wordmark, no way back home, and no
// sign-out. Mounting it here makes "has chrome" the default and "fullscreen"
// the explicit exception.
//
// `/game` is that exception: the board is a fullscreen play surface with its
// own chrome (pause menu, dev rail) and a header would take ~5rem of vertical
// space from the battlefield while duplicating an exit the pause menu already
// offers.
import { Outlet, useRouterState } from "@tanstack/react-router";
import { shellShowsHeader } from "@/lib/shellChrome";
import AppHeader from "./app-header";

export default function AppShell() {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    });

    return (
        // Column layout, not "header then page": pages fill the REMAINING
        // height (`flex-1`) instead of each claiming `min-h-dvh`, which would
        // otherwise add the header's height to every page and leave a
        // permanent stray scrollbar.
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
            {shellShowsHeader(pathname) && (
                // `short-viewport:pt-0` (issue #2056 defect 3 amplification,
                // measured 852x277 with the coordinator's browser pass): this
                // wrapper's `pt-6` plus `AppHeader`'s own ~88px band measured
                // 112px — 40% of a 277px viewport, and nothing in the
                // original short-viewport treatment touched it since it
                // lives OUTSIDE `<main>`. Dropping the top padding here is
                // the first of several cuts (see `app-header.tsx`,
                // `app-header-profile.tsx`) that bring the whole band to
                // ~40px. Media-query-gated, so a tall viewport is completely
                // unaffected.
                <div className="relative z-20 mx-auto w-full max-w-6xl shrink-0 px-6 pt-6 short-viewport:pt-0">
                    <AppHeader />
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
                document/`window` (grepped for `window.scroll`/`scrollTo`/
                `IntersectionObserver` — none found), and every existing
                `position: sticky` header already lives inside its OWN nested
                `overflow-y-auto` panel (deck-builder's `ResultsGrid`,
                `cards-pile`), not the document, so moving the scroll
                container from `document` to `<main>` changes nothing for
                them. The deckbuilder route surfaces (`pool-deck-builder-
                form.tsx`, `deck-builder.tsx`) still claim `flex-1 min-h-0`
                and manage their own internal scrollers so they fit exactly
                inside `<main>` without ever needing this fallback scrollbar —
                it only engages if something upstream miscalculates, containing
                the overflow to `<main>` instead of blowing out the whole
                document again. */}
            <main className="flex flex-1 min-h-0 flex-col overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}

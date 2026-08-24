import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { useViewportMode } from "~/hooks/useViewportMode";

/** Tablet-portrait-and-wider (issue #2671): the complement of
 *  `useViewportMode`'s own `PORTRAIT_QUERY` (`orientation: portrait` AND
 *  `max-width: 767px`) — same orientation, the width band that hook's
 *  three-bucket split calls `"desktop"`.
 *
 *  Why a SEPARATE predicate rather than widening `useViewportMode()` itself:
 *  that hook is the app's one seam for the GAMEPLAY layout switch (portrait
 *  column / landscape strip / full split, `useViewportMode.ts` docstring) —
 *  changing its width band moves every one of those consumers, most of which
 *  have nothing to do with this toolbar. The deckbuilder's own
 *  `deck-source-dock` custom-variant (`index.css`) already sets the
 *  precedent for a second, narrower-purpose width/orientation predicate that
 *  deliberately does NOT reuse `useViewportMode()`'s bucket, for the same
 *  reason: `orientation: landscape` there, `orientation: portrait` here.
 *
 *  Why orientation, not a raw width cutoff: this deckbuilder's zones pane
 *  only gets the dock's full-column HEIGHT in landscape
 *  (`deck-source-dock`, `orientation: landscape`) — in portrait the source
 *  panel, basics bar and legality strip all stay inline, so the pane's own
 *  height budget is much smaller regardless of how wide the portrait screen
 *  is. Measured live (CDP `getBoundingClientRect()`, `/decks/create`,
 *  Freeform, a real non-empty Sideboard):
 *
 *  | viewport   | orientation | Sideboard pane H | header (unfolded) | port w/ header |
 *  | ---------- | ----------- | ----------------- | ------------------ | -------------- |
 *  | 820×1180   | portrait    | 385.5px            | 203px               | ~183px — BELOW the ~196px `--card-h` tile (`starved`) |
 *  | 1180×820   | landscape   | 551.5px            | 203px               | 300.5px — clears the tile |
 *  | 1440×900   | landscape   | 640.5px            | 191px               | 401.5px — clears the tile |
 *
 *  The unfolded header wraps to roughly the SAME ~200px at every one of
 *  these (the cluster's own unwrapped natural width is ~766px, far past any
 *  of these panes' 199–266px box, `docs/findings/2585-*` addendum) — what
 *  changes is the height budget it is subtracted from. Landscape's dock
 *  gives that budget enough headroom to absorb a ~200px header and still
 *  clear the tile; portrait's does not, at ANY width `useViewportMode()`
 *  still calls `"desktop"` — there is no landscape-only "narrow enough to
 *  need it" story to encode, so this has no upper width bound of its own
 *  (`useViewportMode`'s `PORTRAIT_QUERY` already owns 0–767px). */
export const TABLET_PORTRAIT_QUERY =
    "(orientation: portrait) and (min-width: 768px)";

function subscribeTabletPortrait(onStoreChange: () => void): () => void {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(TABLET_PORTRAIT_QUERY);
    mql.addEventListener("change", onStoreChange);
    return () => mql.removeEventListener("change", onStoreChange);
}

function getTabletPortraitSnapshot(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(TABLET_PORTRAIT_QUERY).matches;
}

function getTabletPortraitServerSnapshot(): boolean {
    return false;
}

/** `useSyncExternalStore` for the same reasons `useViewportMode`/
 *  `useSurfaceClass` use it: a tear-free read during render, resynced on
 *  subscribe. */
function useIsTabletPortrait(): boolean {
    return useSyncExternalStore(
        subscribeTabletPortrait,
        getTabletPortraitSnapshot,
        getTabletPortraitServerSnapshot
    );
}

export interface CompactChromeDisclosureProps {
    /** Toggle label — names the band that is folded away, so the control reads
     *  as "the filters are still here" rather than as a mystery chevron. */
    label: string;
    /** The chrome band itself. Rendered UNCHANGED (no wrapper element) on a
     *  desktop-shaped viewport. */
    children: ReactNode;
    /** Gates the whole viewport check — `false` forces the verbatim (desktop)
     *  render at EVERY viewport, never folding (issue #2515: the Limited
     *  event chrome collapses only while a seat is actively drafting, never
     *  when the event isn't — pairings/standings/Close Event are the page
     *  then, even on a compact viewport). Default `true` keeps every existing
     *  caller's `useViewportMode() !== "desktop" || useIsTabletPortrait()`
     *  behaviour (issue #2671). */
    active?: boolean;
}

/**
 * Folds one band of deckbuilder chrome behind a toggle on a phone-shaped
 * viewport (issue #2511).
 *
 * The deckbuilder's card zones are `flex-1` children of a fixed-height column
 * that also carries the header band, the ADD BASIC bar, the per-zone control
 * rows, the legality panel and the save bar. On a desktop that column has room
 * to spare; on a phone the bands alone exceed the viewport, and because
 * nothing floors a zone at one card tall the zones absorbed the entire
 * shortfall (measured 24px around 158px card tiles). The rule the fix encodes:
 * **the chrome gives way, never the card list.**
 *
 * Two deliberate properties:
 *
 *  - **Desktop renders `children` verbatim** — no toggle, no wrapper element,
 *    no extra DOM node. The desktop split, the header band's wrapping and the
 *    `--split-main` column behaviour are untouched by construction, not by a
 *    breakpoint that happens not to match.
 *  - **The folded band is UNMOUNTED, not `display: none`.** A CSS-hidden band
 *    leaves its buttons in the document at zero size — dead weight the browser
 *    probe counts and a reader cannot see. Unmounting also means the folded
 *    controls hold no tab stops.
 *
 * The core predicate is `useViewportMode()` (the app's single layout seam,
 * #335/#1763), whose non-`desktop` modes are mirrored in CSS as the
 * `compact-chrome:` variant (`src/index.css`) for the layout half of the same
 * fix. Changing one without the other desynchronises them — see the note there.
 *
 * **OR'd with `useIsTabletPortrait()` above (issue #2671).** That hook's
 * `"desktop"` bucket includes tablet-portrait widths the deckbuilder's own
 * source-panel dock never reaches (dock is landscape-only), so a fold gated
 * on it ALONE never engaged at 820×1180 and the trailing cluster wrapped the
 * header to 203px, starving the Sideboard's card port to ~183px — below one
 * card tile. `TABLET_PORTRAIT_QUERY` is deliberately NOT mirrored into the
 * `compact-chrome:` CSS variant: that variant's one consumer in this surface
 * (`deck-zone-surface.tsx`'s card-port floor) exists to protect the port
 * from a header this component has ALREADY folded down to one line — once
 * folding engages there is nothing left for the floor to guard.
 */
export default function CompactChromeDisclosure({
    label,
    children,
    active = true,
}: CompactChromeDisclosureProps) {
    // Hooks called unconditionally regardless of `active` (Rules of Hooks) —
    // only the DERIVED `compact` boolean is gated.
    const viewportMode = useViewportMode();
    const tabletPortrait = useIsTabletPortrait();
    const compact = active && (viewportMode !== "desktop" || tabletPortrait);
    const [open, setOpen] = useState(false);

    if (!compact) return <>{children}</>;

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                {label} {open ? "▴" : "▾"}
            </Button>
            {open && children}
        </>
    );
}

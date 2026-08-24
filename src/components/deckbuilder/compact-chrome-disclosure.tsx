import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { useViewportMode } from "~/hooks/useViewportMode";

/** Tablet-portrait, height-bounded (issue #2671, review M2). The complement
 *  of `useViewportMode`'s own `PORTRAIT_QUERY` (`orientation: portrait` AND
 *  `max-width: 767px`) on the WIDTH axis — same orientation, the width band
 *  that hook's three-bucket split calls `"desktop"` — but, unlike the first
 *  cut of this fix, bounded on the HEIGHT axis too.
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
 *  **The height bound (review M2).** The first cut of this predicate had no
 *  upper height bound, on the theory that portrait's `deck-source-dock`
 *  never applies (that variant is `orientation: landscape` only), so the
 *  Sideboard pane's height budget "stays tight at ANY portrait width" —
 *  which conflated WIDTH-independence (true: `CARD_BASE`'s width term,
 *  `18vw`, is never the binding minimum once width ≥ 768px, so the fold
 *  needn't ever vary by width) with HEIGHT-independence (false: the pane is
 *  an equal `flex-1` sibling of the source panel down the SAME free column
 *  `deck-source-dock` describes, so its height scales linearly with viewport
 *  height — a taller portrait screen genuinely has more room, and portrait
 *  only guarantees height ≥ width, never a SHORT height). Measured live (CDP
 *  `getBoundingClientRect()`, `/decks/create`, Freeform, a real non-empty
 *  Sideboard, width held at 820/768 — width doesn't move these numbers, per
 *  the paragraph above):
 *
 *  | height | Sideboard pane H | header (unfolded) | port w/ header | `--card-h` tile | starved? |
 *  | ------ | ----------------- | ------------------ | --------------- | ----------------- | -------- |
 *  | 1180   | 385.5px            | 203px               | ~183px           | ~196px             | YES      |
 *  | 1250   | ~420.5px           | 203px               | ~218px           | ~208px             | no (~10px margin) |
 *  | 1400   | ~495.5px           | 203px               | ~293px           | 224px (capped)     | no (~69px margin) |
 *  | 2560   | 1139px             | 34px (already folded) | 1105px        | ~224px             | no (~4x the room)  |
 *
 *  Pane height is linear in viewport height in this band (slope 0.5 — the
 *  equal-`flex-1`-sibling split), and `--card-h` itself is height-driven
 *  (`9.5dvh` is the binding term of `CARD_BASE`'s `min()` below its 8rem cap
 *  at height ≈1347px) — solving `port(H) = tile(H)` for the two linear
 *  pieces puts the crossover at H≈1219px. `max-height: 1300px` below keeps
 *  ~80px of margin PAST that crossover (folds a little longer than strictly
 *  required, never less), while excluding the 2560-tall case above and
 *  every taller portrait screen, where folding bought nothing but was
 *  applied anyway. Below `min-width: 768px` `useViewportMode`'s own
 *  `PORTRAIT_QUERY` already folds via the OTHER branch of `compact` — this
 *  query's job is only the band that hook still calls `"desktop"`. */
export const TABLET_PORTRAIT_QUERY =
    "(orientation: portrait) and (min-width: 768px) and (max-height: 1300px)";

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

/** The exact fold predicate `CompactChromeDisclosure` uses internally,
 *  exported so a STATIC sibling element (one that isn't itself wrapped by
 *  the disclosure) can hide in lockstep instead of via a separate CSS
 *  variant — issue #2671 review M1: `pool-basic-lands-bar.tsx`'s "Add Basic"
 *  label used `compact-chrome:hidden`, a variant that never widened to cover
 *  `useIsTabletPortrait()`, so at 820x1180 the label kept rendering right
 *  next to the disclosure's own now-folded "Add Basic ▾" toggle — the same
 *  JS-unmount-vs-CSS-hide desync `index.css`'s `compact-chrome:` comment
 *  warns about, just with the mismatch running the other direction (CSS
 *  variant narrower than the JS predicate rather than wider). Reading this
 *  hook directly, rather than adding a second CSS variant to keep in sync by
 *  hand, makes the two impossible to desync — there is only one predicate. */
export function useCompactChromeFold(active = true): boolean {
    const viewportMode = useViewportMode();
    const tabletPortrait = useIsTabletPortrait();
    return active && (viewportMode !== "desktop" || tabletPortrait);
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
    const compact = useCompactChromeFold(active);
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

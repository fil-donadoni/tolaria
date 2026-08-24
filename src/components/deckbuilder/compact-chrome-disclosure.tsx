import { useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { useCompactChromeFold } from "./useCompactChromeFold";

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
 * **OR'd with `useIsTabletPortrait()` (issue #2671, `useCompactChromeFold`
 * in `./useCompactChromeFold`).** That hook's
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

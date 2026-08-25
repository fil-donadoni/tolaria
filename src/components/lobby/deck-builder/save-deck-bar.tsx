import type { ReactNode } from "react";
import type { Reason } from "@convex/formats";
import { Button } from "~/components/ui/button";
import DeckLegalityChip from "./deck-legality-chip";

interface SaveDeckBarProps {
    name: string;
    onChangeName: (name: string) => void;
    onDone: () => void;
    onDelete?: () => void;
    cardCount: number;
    /** Issue #2056 defect 3 amplification: a caller whose OWN header band
     *  hides itself under `short-viewport:` (e.g. `PoolDeckBuilderForm`'s
     *  "← Back to Event") passes this to fold that affordance into
     *  `SaveDeckBar`'s single row instead of losing it. Rendered ONLY under
     *  `short-viewport:` (`hidden short-viewport:inline-flex`) — at a normal
     *  viewport it stays invisible so the caller's own always-visible header
     *  button is the only one on screen. Omit for a caller (the catalogue
     *  `DeckBuilder`) whose header stays put at every height. */
    onBack?: () => void;
    backLabel?: string;
    /** Issue #2056 defect 3 amplification: same short-viewport-only
     *  treatment as `onBack`, folding a caller's standalone
     *  `DeckLegalityPanel` band into a compact `DeckLegalityChip` here. */
    legality?: { formatLabel: string; isLegal: boolean; reasons: Reason[] };
    /** Issue #1631 fixup: same short-viewport-only treatment as `onBack` /
     *  `legality` — the compact twin of a `DeckBuilderHeader`
     *  `foldableActions` control (e.g. the Limited pool builder's Stats
     *  button), rendered here so it survives the header band hiding. Omitted
     *  by a caller with no such control. */
    foldableActions?: ReactNode;
    /** Issue #2584: the deck-level "★ Featured" picker
     *  (`deck-featured-select.tsx`). It rides in THIS row — not on a card —
     *  because Featured is deck metadata, exactly like the name beside it, and
     *  because the per-card overlay button that used to set it is one of the
     *  overlays this slice removed. Rendered unconditionally (not folded
     *  behind `short-viewport:`): a mouse has no other path to it. */
    featured?: ReactNode;
}

export default function SaveDeckBar({
    name,
    onChangeName,
    onDone,
    onDelete,
    cardCount,
    onBack,
    backLabel = "← Back",
    legality,
    foldableActions,
    featured,
}: SaveDeckBarProps) {
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onDone();
            }}
            // `deck-source-dock:py-2` (issue #2670, same lever
            // `DeckBuilderHeader` already uses, `deck-builder-header.tsx`):
            // growing `DeckFeaturedSelect` to the 44px coarse-pointer rung
            // (`deck-featured-select.tsx`) costs this row ~4px of the
            // deck pane's `flex-1` share at 1180x820 with a search active —
            // enough to drop #2585's own ≥60% floor (measured 60.18% ->
            // 59.70% without this trim). Trimming this band's own padding by
            // 8px in the SAME `deck-source-dock:` context reclaims more
            // than that 4px back, net positive (measured 60.18% -> 60.67%
            // with both changes). Left at `py-3` everywhere else — this row
            // never renders in portrait, and outside `deck-source-dock:` the
            // deck pane has real margin over the floor (66-71% idle).
            // `deck-source-dock:` is landscape + min-width:1024px +
            // min-height:501px, so this trim also applies at 1440x900x2,
            // not only 1180x820x2 — harmless there (that cell PASSes with
            // unchanged ceilings, it only adds pane height).
            className="flex flex-wrap items-center gap-2 border-t border-border-subtle/30 bg-surface/60 px-4 py-3 deck-source-dock:py-2 short-viewport:py-1 md:gap-3 md:px-6"
        >
            {onBack && (
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={onBack}
                    className="hidden short-viewport:inline-flex"
                >
                    {backLabel}
                </Button>
            )}
            {legality && (
                <span className="hidden short-viewport:inline-flex">
                    <DeckLegalityChip {...legality} />
                </span>
            )}
            {foldableActions && (
                <span className="hidden short-viewport:inline-flex">
                    {foldableActions}
                </span>
            )}
            <span className="text-label">{cardCount} cards</span>
            {featured}
            <input
                type="text"
                value={name}
                onChange={(e) => onChangeName(e.target.value)}
                placeholder="Deck name"
                className="input-field min-w-0 flex-1 basis-40 px-3 short-viewport:py-1 short-viewport:text-xs md:max-w-md"
            />
            {/* `/85`, not `/70` (issue #2593): at 10px on `--color-surface-base`
                the 70% mix resolves to #927637, which axe measures at 4.43:1 —
                just under the 4.5:1 WCAG 1.4.3 floor, and the single
                `color-contrast` serious that held the deck-builder budget above
                zero at desktop and both tablet viewports. 85% measures 6.04:1
                and is visually indistinguishable at this size. */}
            <span className="text-label text-accent/85 hidden md:inline short-viewport:hidden">
                Auto-saved
            </span>
            <div className="flex items-center gap-2 ml-auto">
                {onDelete && (
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={onDelete}
                        className="md:px-4 md:py-2 md:text-sm short-viewport:px-2 short-viewport:py-1 short-viewport:text-xs"
                    >
                        Delete
                    </Button>
                )}
                <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    className="md:px-4 md:py-2 md:text-sm short-viewport:px-2 short-viewport:py-1 short-viewport:text-xs"
                >
                    Done
                </Button>
            </div>
        </form>
    );
}

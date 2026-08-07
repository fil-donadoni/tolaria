import { useState } from "react";
import { Button } from "~/components/ui/button";
import type { ZoneCard } from "~/types/game";
import DeckStatsDialog from "./deck-stats-dialog";

export interface DeckStatsButtonProps {
    /** The Maindeck only — see `DeckStatsDialog`. */
    mainCards: ZoneCard[];
    /** Extra classes merged onto the button (`cn`, so a `short-viewport:`
     *  override wins over the base `size="sm"` padding). Issue #1631 fixup
     *  R-F6: the `SaveDeckBar` twin passes a `short-viewport:` compaction
     *  here so it matches the row's other controls (Delete/Done) instead of
     *  being the row's tallest item. Omitted by the header copy, which keeps
     *  its normal size at every height. */
    className?: string;
}

/**
 * The toolbar's Stats affordance (PRD #1617 § "Stats dialog", issue #1631):
 * a header action that opens `DeckStatsDialog` on demand. Statistics never
 * take permanent space away from the cards — this button is the ONLY
 * always-present footprint; the dialog itself renders nothing until opened.
 *
 * One component per file (project rule): the button owns the open/close
 * state and mounts the dialog, but the dialog's content lives in its own
 * file. A deckbuilder wrapper only ever renders `<DeckStatsButton
 * mainCards={...} />` in its `headerActions` (or, for a builder whose header
 * band hides itself under `short-viewport:`, `headerFoldableActions` PLUS a
 * compact twin — `className` set to a `short-viewport:` override — on
 * `saveBar.foldableActions` — issue #1631 fixup) — never the dialog inline.
 */
export default function DeckStatsButton({
    mainCards,
    className,
}: DeckStatsButtonProps) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className={className}
                onClick={() => setOpen(true)}
            >
                Stats
            </Button>
            <DeckStatsDialog
                open={open}
                onOpenChange={setOpen}
                mainCards={mainCards}
            />
        </>
    );
}

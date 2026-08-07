import { useState } from "react";
import { Button } from "~/components/ui/button";
import type { ZoneCard } from "~/types/game";
import DeckStatsDialog from "./deck-stats-dialog";

export interface DeckStatsButtonProps {
    /** The Maindeck only — see `DeckStatsDialog`. */
    mainCards: ZoneCard[];
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
 * band hides itself under `short-viewport:`, `headerFoldableActions` PLUS the
 * compact twin on `saveBar.foldableActions` — issue #1631 fixup) — never the
 * dialog inline.
 */
export default function DeckStatsButton({ mainCards }: DeckStatsButtonProps) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="sm"
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

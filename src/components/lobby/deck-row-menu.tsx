import { useState } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";
import { Button } from "~/components/ui/button";

interface DeckRowMenuProps {
    /** For the trigger's accessible name only. */
    deckName: string;
    /** Open the deck's detail page. Optional: the v3 deck ROW carried the
     *  row-wide open gesture itself, so it passes nothing here. A v4 Deck
     *  Shelf tile spends its own click on SELECTING the deck (that is what
     *  swaps the Loadout and the ambient), so "open" has to live somewhere —
     *  here (issue #2726). */
    onOpen?: () => void;
    /** Edit the deck in the builder. Optional for the same reason: the deck
     *  row keeps Edit as an always-visible single tap beside this menu, and
     *  the Loadout keeps it for the SELECTED deck; a shelf tile has no room
     *  for a second visible control and routes it through here. */
    onEdit?: () => void;
    /** Optional for the same reason `onEdit` is: a viewer without the right to
     *  delete (a non-admin over a Preset shelf) gets a menu WITHOUT the item,
     *  never one carrying a dead row. */
    onDelete?: () => void;
}

/**
 * The deck overflow menu (PRD #2405 D15 / ADR 0101 §9, issue #2591; widened
 * for Deck Shelf tiles by issue #2726): the infrequent and destructive deck
 * actions behind a "⋯" trigger, so a deck reads as art/name at a glance
 * instead of a row of buttons.
 *
 * Same Popover primitive and click-isolation shape as `DeckCardMoveMenu`
 * (`src/components/deckbuilder/deck-card-move-menu.tsx`): the surface
 * underneath is itself clickable, so both the trigger and the menu content
 * stop propagation.
 */
export default function DeckRowMenu({
    deckName,
    onOpen,
    onEdit,
    onDelete,
}: DeckRowMenuProps) {
    const [open, setOpen] = useState(false);

    const run = (fn: () => void) => () => {
        setOpen(false);
        fn();
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={<Button variant="ghost" size="icon-sm" />}
                onClick={(e) => e.stopPropagation()}
                aria-label={`More actions for ${deckName}`}
                title="More actions"
            >
                <span aria-hidden>⋯</span>
            </PopoverTrigger>
            <PopoverContent
                className="w-36 p-1"
                align="end"
                side="bottom"
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    role="menu"
                    aria-label={`More actions for ${deckName}`}
                    className="flex flex-col gap-0.5"
                >
                    {onOpen && (
                        <Button
                            variant="ghost"
                            size="sm"
                            role="menuitem"
                            onClick={run(onOpen)}
                            className="w-full justify-start"
                        >
                            Open
                        </Button>
                    )}
                    {onEdit && (
                        <Button
                            variant="ghost"
                            size="sm"
                            role="menuitem"
                            onClick={run(onEdit)}
                            className="w-full justify-start"
                        >
                            Edit
                        </Button>
                    )}
                    {onDelete && (
                        <Button
                            variant="destructive"
                            size="sm"
                            role="menuitem"
                            onClick={run(onDelete)}
                            className="w-full justify-start"
                        >
                            Delete
                        </Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

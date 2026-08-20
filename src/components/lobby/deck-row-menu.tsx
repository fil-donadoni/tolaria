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
    onDelete: () => void;
}

/**
 * The deck-row overflow menu (PRD #2405 D15 / ADR 0101 §9, issue #2591):
 * compact deck rows keep only Delete behind a "⋯" trigger, so a row reads as
 * name/format/pips/legality/small art at a glance instead of two full-width
 * buttons. Edit stays an always-visible action beside this menu (still a
 * single tap, and far more frequent than Delete) — only the destructive,
 * infrequent action moves behind the overflow. Same Popover primitive and
 * click-isolation shape as `DeckCardMoveMenu`
 * (`src/components/deckbuilder/deck-card-move-menu.tsx`): the row underneath
 * is itself clickable (`onFocus`), so both the trigger and the menu content
 * stop propagation.
 */
export default function DeckRowMenu({ deckName, onDelete }: DeckRowMenuProps) {
    const [open, setOpen] = useState(false);

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
                className="w-32 p-1"
                align="end"
                side="bottom"
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    role="menu"
                    aria-label={`More actions for ${deckName}`}
                    className="flex flex-col gap-0.5"
                >
                    <Button
                        variant="destructive"
                        size="sm"
                        role="menuitem"
                        onClick={() => {
                            setOpen(false);
                            onDelete();
                        }}
                        className="w-full justify-start"
                    >
                        Delete
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

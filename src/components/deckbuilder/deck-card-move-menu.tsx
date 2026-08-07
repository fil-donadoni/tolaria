import { useState } from "react";
import type { ColumnId } from "@convex/deckLayout";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";

/** One Column offered by the menu — the exact `id`/`label` pair the surface
 *  itself renders that Column with (`DeckZoneSurface`'s `moveMenuColumns`). */
export interface DeckCardMoveMenuColumn {
    id: ColumnId;
    label: string;
}

export interface DeckCardMoveMenuProps {
    /** For the trigger's accessible name/tooltip only. */
    cardName: string;
    /** The Zone's resolved Columns, in render order — generated, then manual,
     *  then the Catch-All (`resolveColumnLayout`, `convex/deckLayout.ts`).
     *  Never hand-filtered by this component: the menu must offer exactly what
     *  the surface renders, no more and no less (issue #1633 AC). */
    columns: readonly DeckCardMoveMenuColumn[];
    /** A Column was picked — the caller pins the card into it. */
    onSelect: (columnId: ColumnId) => void;
}

/**
 * "Move to…" affordance on a Maindeck card tile (issue #1633, PRD #1617
 * story 51): the touch-friendly analogue of dragging a card into a specific
 * Column. A precise drop into a narrow, snap-scrolling Column is not a
 * realistic touch gesture, so this offers the SAME outcome — a Card Pin —
 * through a pick-a-column list instead. The caller wires {@link
 * DeckCardMoveMenuProps.onSelect} straight to the SAME `onPin(cardId,
 * columnId, pinKey)` seam a drag resolves to (`deckZoneDrag.ts`'s
 * `DeckZoneDragHandlers.onPin`) — so a drag and a menu pick can never
 * diverge in what they do to the deck.
 *
 * A small always-visible overlay button (parity with `FeaturedCardButton`),
 * not a right-click/long-press menu: both of those gestures are reserved
 * app-wide for the card preview (`~/components/ui/context-menu.tsx`'s own
 * doc comment), and — the whole point — this needs to work on a plain tap,
 * with no hover state required to reveal it, since touch is exactly the
 * input this exists for.
 */
export default function DeckCardMoveMenu({
    cardName,
    columns,
    onSelect,
}: DeckCardMoveMenuProps) {
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                type="button"
                // The tile underneath is click-to-remove/move-zone (its own
                // `onClick`); this button must never bubble into that.
                onClick={(e) => e.stopPropagation()}
                aria-label={`Move ${cardName} to…`}
                title={`Move ${cardName} to…`}
                className="absolute right-1 bottom-1 z-10 flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-accent/70 bg-surface-base/80 text-[0.625rem] font-semibold text-text-muted shadow-sm transition hover:text-accent"
            >
                ⠿
            </PopoverTrigger>
            <PopoverContent
                className="w-48 p-1"
                align="end"
                side="top"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-1 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Move {cardName} to…
                </div>
                <div
                    role="menu"
                    aria-label={`Move ${cardName} to…`}
                    className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
                >
                    {columns.map((column) => (
                        <button
                            key={column.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                onSelect(column.id);
                                setOpen(false);
                            }}
                            className="rounded-md px-1.5 py-1 text-left text-xs text-text hover:bg-accent hover:text-accent-foreground"
                        >
                            {column.label}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

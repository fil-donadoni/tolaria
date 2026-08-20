import { useDraggable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { activateTileOnKey } from "~/lib/card-tile-keyboard";
import type { CardDragData } from "./dnd-types";

interface DraggableCardProps {
    id: string;
    data: CardDragData;
    /** Fired on a plain click (no drag) — quick-add or remove. dnd-kit only
     *  emits the click when the pointer stayed under the activation threshold,
     *  so a real drag never also clicks. */
    onClick?: () => void;
    title?: string;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

/** A card that is both draggable and clickable. The element itself is the drag
 *  source AND the click target — no nested interactive element, which would
 *  swallow the drag activation. */
export default function DraggableCard({
    id,
    data,
    onClick,
    title,
    className,
    style,
    children,
}: DraggableCardProps) {
    const { ref, isDragging } = useDraggable({ id, data });
    return (
        <div
            ref={ref}
            role="button"
            tabIndex={0}
            title={title}
            style={style}
            onClick={onClick}
            // The same ARIA-role-with-no-keyboard gap `DeckCardTile` carried
            // (issue #2593): `role="button" tabIndex={0}` promises an
            // activation, so Enter and Space have to deliver one. Shared
            // helper, not a second copy — this tile and the deckbuilder's must
            // not drift on what counts as an activation.
            onKeyDown={(e) => {
                if (onClick) activateTileOnKey(e, onClick);
            }}
            className={cn(
                // No `outline-none`: this is a tab stop, and the global
                // `:focus-visible` outline (src/index.css) is what shows a
                // keyboard user where they are.
                "cursor-grab touch-none select-none transition",
                isDragging ? "opacity-30" : "",
                className
            )}
        >
            {children}
        </div>
    );
}

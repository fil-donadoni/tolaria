import { useDraggable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
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
            className={cn(
                "cursor-grab touch-none select-none outline-none transition",
                isDragging ? "opacity-30" : "",
                className
            )}
        >
            {children}
        </div>
    );
}

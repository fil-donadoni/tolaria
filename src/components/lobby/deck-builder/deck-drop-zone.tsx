import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import type { DropZoneId } from "./dnd-types";

interface DeckDropZoneProps {
    id: DropZoneId;
    className?: string;
    children: React.ReactNode;
}

/** A zone (Maindeck / Sideboard) that accepts dropped cards. Highlights while a
 *  card hovers over it. */
export default function DeckDropZone({
    id,
    className,
    children,
}: DeckDropZoneProps) {
    const { ref, isDropTarget } = useDroppable({ id });
    return (
        <div
            ref={ref}
            className={cn(
                "transition",
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : "",
                className
            )}
        >
            {children}
        </div>
    );
}

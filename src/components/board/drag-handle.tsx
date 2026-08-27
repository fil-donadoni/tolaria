import type { DragHandlers } from "~/hooks/useDraggable";

type DragHandleProps = {
    label?: string;
    handlers: DragHandlers;
    className?: string;
};

export default function DragHandle({
    label,
    handlers,
    className = "",
}: DragHandleProps) {
    return (
        <div
            {...handlers}
            className={`flex items-center gap-2 px-3 py-1.5 cursor-move select-none border-b border-border-subtle hover:bg-surface-elevated ${className}`}
        >
            <svg
                viewBox="0 0 16 16"
                width="12"
                height="12"
                aria-hidden
                className="text-text-disabled"
            >
                <circle cx="5" cy="4" r="1" fill="currentColor" />
                <circle cx="11" cy="4" r="1" fill="currentColor" />
                <circle cx="5" cy="8" r="1" fill="currentColor" />
                <circle cx="11" cy="8" r="1" fill="currentColor" />
                <circle cx="5" cy="12" r="1" fill="currentColor" />
                <circle cx="11" cy="12" r="1" fill="currentColor" />
            </svg>
            {label && (
                <span className="text-display text-xs tracking-wide text-parchment/70">
                    {label}
                </span>
            )}
        </div>
    );
}

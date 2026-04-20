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
            className={`flex items-center gap-2 px-3 py-1 cursor-move select-none border-b border-white/10 bg-white/5 hover:bg-white/10 ${className}`}
        >
            <svg
                viewBox="0 0 16 16"
                width="12"
                height="12"
                aria-hidden
                className="text-white/60"
            >
                <circle cx="5" cy="4" r="1" fill="currentColor" />
                <circle cx="11" cy="4" r="1" fill="currentColor" />
                <circle cx="5" cy="8" r="1" fill="currentColor" />
                <circle cx="11" cy="8" r="1" fill="currentColor" />
                <circle cx="5" cy="12" r="1" fill="currentColor" />
                <circle cx="11" cy="12" r="1" fill="currentColor" />
            </svg>
            {label && (
                <span className="text-xs text-white/70 font-medium">
                    {label}
                </span>
            )}
        </div>
    );
}

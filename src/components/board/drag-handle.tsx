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
            className={`flex items-center gap-2 px-3 py-1.5 cursor-move select-none border-b border-zinc-800/80 hover:bg-white/5 ${className}`}
        >
            <svg
                viewBox="0 0 16 16"
                width="12"
                height="12"
                aria-hidden
                className="text-zinc-500"
            >
                <circle cx="5" cy="4" r="1" fill="currentColor" />
                <circle cx="11" cy="4" r="1" fill="currentColor" />
                <circle cx="5" cy="8" r="1" fill="currentColor" />
                <circle cx="11" cy="8" r="1" fill="currentColor" />
                <circle cx="5" cy="12" r="1" fill="currentColor" />
                <circle cx="11" cy="12" r="1" fill="currentColor" />
            </svg>
            {label && (
                <span className="font-beleren text-xs tracking-wide text-[#f1f1e8]/70">
                    {label}
                </span>
            )}
        </div>
    );
}

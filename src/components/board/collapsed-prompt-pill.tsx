import { cn } from "~/lib/utils";

/** One-line stand-in for a collapsed prompt (issue #7425): the prompt's title
 *  and a "C to expand" hint. Clicking expands too. */
export default function CollapsedPromptPill({
    title,
    onExpand,
    className,
}: {
    title: string;
    onExpand: () => void;
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={onExpand}
            aria-label={`Expand: ${title}`}
            className={cn(
                "pointer-events-auto inline-flex cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-surface/85 px-4 py-2 text-sm text-text backdrop-blur-md transition-colors hover:bg-surface-elevated",
                className
            )}
        >
            <span className="text-display">{title}</span>
            <kbd className="rounded-sm border border-[var(--hairline-strong)] bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                C to expand
            </kbd>
        </button>
    );
}

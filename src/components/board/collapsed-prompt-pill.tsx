import { Keycap } from "~/components/ui/keycap";
import { HOTKEYS, ariaKeyShortcuts } from "~/lib/hotkeys";
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
            aria-keyshortcuts={ariaKeyShortcuts(HOTKEYS.collapsePrompt)}
            className={cn(
                "pointer-events-auto inline-flex cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-surface/85 px-4 py-2 text-sm text-text backdrop-blur-md transition-colors hover:bg-surface-elevated",
                className
            )}
        >
            <span className="text-display">{title}</span>
            {/* The `C` hint (issue #9833): the shared keycap, from the
                declaration `usePromptCollapseHotkey` matches; hidden with
                its caption under a coarse pointer. */}
            <span
                aria-hidden
                className="inline-flex items-center gap-1 text-[10px] text-text-muted pointer-coarse:hidden"
            >
                <Keycap hotkey={HOTKEYS.collapsePrompt} />
                to expand
            </span>
        </button>
    );
}

import { cn } from "@/lib/utils";
import { fmtTime } from "../../lib/format";
import { entryLabel } from "../../lib/tail";
import type { TailEntry } from "../../lib/nowPayload";

/**
 * One line of a followed transcript (issue #3135, ported in PRD #3148 S2):
 * a clock, what produced it, and the body — the way `tail -f` on the file
 * would read in a terminal.
 *
 * The body is a `<pre>`: a tool's command, a diff fragment or a stack trace is
 * whitespace-significant, and re-flowing it is how a transcript stops being
 * readable. It wraps rather than scrolling sideways, because the drawer is
 * narrow and a horizontal scrollbar per line is worse than a wrapped line.
 */
export function TailEntryRow({ entry }: { entry: TailEntry }) {
    const isError = entry.kind === "tool_result" && entry.isError;
    return (
        <div
            className={cn(
                "grid grid-cols-[auto_auto_1fr] gap-2 border-b px-3 py-1.5 text-[11px] last:border-b-0",
                isError && "border-l-state-bad border-l-2"
            )}
        >
            <span className="text-muted-foreground tabular-nums">
                {fmtTime(entry.ts)}
            </span>
            <span
                className={cn(
                    "font-medium",
                    isError ? "text-state-bad" : "text-muted-foreground"
                )}
            >
                {entryLabel(entry)}
            </span>
            <pre className="font-mono whitespace-pre-wrap">{entry.text}</pre>
        </div>
    );
}

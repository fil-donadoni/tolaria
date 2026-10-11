import { Button } from "@/components/ui/button";

/** "Recent results" strip: a count and a link into History — finished events
 *  themselves never render on the hub. */
export default function LimitedHubResultsStrip({
    count,
    latestRecord,
    onOpenHistory,
}: {
    count: number;
    /** The record of the most recent finished event, when it has one. */
    latestRecord: string | null;
    onOpenHistory: () => void;
}) {
    if (count === 0) return null;
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--panel-radius)] border border-border-subtle/40 px-4 py-2">
            <span className="text-sm text-text-muted">
                Recent results · {count} finished
                {latestRecord ? ` · last ${latestRecord}` : ""}
            </span>
            <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onOpenHistory}
            >
                View history
            </Button>
        </div>
    );
}

// One ranked candidate in the focused seat's pack (issue #1612): score,
// unreviewed-profile badge, and an expandable full term breakdown with
// provenance. The chosen candidate starts expanded — the one decision the
// seat actually made is the one worth reading first.
import { useState } from "react";
import type { PickCandidateTrace } from "@convex/limited/botDrafter";
import type { CardProfile } from "@convex/limited/cardProfilesCore";
import DraftLabTermBreakdown from "./draft-lab-term-breakdown";
import DraftLabProfileBadge from "./draft-lab-profile-badge";

export default function DraftLabCandidateRow({
    cardName,
    trace,
    chosen,
    profile,
    defaultExpanded = false,
}: {
    cardName: string;
    trace: PickCandidateTrace | null;
    chosen: boolean;
    profile: CardProfile | null;
    defaultExpanded?: boolean;
}) {
    const [expanded, setExpanded] = useState(defaultExpanded);

    return (
        <div
            className={`rounded px-1.5 py-1 ${
                chosen ? "bg-signal-self/15" : "bg-surface-elevated/30"
            }`}
        >
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-baseline justify-between gap-2 text-left"
            >
                <span className="flex items-center gap-1.5 truncate text-text">
                    {chosen && <span className="text-signal-self">★ </span>}
                    {cardName}
                    <DraftLabProfileBadge profile={profile} />
                </span>
                <span className="shrink-0 text-text-muted tabular-nums">
                    {trace ? trace.score.toFixed(2) : "unresolved"}
                </span>
            </button>
            {expanded && trace && (
                <div className="mt-1 border-t border-border-accent/20 pt-1">
                    <DraftLabTermBreakdown terms={trace.terms} />
                    <p className="mt-1 text-[10px] text-text-disabled">
                        pick {trace.pickNumber} · context cap{" "}
                        {trace.contextCap.toFixed(2)}
                        {trace.contextScale !== 1 &&
                            ` · scaled ×${trace.contextScale.toFixed(3)}`}
                    </p>
                </div>
            )}
        </div>
    );
}

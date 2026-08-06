// Debug panel section: the bot's liveness escalations (issue #2284).
//
// A decision the bot could NOT make has no `DecisionTrace` to ride on — and it
// is exactly the thing that must not be silent. Every escalation past rung 1 is
// listed here with the Expected Input kind (ADR 0047) that caused it, so a
// window nobody wired is visible the moment it happens instead of appearing as
// a board that stopped moving.
//
// Empty while the invariant holds normally, which is the common case.

import { useAiEscalations } from "~/hooks/useAiEscalations";
import { clearAiEscalations } from "~/lib/ai/trace-store";

const RUNG_LABEL: Record<number, string> = {
    1: "re-decide",
    2: "minimal-legal",
    3: "rules decline",
    4: "priority pass",
    5: "handed to the player",
};

export default function AiEscalationLog() {
    const escalations = useAiEscalations();
    if (escalations.length === 0) return null;

    return (
        <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
                <span className="font-medium text-warning">
                    Bot liveness escalations ({escalations.length})
                </span>
                <button
                    type="button"
                    onClick={clearAiEscalations}
                    className="rounded border border-border px-1.5 py-0.5"
                >
                    Clear
                </button>
            </div>
            <ul className="flex flex-col gap-0.5 font-mono">
                {escalations.map((e, i) => (
                    <li key={`${e.at}-${i}`}>
                        rung {e.rung} ({RUNG_LABEL[e.rung] ?? "?"}) ·{" "}
                        {e.expectedKind} → {e.action}
                    </li>
                ))}
            </ul>
        </div>
    );
}

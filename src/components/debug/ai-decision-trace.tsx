// Debug panel section: the Bot's recent decisions (AI reasoning logging).
//
// A ring of the last decisions (issue #3404), newest first, each read in plain
// language by `AiDecisionSummary` with the search's own numbers behind that
// decision's own disclosure. It used to be the single latest decision, rendered
// straight as the dense candidate lines — which is the right artifact for
// someone who already knows the engine and unusable for the tester the box is
// mounted for, whose blunder is two decisions old by the time they open it.
//
// Reads the client-only trace store; shows nothing until the bot has thought
// once.

import { useState } from "react";
import { useAiTraces } from "~/hooks/useAiTraces";
import { clearAiTraces } from "~/lib/ai/trace-store";
import AiTraceLegend from "./ai-trace-legend";
import AiDecisionSummary from "./ai-decision-summary";

export default function AiDecisionTrace() {
    const records = useAiTraces();
    const [copied, setCopied] = useState(false);
    const [showLegend, setShowLegend] = useState(false);

    // The WHOLE ring, not just the newest: the copy is what travels into a bug
    // report or a blade entry, and a ring copied one decision at a time is the
    // sequence the reporter was asked for minus its sequence.
    const copyTraces = () => {
        if (records.length === 0) return;
        void navigator.clipboard.writeText(JSON.stringify(records, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-label">
                    AI · last decisions
                    {records.length > 0 ? ` (${records.length})` : ""}
                </span>
                {records.length > 0 && (
                    <span className="flex items-baseline gap-2">
                        <button
                            onClick={() => setShowLegend((v) => !v)}
                            title="Show what each symbol means"
                            className={`rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors hover:border-accent hover:text-parchment ${
                                showLegend
                                    ? "border-accent text-accent-strong"
                                    : "border-border-strong text-text-muted"
                            }`}
                        >
                            ?
                        </button>
                        <button
                            onClick={copyTraces}
                            className="rounded-sm border border-border-strong px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-parchment"
                        >
                            {copied ? "Copied!" : "Copy"}
                        </button>
                        <button
                            onClick={clearAiTraces}
                            className="rounded-sm border border-border-strong px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-parchment"
                        >
                            Clear
                        </button>
                    </span>
                )}
            </div>

            {records.length > 0 && showLegend && <AiTraceLegend />}

            {records.length === 0 ? (
                <span className="text-[11px] text-text-disabled">
                    No bot decision yet.
                </span>
            ) : (
                <div className="flex max-h-full flex-col gap-1 overflow-y-auto">
                    {[...records].reverse().map((record) => (
                        <AiDecisionSummary key={record.id} record={record} />
                    ))}
                </div>
            )}
        </div>
    );
}

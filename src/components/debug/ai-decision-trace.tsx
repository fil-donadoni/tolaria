// Debug panel section: the Bot's last DecisionTrace (AI reasoning logging).
//
// Renders what the Brain weighed for its most recent thought — every candidate
// move with its visit count, mean reward and the per-term `evaluate` breakdown
// of the position it leads to. The diagnostic: when two target choices show the
// SAME hand/power terms, the spell's effect was never simulated (e.g. casting
// Braingeyser on the human, or Giant Growth on the player's creature). Reads the
// client-only trace store; shows nothing until the bot has thought once.

import { useState } from "react";
import type { CandidateTrace, EvalTerms } from "@convex/gre";
import { useLatestAiTrace } from "~/hooks/useLatestAiTrace";

const TERM_LABELS: [keyof EvalTerms, string][] = [
    ["life", "L"],
    ["hand", "H"],
    ["power", "P"],
    ["toughness", "T"],
    ["evasion", "E"],
    ["permanents", "Pm"],
    ["mana", "M"],
];

function termLine(terms: EvalTerms): string {
    return TERM_LABELS.filter(([k]) => terms[k] !== 0)
        .map(([k, label]) => `${label}${terms[k]}`)
        .join(" ");
}

function CandidateRow({
    cand,
    chosen,
}: {
    cand: CandidateTrace;
    chosen: boolean;
}) {
    const { self, opp, margin } = cand.eval;
    return (
        <div
            className={`rounded px-1.5 py-1 ${
                chosen ? "bg-emerald-500/15" : "bg-white/[0.03]"
            }`}
        >
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-white/90 truncate">
                    {chosen && <span className="text-emerald-400">★ </span>}
                    {cand.label}
                </span>
                <span className="shrink-0 text-white/50 tabular-nums">
                    v{cand.visits} r{cand.meanReward.toFixed(2)} a{cand.avail}
                </span>
            </div>
            <div className="mt-0.5 text-[10px] leading-tight text-white/40">
                <span
                    className={
                        margin < 0 ? "text-rose-400/80" : "text-emerald-400/80"
                    }
                >
                    Δ{margin}
                </span>{" "}
                <span className="text-white/50">self</span>{" "}
                {termLine(self) || "—"}{" "}
                <span className="text-white/50">opp</span>{" "}
                {termLine(opp) || "—"}
            </div>
        </div>
    );
}

export default function AiDecisionTrace() {
    const trace = useLatestAiTrace();
    const [copied, setCopied] = useState(false);

    const copyTrace = () => {
        if (!trace) return;
        void navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-white/40 text-[10px] uppercase tracking-wide">
                    AI · last decision
                </span>
                {trace && (
                    <span className="flex items-baseline gap-2">
                        <span className="text-white/30 text-[10px] tabular-nums">
                            {trace.iterations} iters · {trace.candidates.length}{" "}
                            moves
                        </span>
                        <button
                            onClick={copyTrace}
                            className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-white/10 hover:text-white"
                        >
                            {copied ? "Copied!" : "Copy"}
                        </button>
                    </span>
                )}
            </div>

            {!trace ? (
                <span className="text-white/30 text-[11px]">
                    No bot decision yet.
                </span>
            ) : (
                <div className="max-h-full overflow-y-auto flex flex-col gap-1">
                    {trace.candidates.map((cand, i) => (
                        <CandidateRow
                            key={`${cand.label}-${i}`}
                            cand={cand}
                            chosen={cand.label === trace.chosen}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

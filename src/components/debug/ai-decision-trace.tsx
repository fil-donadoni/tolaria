// Debug panel section: the Bot's last DecisionTrace (AI reasoning logging).
//
// Renders what the Brain weighed for its most recent thought — every candidate
// move with its visit count, mean reward and the per-term `evaluate` breakdown
// of the position it leads to. The diagnostic: when two target choices show the
// SAME hand/creature terms, the spell's effect was never simulated (e.g. casting
// Braingeyser on the human, or Giant Growth on the player's creature). Reads the
// client-only trace store; shows nothing until the bot has thought once.

import { useState } from "react";
import type { CandidateTrace, EvalTerms } from "@convex/gre";
import { useLatestAiTrace } from "~/hooks/useLatestAiTrace";
import AiTraceLegend from "./ai-trace-legend";

const TERM_LABELS: [keyof EvalTerms, string, string][] = [
    ["life", "L", "Life"],
    ["hand", "H", "Hand"],
    ["creatures", "C", "Creatures"],
    ["permanents", "Pm", "Permanents (non-creature)"],
    ["mana", "M", "Mana"],
    ["flexibility", "Fx", "Flexibility"],
];

/** Round to at most 3 decimals, dropping float noise (252.39999999999998 → 252.4). */
function r3(n: number): number {
    return Math.round(n * 1000) / 1000;
}

function termLine(terms: EvalTerms): string {
    return TERM_LABELS.filter(([k]) => terms[k] !== 0)
        .map(([k, label]) => `${label}${r3(terms[k])}`)
        .join(" ");
}

/** A spelled-out tooltip for one side's eval terms, e.g.
 *  "Life 128 · Creatures 473 · Mana 12" — the hover companion to the terse
 *  `termLine`, so each letter is recognisable without opening the legend. */
function termTitle(side: string, terms: EvalTerms): string {
    const parts = TERM_LABELS.filter(([k]) => terms[k] !== 0).map(
        ([k, , name]) => `${name} ${r3(terms[k])}`
    );
    return parts.length ? `${side}: ${parts.join(" · ")}` : `${side}: —`;
}

function CandidateRow({
    cand,
    chosen,
}: {
    cand: CandidateTrace;
    chosen: boolean;
}) {
    const { self, opp, margin, danger } = cand.eval;
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
                    <span title="Visits — times this move was simulated">
                        v{cand.visits}
                    </span>{" "}
                    <span title="Mean reward — win-rate estimate, 0–1">
                        r{cand.meanReward.toFixed(2)}
                    </span>{" "}
                    <span title="Availability — times this move was a legal option">
                        a{cand.avail}
                    </span>
                </span>
            </div>
            <div className="mt-0.5 text-[10px] leading-tight text-white/40">
                <span
                    title="Material margin (self − opp)"
                    className={
                        margin < 0 ? "text-rose-400/80" : "text-emerald-400/80"
                    }
                >
                    Δ{r3(margin)}
                </span>{" "}
                {danger !== 0 && (
                    <span
                        className={
                            danger < 0
                                ? "text-rose-400/80"
                                : "text-emerald-400/80"
                        }
                        title="Danger Clock — race term; negative = losing the race"
                    >
                        clk{danger > 0 ? "+" : ""}
                        {Math.round(danger)}{" "}
                    </span>
                )}
                <span className="text-white/50" title={termTitle("self", self)}>
                    self
                </span>{" "}
                <span title={termTitle("self", self)}>
                    {termLine(self) || "—"}
                </span>{" "}
                <span className="text-white/50" title={termTitle("opp", opp)}>
                    opp
                </span>{" "}
                <span title={termTitle("opp", opp)}>
                    {termLine(opp) || "—"}
                </span>
            </div>
        </div>
    );
}

export default function AiDecisionTrace() {
    const trace = useLatestAiTrace();
    const [copied, setCopied] = useState(false);
    const [showLegend, setShowLegend] = useState(false);

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
                            onClick={() => setShowLegend((v) => !v)}
                            title="Show what each symbol means"
                            className={`rounded border px-1.5 py-0.5 text-[10px] hover:bg-white/10 hover:text-white ${
                                showLegend
                                    ? "border-white/40 text-white/80"
                                    : "border-white/20 text-white/60"
                            }`}
                        >
                            ?
                        </button>
                        <button
                            onClick={copyTrace}
                            className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/60 hover:bg-white/10 hover:text-white"
                        >
                            {copied ? "Copied!" : "Copy"}
                        </button>
                    </span>
                )}
            </div>

            {trace && showLegend && <AiTraceLegend />}

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

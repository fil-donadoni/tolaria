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
                chosen ? "bg-signal-self/15" : "bg-surface-elevated/30"
            }`}
        >
            <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-text">
                    {chosen && <span className="text-signal-self">★ </span>}
                    {cand.label}
                </span>
                <span className="shrink-0 text-text-muted tabular-nums">
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
            <div className="mt-0.5 text-[10px] leading-tight text-text-muted">
                <span
                    title="Material margin (self − opp)"
                    className={
                        margin < 0 ? "text-signal-opponent" : "text-signal-self"
                    }
                >
                    Δ{r3(margin)}
                </span>{" "}
                {danger !== 0 && (
                    <span
                        className={
                            danger < 0
                                ? "text-signal-opponent"
                                : "text-signal-self"
                        }
                        title="Danger Clock — race term; negative = losing the race"
                    >
                        clk{danger > 0 ? "+" : ""}
                        {Math.round(danger)}{" "}
                    </span>
                )}
                <span className="text-text" title={termTitle("self", self)}>
                    self
                </span>{" "}
                <span title={termTitle("self", self)}>
                    {termLine(self) || "—"}
                </span>{" "}
                <span className="text-text" title={termTitle("opp", opp)}>
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
                <span className="text-label">AI · last decision</span>
                {trace && (
                    <span className="flex items-baseline gap-2">
                        <span className="text-[10px] text-text-disabled tabular-nums">
                            {trace.iterations} iters · {trace.candidates.length}{" "}
                            moves
                        </span>
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
                            onClick={copyTrace}
                            className="rounded-sm border border-border-strong px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:border-accent hover:text-parchment"
                        >
                            {copied ? "Copied!" : "Copy"}
                        </button>
                    </span>
                )}
            </div>

            {trace && showLegend && <AiTraceLegend />}

            {!trace ? (
                <span className="text-[11px] text-text-disabled">
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

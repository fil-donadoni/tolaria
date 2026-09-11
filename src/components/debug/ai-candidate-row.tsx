// One root candidate, in the search's own numbers (the `details` disclosure of
// an `AiDecisionSummary`).
//
// This is the ORIGINAL trace line, unchanged in content and moved out of
// `ai-decision-trace.tsx` when issue #3404 put a plain-language reading in
// front of it. It stays the diagnostic of record: when two target choices show
// the SAME hand/creature terms, the spell's effect was never simulated (e.g.
// casting Braingeyser on the human, or Giant Growth on the player's creature).
// The words above it cannot show that — only the per-term numbers can.

import type { CandidateTrace, EvalTerms } from "@convex/gre";
import { EVAL_TERM_LABELS, EVAL_TERM_ORDER } from "~/lib/ai/eval-term-labels";

/** Round to at most 3 decimals, dropping float noise (252.39999999999998 → 252.4). */
function r3(n: number): number {
    return Math.round(n * 1000) / 1000;
}

function termLine(terms: EvalTerms): string {
    return EVAL_TERM_ORDER.filter((k) => terms[k] !== 0)
        .map((k) => `${EVAL_TERM_LABELS[k].short}${r3(terms[k])}`)
        .join(" ");
}

/** A spelled-out tooltip for one side's eval terms, e.g.
 *  "Life 128 · Creatures 473 · Mana 12" — the hover companion to the terse
 *  `termLine`, so each letter is recognisable without opening the legend. */
function termTitle(side: string, terms: EvalTerms): string {
    const parts = EVAL_TERM_ORDER.filter((k) => terms[k] !== 0).map(
        (k) => `${EVAL_TERM_LABELS[k].name} ${r3(terms[k])}`
    );
    return parts.length ? `${side}: ${parts.join(" · ")}` : `${side}: —`;
}

export default function AiCandidateRow({
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

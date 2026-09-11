// One bot decision, read in plain language (issue #3404, PRD #3397).
//
// The order is deliberate and is the whole point of the slice: what it played,
// why, what else was on the table — then, and only behind a disclosure, the
// numbers. The box used to open on the numbers, which meant a tester could see
// everything about a decision except what it was.

import type { AiTraceRecord } from "~/lib/ai/trace-store";
import {
    MECHANISM_SENTENCES,
    isSearchMechanism,
} from "~/lib/ai/decision-phrases";
import AiDecisionAlternative from "./ai-decision-alternative";
import AiCandidateRow from "./ai-candidate-row";

/** How many alternatives get a reading. The candidates arrive most-visited
 *  first, so these are the moves the search actually took seriously; the rest
 *  are in the disclosure below. */
const MAX_ALTERNATIVES = 3;

export default function AiDecisionSummary({
    record,
}: {
    record: AiTraceRecord;
}) {
    const { trace, via } = record;
    const chosen = trace.candidates.find((c) => c.label === trace.chosen);
    const alternatives = trace.candidates
        .filter((c) => c.label !== trace.chosen)
        .slice(0, MAX_ALTERNATIVES);

    return (
        <div className="flex flex-col gap-1 rounded border border-border-subtle px-1.5 py-1 text-[11px] leading-snug">
            <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-text">
                    <span className="text-signal-self">★ </span>
                    {trace.chosen}
                </span>
                {via !== "worker" && (
                    // The degraded path (issue #3040): the Worker was gone, so
                    // the search ran on the main thread under whatever budget
                    // survived. A decision taken there is not evidence about
                    // the bot's preferences in the way a normal one is.
                    <span
                        className="shrink-0 rounded-sm border border-warning px-1 text-[10px] text-warning"
                        title="This decision did not come from the Brain worker — it ran inline on the main thread after the worker was unavailable."
                    >
                        fallback
                    </span>
                )}
            </div>

            <span className="text-text-muted">
                {MECHANISM_SENTENCES[trace.mechanism]}
            </span>
            {!isSearchMechanism(trace.mechanism) && (
                // A named rule overrode the search's own argmax. Worth saying
                // out loud: a candidate with more visits and a better margin
                // losing anyway is otherwise unexplainable from the numbers.
                <span className="text-text-disabled">
                    (a tie-break decided this, not the search itself:{" "}
                    {trace.mechanism})
                </span>
            )}

            {alternatives.length > 0 && (
                <div className="flex flex-col">
                    <span className="text-label">Instead of</span>
                    <ul className="flex flex-col gap-0.5 pl-2">
                        {alternatives.map((cand, i) =>
                            chosen ? (
                                <AiDecisionAlternative
                                    key={`${cand.label}-${i}`}
                                    chosen={chosen}
                                    candidate={cand}
                                />
                            ) : (
                                <li key={`${cand.label}-${i}`}>{cand.label}</li>
                            )
                        )}
                    </ul>
                </div>
            )}

            <details>
                <summary className="cursor-pointer text-text-disabled">
                    Details — {trace.candidates.length} moves,{" "}
                    {trace.iterationsCompleted}/{trace.iterationsRequested}{" "}
                    iters ({trace.stoppedBy}), {Math.round(trace.elapsedMs)}ms
                </summary>
                <div className="mt-1 flex flex-col gap-1">
                    {trace.candidates.map((cand, i) => (
                        <AiCandidateRow
                            key={`${cand.label}-${i}`}
                            cand={cand}
                            chosen={cand.label === trace.chosen}
                        />
                    ))}
                </div>
            </details>
        </div>
    );
}

// One bot decision, read in plain language (issue #3404, PRD #3397).
//
// The order is deliberate and is the whole point of the slice: what it played,
// why, what else was on the table — then, and only behind a disclosure, the
// numbers. The box used to open on the numbers, which meant a tester could see
// everything about a decision except what it was.

import { useState } from "react";
import type { AiTraceRecord } from "~/lib/ai/trace-store";
import {
    MECHANISM_SENTENCES,
    isSearchMechanism,
} from "~/lib/ai/decision-phrases";
import { requestAnomalyReport } from "~/lib/ai/anomaly-report";
import AiDecisionAlternative from "./ai-decision-alternative";
import AiCandidateRow from "./ai-candidate-row";
import AiDecisionVerdictQuiz from "./ai-decision-verdict-quiz";
import DebugButton from "./debug-button";

/** How many alternatives get a reading. The candidates arrive most-visited
 *  first, so these are the moves the search actually took seriously; the rest
 *  are in the disclosure below. */
const MAX_ALTERNATIVES = 3;

export default function AiDecisionSummary({
    record,
}: {
    record: AiTraceRecord;
}) {
    const [quizOpen, setQuizOpen] = useState(false);
    const { trace, via } = record;
    const chosen = trace.candidates.find((c) => c.label === trace.chosen);
    const alternatives = trace.candidates
        .filter((c) => c.label !== trace.chosen)
        .slice(0, MAX_ALTERNATIVES);

    return (
        <div className="flex min-w-0 flex-col gap-1 rounded border border-border-subtle px-1.5 py-1 text-[11px] leading-snug">
            <div className="flex items-baseline justify-between gap-2">
                {/* `break-words`, not `truncate`: this is the most important
                    line in the box and a move label is a sentence ("Cast
                    Lightning Bolt targeting Grizzly Bears") — clipping it in a
                    400px phone sheet cuts exactly the half that says which
                    move was taken. */}
                <span className="min-w-0 break-words font-medium text-text">
                    <span className="text-signal-self">★ </span>
                    {trace.chosen}
                </span>
                {via !== "worker" && (
                    // The degraded path (issue #3040): the Worker was gone, so
                    // the search ran on the main thread under whatever budget
                    // survived. A decision taken there is not evidence about
                    // the bot's preferences in the way a normal one is.
                    <span
                        className="shrink-0 rounded-sm border border-signal-pending px-1 text-[10px] text-signal-pending"
                        title="This decision did not come from the Brain worker — it ran inline on the main thread, because the worker was unavailable, had exhausted its respawn budget, or does not exist in this environment."
                    >
                        fallback
                    </span>
                )}
            </div>

            <span className="break-words text-text-muted">
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
                <summary className="cursor-pointer break-words text-text-disabled">
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

            {/* Judging and reporting are the same gesture from the same place
                (issue #3405): the tester is already looking at the decision,
                and asking them to find a second surface to say something about
                it is how a blunder stays unreported. */}
            <div className="flex flex-wrap items-center gap-1">
                {record.judged ? (
                    <span className="text-[10px] text-signal-self">
                        Judged
                        {record.judged.author
                            ? ` by ${record.judged.author}`
                            : ""}
                    </span>
                ) : (
                    <DebugButton
                        onClick={() => setQuizOpen((open) => !open)}
                        disabled={quizOpen}
                    >
                        Judge this move
                    </DebugButton>
                )}
                <DebugButton onClick={() => requestAnomalyReport(record)}>
                    Report anomaly
                </DebugButton>
            </div>

            {quizOpen && !record.judged && (
                <AiDecisionVerdictQuiz
                    record={record}
                    onClose={() => setQuizOpen(false)}
                />
            )}
        </div>
    );
}

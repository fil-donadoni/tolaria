// Why ONE decision could not become a quiz — the refusal, rendered (issue
// #3457, PRD #3397, ADR 0124 §1).
//
// This used to be `state.error` in a single red `<p>`: the refusal's KIND, the
// sentence explaining it, and a semicolon-joined run of twenty "not captured"
// notes, all in one flat paragraph. Three refusals in a row being the SAME
// class took four lines of prose each to establish, and reporting one meant
// re-typing it off the screen.
//
// So the same record is rendered as what it is: a TITLE per kind (the frozen
// vocabulary `lowerDecision` refuses with, looked up in `QUIZ_REFUSALS` by the
// kind rather than carried on the record), the detail under it, the dropped
// notes as a LIST behind a closed disclosure, and a Copy that puts the whole
// thing — kind, title, detail, every note, and the decision's own id/seq — on
// the clipboard as plain text.
//
// THE HEIGHT IS BOUNDED ON PURPOSE. A real capture runs to twenty-odd dropped
// entries: expanded inside the 293px debug sheet they pushed Close off the
// bottom, so the prose scrolls in its own box and the buttons sit outside it,
// always reachable at every viewport.

import { useEffect, useRef, useState } from "react";
import {
    formatRefusalReport,
    QUIZ_REFUSALS,
    type VerdictQuizRefusal,
} from "~/lib/ai/verdict-quiz";
import { copyText } from "~/lib/clipboard";
import DebugButton from "./debug-button";
import AiDecisionDroppedNotes from "./ai-decision-dropped-notes";

export default function AiDecisionQuizRefusal({
    refusal,
    decision,
    onClose,
}: {
    refusal: VerdictQuizRefusal;
    /** The ring entry this refusal is about — what a pasted report names. */
    decision: { id: number; seq?: number };
    onClose: () => void;
}) {
    const [copied, setCopied] = useState(false);
    const resetAt = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (resetAt.current !== null) clearTimeout(resetAt.current);
        },
        []
    );

    const handleCopy = () => {
        // "Copied!" only once the write RESOLVED: an insecure context or a
        // denied permission rejects, and claiming success over an empty
        // clipboard is the one failure a tester cannot see (PR review).
        copyText(formatRefusalReport(refusal, decision))
            .then(() => {
                setCopied(true);
                resetAt.current = setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => setCopied(false));
    };

    const { title, trackedBy } = QUIZ_REFUSALS[refusal.kind];

    return (
        <div className="flex flex-col gap-1">
            <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
                <span
                    className="break-words text-[11px] font-semibold text-danger-strong"
                    data-testid="quiz-refusal-title"
                    data-refusal-kind={refusal.kind}
                >
                    {title}
                </span>
                <p className="break-words text-[10px] text-text-muted">
                    {refusal.detail}
                </p>
                {trackedBy !== null && (
                    // A refusal whose cause is ONE known spec gap says which,
                    // so a tester's report arrives already triaged.
                    <span className="text-[10px] text-text-disabled">
                        tracked by issue #{trackedBy}
                    </span>
                )}
                <AiDecisionDroppedNotes notes={refusal.dropped} />
            </div>

            <DebugButton onClick={handleCopy}>
                {copied ? "Copied!" : "Copy refusal"}
            </DebugButton>
            <DebugButton onClick={onClose}>Close</DebugButton>
        </div>
    );
}

// Debug panel section: how each of the bot's recent decisions ENDED
// (issue #2470).
//
// The escalation log next to this one shows what fired once the normal path had
// already produced nothing. It cannot show WHY, and that is the whole
// diagnosis: a search that threw, a Worker that died, a consult that timed out
// and a bot that simply chose to pass all reach the driver as the same "no
// move". This list separates them — and, unlike the escalation log, it is NOT
// empty in the healthy case, because a run of `move` is itself the evidence
// that the Brain was answering.
//
// The same rows travel inside a bug report (`collectAiDiagnostics`).

import { useAiDecisions } from "~/hooks/useAiDecisions";
import { clearAiDecisions, type AiDecisionOutcome } from "~/lib/ai/trace-store";

/** Player-facing wording per outcome, and whether it is a FAILURE. Exhaustive
 *  over the union, so a new outcome is a build error rather than a blank cell. */
const OUTCOME: Record<AiDecisionOutcome, { label: string; bad: boolean }> = {
    move: { label: "chose a move", bad: false },
    "no-move": { label: "no move offered", bad: false },
    "skip-pass": { label: "trivial pass (no search)", bad: false },
    "search-error": { label: "SEARCH THREW", bad: true },
    "worker-error": { label: "WORKER FAILED", bad: true },
    timeout: { label: "CONSULT TIMED OUT", bad: true },
    "submit-error": { label: "SUBMISSION REJECTED", bad: true },
};

export default function AiDecisionLog() {
    const decisions = useAiDecisions();
    if (decisions.length === 0) return null;

    const failures = decisions.filter((d) => OUTCOME[d.outcome].bad).length;

    return (
        <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
                <span
                    className={
                        failures > 0
                            ? "font-medium text-warning"
                            : "font-medium text-text-muted"
                    }
                >
                    Bot decisions ({decisions.length}
                    {failures > 0 ? `, ${failures} failed` : ""})
                </span>
                <button
                    type="button"
                    onClick={clearAiDecisions}
                    className="rounded border border-border px-1.5 py-0.5"
                >
                    Clear
                </button>
            </div>
            <ul className="flex flex-col gap-0.5 font-mono">
                {decisions.map((d, i) => (
                    <li
                        key={`${d.at}-${i}`}
                        className={
                            OUTCOME[d.outcome].bad ? "text-warning" : undefined
                        }
                    >
                        #{d.seq} {d.phase} · {d.expectedKind} →{" "}
                        {OUTCOME[d.outcome].label}
                        {d.moveKind ? ` (${d.moveKind})` : ""}
                        {d.message ? `: ${d.message}` : ""}
                    </li>
                ))}
            </ul>
        </div>
    );
}

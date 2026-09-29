import {
    traceComparison,
    traceMechanismSentence,
    traceRoleLabel,
    traceTermLine,
    type BotFindingTrace as Trace,
} from "@/lib/botFindings";

/**
 * Why the search passed a card over (issue #4179): the move it chose, the
 * card's own move and the alternatives it weighed, each with its evaluation
 * terms and — for every move but the chosen one — the difference from the
 * chosen move in words, from the same phrase table as the in-game decision box.
 */
export default function BotFindingTrace({ trace }: { trace: Trace }) {
    return (
        <details data-bot-finding-trace="" className="text-xs text-text-muted">
            <summary className="cursor-pointer select-none text-text">
                Why the search passed it over
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
                <p>
                    {traceMechanismSentence(trace.mechanism)}{" "}
                    <span className="tabular-nums">
                        ({trace.iterations} iterations, {trace.weighed} moves
                        weighed)
                    </span>
                </p>
                {!trace.cardWeighed && (
                    <p data-bot-finding-trace-unweighed="">
                        The card&apos;s own move was never expanded inside the
                        search budget.
                    </p>
                )}
                <ol className="flex flex-col gap-1">
                    {trace.candidates.map((c, i) => {
                        const reading = traceComparison(trace, c);
                        return (
                            <li
                                key={i}
                                data-bot-finding-trace-role={c.role}
                                className={`rounded-sm px-1.5 py-1 ${
                                    c.role === "chosen"
                                        ? "bg-signal-self/15"
                                        : "bg-surface-elevated/30"
                                }`}
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                                    <span className="min-w-0 break-words text-text">
                                        <span className="font-semibold">
                                            {traceRoleLabel(c.role)}
                                        </span>{" "}
                                        · {c.label}
                                    </span>
                                    <span className="shrink-0 tabular-nums">
                                        <span title="Visits — times this move was simulated">
                                            v{c.visits}
                                        </span>{" "}
                                        <span title="Mean reward — win-rate estimate, 0–1">
                                            r{c.meanReward}
                                        </span>{" "}
                                        <span title="Evaluation of the position the move leads to">
                                            e{c.total}
                                        </span>
                                    </span>
                                </div>
                                {reading.length > 0 && (
                                    <p>vs chosen: {reading.join(", ")}</p>
                                )}
                                <p
                                    title="Evaluation terms, self/opponent"
                                    className="break-words font-mono text-[10px]"
                                >
                                    {traceTermLine(c)}
                                </p>
                            </li>
                        );
                    })}
                </ol>
            </div>
        </details>
    );
}

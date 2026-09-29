import {
    CARD_MOVE_SENTENCE,
    traceComparison,
    traceMechanismSentence,
    traceRoleLabel,
    traceTermLine,
    type BotFindingTrace as Trace,
} from "@/lib/botFindings";

/**
 * Why the search passed a card over (issue #4179): what happened to the
 * card's own move, then — when a search ran — the move it chose, the card's
 * move and the alternatives it weighed, each with its evaluation terms and,
 * for every move but the chosen one, the difference from the chosen move in
 * words, from the same phrase table as the in-game decision box.
 */
export default function BotFindingTrace({ trace }: { trace: Trace }) {
    const { search } = trace;
    return (
        <details data-bot-finding-trace="" className="text-xs text-text-muted">
            <summary className="cursor-pointer select-none text-text">
                Why the search passed it over
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
                <p data-bot-finding-card-move={trace.cardMove}>
                    {CARD_MOVE_SENTENCE[trace.cardMove]}
                </p>
                {search === undefined ? (
                    <p>No search ran: a single move was left to make.</p>
                ) : (
                    <>
                        <p>
                            {traceMechanismSentence(search.mechanism)}{" "}
                            <span className="tabular-nums">
                                ({search.iterations} iterations,{" "}
                                {search.weighed} moves weighed)
                            </span>
                        </p>
                        <ol className="flex flex-col gap-1">
                            {search.candidates.map((c, i) => {
                                const reading = traceComparison(search, c);
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
                                            <p>
                                                vs chosen: {reading.join(", ")}
                                            </p>
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
                    </>
                )}
            </div>
        </details>
    );
}

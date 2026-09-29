import {
    BLAME_LABEL,
    classDeltaText,
    type BotFindingClassRow,
} from "@/lib/botFindings";

/**
 * One Bot Gap class (ADR 0141, issue #4177): the key, who owes the fix, how
 * many cards it holds per Target List, the issue `gaps:sync` already filed,
 * and the `must` blade entry that proves it fixed — or "no proof yet" when
 * none of its cards' names carry one. The delta against the previous
 * measurement (issue #4181) is the same line a Cards-tab row shows.
 */
export default function BotFindingClassRow({
    cls,
}: {
    cls: BotFindingClassRow;
}) {
    return (
        <article
            data-bot-finding-class-row={cls.key}
            className="flex flex-col gap-1.5 rounded-sm border border-border-subtle/40 p-3"
        >
            <div className="flex flex-wrap items-center gap-2">
                <p className="break-words font-mono text-xs text-text">
                    {cls.key}
                </p>
                <span className="text-xs text-text-muted">
                    {BLAME_LABEL[cls.blame]}
                </span>
            </div>
            <p className="text-xs text-text-muted">
                {cls.cardCount} card(s) —{" "}
                {cls.targetCounts
                    .filter((t) => t.count > 0)
                    .map((t) => `${t.target}: ${t.count}`)
                    .join(", ") || "no registered Target holds this class"}
            </p>
            <p
                data-bot-finding-class-delta=""
                className="text-xs text-text-muted"
            >
                {classDeltaText(cls)}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs">
                {cls.issue !== undefined && (
                    <a
                        href={`https://github.com/fil-donadoni/tolaria/issues/${cls.issue}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-secondary-accent-strong hover:underline"
                    >
                        issue #{cls.issue}
                    </a>
                )}
                {cls.provingEntry !== undefined ? (
                    <span
                        data-bot-finding-class-proof=""
                        className="text-success-strong"
                    >
                        proven by: {cls.provingEntry}
                    </span>
                ) : (
                    <span
                        data-bot-finding-class-proof=""
                        className="text-text-disabled"
                    >
                        no proof yet
                    </span>
                )}
            </div>
        </article>
    );
}

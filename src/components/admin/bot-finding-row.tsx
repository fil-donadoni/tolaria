import { getImageFallbackUrl, getImageUrl } from "@/lib/images";
import {
    BLAME_LABEL,
    proseSegments,
    type BotFindingClassRow,
    type BotFindingRow as FindingRow,
} from "@/lib/botFindings";
import BotFindingTrace from "./bot-finding-trace";

/**
 * One card the play Bot struggles with (ADR 0141, issue #4176): its first
 * print, its name, the Bot Gap class it is blocked by, that class's prose —
 * the filer's own words, carried on the class row — and who owes the fix.
 * A `never-chosen` card also carries the search decision that refused it
 * (issue #4179).
 */
export default function BotFindingRow({
    finding,
    cls,
}: {
    finding: FindingRow;
    cls: BotFindingClassRow | undefined;
}) {
    return (
        <article
            data-bot-finding-row={finding.oracleId}
            className="flex gap-4 rounded-sm border border-border-subtle/40 p-3"
        >
            {finding.printId !== undefined && (
                <img
                    src={getImageUrl(finding.printId)}
                    alt={finding.name}
                    loading="lazy"
                    width={88}
                    height={123}
                    onError={(e) => {
                        const fallback = getImageFallbackUrl(finding.printId!);
                        if (e.currentTarget.src !== fallback)
                            e.currentTarget.src = fallback;
                    }}
                    className="h-[123px] w-[88px] shrink-0 rounded-sm object-cover"
                />
            )}
            <div className="flex min-w-0 flex-col gap-1.5">
                <h3 className="text-sm font-semibold text-text">
                    {finding.name}
                </h3>
                <p className="text-xs text-text-muted">
                    <span className="font-semibold">{finding.outcome}</span>
                    {finding.blame !== undefined && (
                        <> · {BLAME_LABEL[finding.blame]}</>
                    )}
                    {finding.compileSource !== undefined && (
                        <> · {finding.compileSource}</>
                    )}
                </p>
                {finding.gap !== undefined && (
                    <p className="break-words font-mono text-xs text-text">
                        {finding.gap}
                    </p>
                )}
                {cls !== undefined && (
                    <p
                        data-bot-finding-cause=""
                        className="text-xs leading-relaxed text-text-muted"
                    >
                        {proseSegments(cls.causeText).map((s, i) =>
                            s.code ? (
                                <code key={i} className="font-mono">
                                    {s.text}
                                </code>
                            ) : (
                                <span key={i}>{s.text}</span>
                            )
                        )}
                    </p>
                )}
                {finding.trace !== undefined && (
                    <BotFindingTrace trace={finding.trace} />
                )}
            </div>
        </article>
    );
}

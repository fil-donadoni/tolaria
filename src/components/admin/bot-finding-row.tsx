import { SWEEP_SOURCE, isTriage } from "@convex/botFindingsCore";
import { getImageFallbackUrl, getImageUrl } from "@/lib/images";
import {
    BLAME_LABEL,
    classDeltaText,
    isCopyable,
    proseSegments,
    type BotFindingClassRow,
    type BotFindingMeasurement,
    type BotFindingRow as FindingRow,
} from "@/lib/botFindings";
import {
    findingPayload,
    findingReproducers,
} from "@/lib/ai/bot-finding-payload";
import type { FindingLaunchActions } from "@/lib/ai/bot-finding-launch";
import BotFindingAnnotationForm from "./bot-finding-annotation-form";
import BotFindingCopyButton from "./bot-finding-copy-button";
import BotFindingReproducerForm from "./bot-finding-reproducer-form";
import BotFindingSnoozeControl from "./bot-finding-snooze-control";
import BotFindingReproducers from "./bot-finding-reproducers";
import BotFindingStatusBadge from "./bot-finding-status-badge";
import BotFindingTrace from "./bot-finding-trace";

/**
 * One card the play Bot struggles with (ADR 0141, issue #4176): its first
 * print, its name, the Bot Gap class it is blocked by, that class's prose —
 * the filer's own words, carried on the class row — and who owes the fix.
 * A `never-chosen` card also carries the search decision that refused it
 * (issue #4179). A row measured under an older Bot hash than the current one
 * carries a `stale` flag (issue #4181) — marked, never hidden — and its class
 * line says what the class held at the previous measurement.
 *
 * Human fields (issue #4182): the admin's note, linked issue and snooze reason
 * show on the row and the admin controls sit behind a disclosure. A triage
 * row — a human report with no Reproducer — says so and has no copy button.
 */
export default function BotFindingRow({
    finding,
    cls,
    stale,
    measurement,
    actions,
}: {
    finding: FindingRow;
    cls: BotFindingClassRow | undefined;
    stale: boolean;
    measurement: BotFindingMeasurement | null;
    actions: FindingLaunchActions;
}) {
    return (
        <article
            data-bot-finding-row={finding.oracleId}
            data-stale={stale ? "" : undefined}
            data-triage={isTriage(finding) ? "" : undefined}
            data-snoozed={finding.snoozedAt !== undefined ? "" : undefined}
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
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-text">
                        {finding.name}
                    </h3>
                    <BotFindingStatusBadge status={finding.status} />
                </div>
                <p className="text-xs text-text-muted">
                    {finding.source === SWEEP_SOURCE && (
                        <span className="font-semibold">{finding.outcome}</span>
                    )}
                    {finding.blame !== undefined && (
                        <> · {BLAME_LABEL[finding.blame]}</>
                    )}
                    {finding.compileSource !== undefined && (
                        <> · {finding.compileSource}</>
                    )}
                    {stale && (
                        <>
                            {" "}
                            ·{" "}
                            <span
                                data-bot-finding-stale=""
                                className="font-semibold text-danger-strong"
                            >
                                stale — measured under an older Bot
                            </span>
                        </>
                    )}
                </p>
                {finding.gap !== undefined && (
                    <p className="break-words font-mono text-xs text-text">
                        {finding.gap}
                    </p>
                )}
                {cls !== undefined && (
                    <p
                        data-bot-finding-class-delta=""
                        className="text-xs text-text-muted"
                    >
                        {classDeltaText(cls)}
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
                <BotFindingReproducers
                    labels={findingReproducers(finding, cls)}
                    {...actions}
                />
                {isCopyable(finding) && (
                    <div>
                        <BotFindingCopyButton
                            label={`Copy a Claude Code brief for ${finding.name}`}
                            text={() =>
                                findingPayload(finding, cls, measurement)
                            }
                        />
                    </div>
                )}
                {finding.trace !== undefined && (
                    <BotFindingTrace trace={finding.trace} />
                )}
                {finding.source !== SWEEP_SOURCE && (
                    <p
                        data-bot-finding-source=""
                        className="text-xs font-semibold text-text-muted"
                    >
                        Reported by a human
                        {isTriage(finding) &&
                            " — in triage until it names a reproducer"}
                    </p>
                )}
                {finding.note !== undefined && (
                    <p data-bot-finding-note="" className="text-xs text-text">
                        {finding.note}
                    </p>
                )}
                {finding.linkedIssue !== undefined && (
                    <p
                        data-bot-finding-linked-issue=""
                        className="text-xs text-text-muted"
                    >
                        Linked: issue #{finding.linkedIssue}
                    </p>
                )}
                {finding.snoozedAt !== undefined && (
                    <p
                        data-bot-finding-snoozed=""
                        className="text-xs font-semibold text-text-muted"
                    >
                        Snoozed — {finding.snoozeReason}
                    </p>
                )}
                <details data-bot-finding-admin="" className="text-xs">
                    <summary className="cursor-pointer text-text-muted">
                        Note, issue, reproducers and snooze
                    </summary>
                    <div className="mt-2 flex flex-col gap-3">
                        <BotFindingAnnotationForm finding={finding} />
                        <BotFindingReproducerForm finding={finding} />
                        <BotFindingSnoozeControl finding={finding} />
                    </div>
                </details>
            </div>
        </article>
    );
}

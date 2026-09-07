import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { NowSection } from "./NowSection";
import { WatchButton } from "./WatchButton";
import { LivenessBadge } from "./LivenessBadge";
import { OriginBadge } from "./OriginBadge";
import { Term } from "../Term";
import { Unavailable } from "../Unavailable";
import { EmptyNote } from "../EmptyNote";
import { IssueLink } from "../IssueLink";
import { fmtAgoMs, fmtTokens } from "../../lib/format";
import { sessionLabel } from "../../lib/nowClaims";
import type { NowPayload } from "../../lib/nowPayload";

export const LIVE_SECTION_ID = "ls-section-live";

/**
 * Live sessions (issue #3135, ported in PRD #3148 S2) — every Claude Code
 * session of this project whose transcript was written to recently.
 *
 * WHY IT EXISTS. The verdict band can read STALLED while three conversations
 * started by hand are mid-flight: the driver is not running, so as far as the
 * LOOP knows nothing is moving — but the operator's own sessions are exactly
 * the work that IS moving, and until #3135 nothing on the page showed them.
 * The data is `/api/live` (transcripts, never the store), so this section
 * stands whether or not `telemetry.db` exists.
 */
export function LiveSessions({
    data,
    nowMs,
}: {
    data: NowPayload;
    nowMs: number;
}) {
    const live = data.live;
    const liveMinutes = live?.liveMinutes ?? 30;
    const sessions = live?.sessions ?? [];
    const count = data.liveError == null ? sessions.length : null;

    return (
        <NowSection
            id={LIVE_SECTION_ID}
            term="section.live"
            title="Live sessions"
            meta={
                count === null
                    ? undefined
                    : `${count} in the last ${liveMinutes} min`
            }
        >
            {data.liveError != null ? (
                <Unavailable
                    reason={data.liveError}
                    consequence="cannot tell which sessions are running — not the same as none"
                />
            ) : sessions.length === 0 ? (
                <EmptyNote>
                    {`No session has written to its transcript in the last ${liveMinutes} minutes.`}
                </EmptyNote>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>
                                    <Term id="live.active">status</Term>
                                </TableHead>
                                <TableHead>
                                    <Term id="live.origin" />
                                </TableHead>
                                <TableHead>
                                    <Term id="live.session" />
                                </TableHead>
                                <TableHead>
                                    <Term id="live.branch" />
                                </TableHead>
                                <TableHead>
                                    <Term id="live.last" />
                                </TableHead>
                                <TableHead className="text-right">
                                    <Term id="live.tokens" />
                                </TableHead>
                                <TableHead className="text-right">
                                    <Term id="live.subagents" />
                                </TableHead>
                                <TableHead>
                                    <Term id="claim.session">issues named</Term>
                                </TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sessions.map((s) => {
                                const label = sessionLabel(s);
                                return (
                                    <TableRow key={s.session}>
                                        <TableCell>
                                            <LivenessBadge
                                                liveness={s.liveness}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <OriginBadge session={s} />
                                        </TableCell>
                                        <TableCell
                                            className="max-w-xs"
                                            title={s.session}
                                        >
                                            {label}
                                        </TableCell>
                                        <TableCell>
                                            {s.gitBranch ? (
                                                <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
                                                    {s.gitBranch}
                                                </code>
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    —
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {fmtAgoMs(s.lastWriteMs, nowMs)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {fmtTokens(s.outTok)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {s.subagents ? (
                                                s.subagents
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    —
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {(s.topIssues ?? []).length ? (
                                                <span className="flex gap-1.5">
                                                    {s.topIssues.map((t) => (
                                                        <IssueLink
                                                            key={t.issue}
                                                            issue={t.issue}
                                                        />
                                                    ))}
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    —
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <WatchButton
                                                session={s.session}
                                                label={label}
                                                issue={
                                                    s.topIssues?.[0]?.issue ??
                                                    null
                                                }
                                            />
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </NowSection>
    );
}

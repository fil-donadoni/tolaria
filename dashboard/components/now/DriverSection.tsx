import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { NowSection } from "./NowSection";
import { StateBadge } from "../StateBadge";
import { EmptyNote } from "../EmptyNote";
import { Term } from "../Term";
import { fmtPct, plural } from "../../lib/format";
import { SECTION_IDS } from "../../lib/nowLights";
import {
    PASS_TERM,
    PASS_TONE,
    PASS_WORD,
    passOutcome,
} from "../../lib/nowTimeline";
import type { NowPayload } from "../../lib/nowPayload";

/**
 * Driver (issue #3135, ported in PRD #3148 S2): the three process facts as
 * badges, then the recent passes as a table.
 *
 * The badges say each fact ON ITS OWN — the light above says the summary. That
 * split is why the 2026-08-19 outage's `armed · no driver pid · no stop-file`
 * is no longer the whole story: three equal grey clauses with no cause became
 * one verdict, one light and three separately-toned facts.
 *
 * A pass's outcome uses the timeline's own `passOutcome` mapping, never a
 * second reading of the same `reason` codes.
 */
export function DriverSection({ data }: { data: NowPayload }) {
    const d = data.driver ?? ({} as NowPayload["driver"]);
    const passes = d.recentPasses ?? [];
    return (
        <NowSection
            id={SECTION_IDS.driver}
            term="section.driver"
            title="Driver"
            meta={`last ${passes.length} ${plural(passes.length, "pass", "passes")}`}
        >
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                    {d.pid === null || d.pid === undefined ? (
                        <StateBadge tone="warn">no pid file</StateBadge>
                    ) : d.pidAlive ? (
                        <StateBadge tone="good">{`pid ${d.pid} alive`}</StateBadge>
                    ) : (
                        <StateBadge tone="bad">{`pid ${d.pid} dead`}</StateBadge>
                    )}
                    <StateBadge tone={d.armed ? "good" : "neutral"}>
                        {d.armed ? "handoff armed" : "handoff not armed"}
                    </StateBadge>
                    <StateBadge tone={d.stopFilePresent ? "warn" : "neutral"}>
                        {d.stopFilePresent
                            ? "stop-file present"
                            : "no stop-file"}
                    </StateBadge>
                </div>

                {passes.length === 0 ? (
                    <EmptyNote>No passes recorded.</EmptyNote>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-right">
                                        <Term id="pass.number" />
                                    </TableHead>
                                    <TableHead>
                                        <Term id="pass.outcome" />
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <Term id="pass.exit" />
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <Term id="pct">budget used</Term>
                                    </TableHead>
                                    <TableHead>
                                        <Term id="queue">
                                            queue before → after
                                        </Term>
                                    </TableHead>
                                    <TableHead>
                                        <Term id="pass.reason" />
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {passes.map((p) => {
                                    const outcome = passOutcome(p.reason);
                                    return (
                                        <TableRow key={p.pass}>
                                            <TableCell className="text-right tabular-nums">
                                                {p.pass}
                                            </TableCell>
                                            <TableCell>
                                                <StateBadge
                                                    tone={PASS_TONE[outcome]}
                                                    term={PASS_TERM[outcome]}
                                                >
                                                    {PASS_WORD[outcome]}
                                                </StateBadge>
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {p.claudeExit}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {fmtPct(p.pct)}
                                            </TableCell>
                                            <TableCell className="tabular-nums">
                                                {p.queueBefore} → {p.queueAfter}
                                            </TableCell>
                                            <TableCell>
                                                <code className="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">
                                                    {p.reason}
                                                </code>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
        </NowSection>
    );
}

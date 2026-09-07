import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { NowSection } from "./NowSection";
import { DynamicStat } from "./DynamicStat";
import { StateBadge } from "../StateBadge";
import { DynamicTerm } from "../DynamicTerm";
import { CopyButton } from "../CopyButton";
import { EmptyNote } from "../EmptyNote";
import { IssueLink } from "../IssueLink";
import { Term } from "../Term";
import { fmtClock } from "../../lib/format";
import { SECTION_IDS } from "../../lib/nowLights";
import { receiptStats } from "../../lib/nowReceipts";
import type { NowPayload } from "../../lib/nowPayload";

const EMPTY_SUMMARY = { total: 0, counts: [], interesting: [] };

/**
 * Batch (issue #3135, ported in PRD #3148 S2).
 *
 * The heading is `Batch #N · started HH:MM` — `#N` is `summary.total` reused
 * as a memorable stand-in for a real sequence number (this project keeps no
 * such counter, only a UUID directory name and an mtime), and the UUID itself
 * rides on the copy affordance beside it.
 *
 * Only rows that mean something is NOT simply done print individually
 * (`wip`/`failed`/`blocking`/`collision`, capped server-side); everything else
 * is visible as a COUNT. See `receiptStats` for why.
 */
export function BatchSection({ data }: { data: NowPayload }) {
    const summary = data.receiptsSummary ?? EMPTY_SUMMARY;

    if (data.batch == null) {
        return (
            <NowSection
                id={SECTION_IDS.batch}
                term="section.batch"
                title="Batch"
            >
                <EmptyNote>No batch has recorded receipts yet.</EmptyNote>
            </NowSection>
        );
    }

    const started = fmtClock(data.batchStartedAt);
    const rows = summary.interesting ?? [];

    return (
        <NowSection
            id={SECTION_IDS.batch}
            term="section.batch"
            title={`Batch #${summary.total}`}
            meta={
                <span className="flex flex-wrap items-center gap-2">
                    {started ? <span>started {started}</span> : null}
                    <CopyButton
                        text={data.batch}
                        label="copy id"
                        title={data.batch}
                    />
                </span>
            }
        >
            <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {receiptStats(summary).map((stat) => (
                        <DynamicStat
                            key={`${stat.term}:${stat.label}`}
                            stat={stat}
                        />
                    ))}
                </div>

                {rows.length > 0 ? (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>
                                        <Term id="issue" />
                                    </TableHead>
                                    <TableHead>
                                        <Term id="role" />
                                    </TableHead>
                                    <TableHead>
                                        <Term id="state">outcome</Term>
                                    </TableHead>
                                    <TableHead>
                                        <Term id="prs">PR</Term>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((r, i) =>
                                    r.role === "missing" ? (
                                        <TableRow
                                            key={`missing-${r.session ?? i}`}
                                        >
                                            <TableCell className="text-muted-foreground text-xs">
                                                missing · session {r.session}
                                            </TableCell>
                                            <TableCell>
                                                <StateBadge tone="neutral">
                                                    missing
                                                </StateBadge>
                                            </TableCell>
                                            <TableCell>—</TableCell>
                                            <TableCell>—</TableCell>
                                        </TableRow>
                                    ) : (
                                        <TableRow
                                            key={`${r.issue}-${r.role}-${i}`}
                                        >
                                            <TableCell>
                                                <IssueLink issue={r.issue!} />
                                            </TableCell>
                                            <TableCell>
                                                <StateBadge tone="neutral">
                                                    <DynamicTerm
                                                        term={`role.${r.role}`}
                                                    >
                                                        {r.role}
                                                    </DynamicTerm>
                                                </StateBadge>
                                            </TableCell>
                                            <TableCell>
                                                <StateBadge
                                                    tone={
                                                        r.outcome ===
                                                            "failed" ||
                                                        r.outcome === "blocking"
                                                            ? "bad"
                                                            : "warn"
                                                    }
                                                >
                                                    {r.outcome}
                                                </StateBadge>
                                            </TableCell>
                                            <TableCell>
                                                {r.pr ? `PR #${r.pr}` : "—"}
                                            </TableCell>
                                        </TableRow>
                                    )
                                )}
                            </TableBody>
                        </Table>
                    </div>
                ) : null}
            </div>
        </NowSection>
    );
}

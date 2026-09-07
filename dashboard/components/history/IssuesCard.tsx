import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Section } from "../Section";
import { Unavailable } from "../Unavailable";
import { IssueLink } from "../IssueLink";
import { fmtMin, fmtNum, fmtUsd, tier } from "../../lib/format";
import { fetchRunsForIssue } from "../../lib/historyQuery";
import type { IssueRow, IssuesPayload } from "../../lib/historyPayload";
import {
    EMPTY_ISSUE_FILTER,
    familyOf,
    filterIssues,
    fixupRate,
    type IssueFilterState,
} from "../../lib/historyRows";
import { nextSort, type SortState } from "../../lib/dataSort";
import { GLOSSARY } from "../../glossary";
import { DataTable } from "./DataTable";
import type { DataColumn } from "./DataColumn";
import { EmptyMark } from "./EmptyMark";
import { IssueFilters } from "./IssueFilters";
import { RunsPanel } from "./RunsPanel";
import { TruncatedCell } from "./TruncatedCell";

/**
 * The Issues card (PRD #3148 S3) — per-issue spend by role, sortable,
 * filterable, and expandable into the subagent runs behind each row. Ported
 * from `scripts/dashboard/history-issues-table.js` (#2625/#2634/#2635).
 *
 * COLUMN HEADERS RENDER THE GLOSSARY LABEL, never the raw abbreviation
 * (#2634: `impl '` → "implement minutes", `fix ×` → "fixup rounds"). The
 * column's `key` stays the raw field name because it is the SORT IDENTITY —
 * relabelling a header must not be able to break its sort.
 *
 * THE GRAND TOTAL NEVER FALLS BACK TO THE EMPTY MARK. A per-role subtotal of
 * `$0` means that role did nothing on this issue; the total is a measurement
 * even at exactly zero, and rendering it as an em dash would say "not
 * recorded" about a number that was.
 */

/** A cost cell that is empty when nothing was spent — used for the per-ROLE
 *  subtotals only; see the header note. */
const roleCost = (v: number | null): ReactNode =>
    v ? fmtUsd(v) : <EmptyMark />;

const roleMinutes = (v: number | null): ReactNode =>
    v ? fmtMin(v) : <EmptyMark />;

const COLUMNS: readonly DataColumn<IssueRow>[] = [
    {
        key: "issue",
        num: true,
        cell: (r) => (
            <span className="flex max-w-[22rem] items-baseline gap-1">
                <IssueLink issue={r.issue} />
                <TruncatedCell text={r.title ?? ""} />
            </span>
        ),
    },
    {
        key: "first_ts",
        num: true,
        cell: (r) =>
            new Date(r.first_ts * 1000).toLocaleDateString([], {
                month: "2-digit",
                day: "2-digit",
            }),
    },
    { key: "family", cell: (r) => familyOf(r) },
    { key: "impl_model", cell: (r) => tier(r.impl_model) },
    { key: "impl_min", num: true, cell: (r) => roleMinutes(r.impl_min) },
    { key: "impl_cost", num: true, cell: (r) => roleCost(r.impl_cost) },
    { key: "rev_min", num: true, cell: (r) => roleMinutes(r.rev_min) },
    { key: "rev_cost", num: true, cell: (r) => roleCost(r.rev_cost) },
    {
        key: "fixups",
        num: true,
        cell: (r) => (r.fixups ? `${r.fixups}×` : <EmptyMark />),
    },
    { key: "fix_min", num: true, cell: (r) => roleMinutes(r.fix_min) },
    { key: "fix_cost", num: true, cell: (r) => roleCost(r.fix_cost) },
    { key: "other_min", num: true, cell: (r) => roleMinutes(r.other_min) },
    { key: "other_cost", num: true, cell: (r) => roleCost(r.other_cost) },
    { key: "runs", num: true, cell: (r) => r.runs ?? <EmptyMark /> },
    { key: "latency_min", num: true, cell: (r) => roleMinutes(r.latency_min) },
    { key: "out_tok", num: true, cell: (r) => fmtNum(r.out_tok, true) },
    {
        key: "cost",
        num: true,
        cell: (r) => <b>{fmtUsd(r.cost)}</b>,
    },
    {
        key: "state",
        cell: (r) =>
            r.state === "closed" ? (
                <span role="img" aria-label="closed">
                    ✅
                </span>
            ) : (
                (r.state ?? "?")
            ),
    },
];

export function IssuesCard({
    payload,
    error,
}: {
    payload: IssuesPayload | null;
    /** The narrative read's own error channel — a failed `/api/issues` leaves
     *  the chart cards drawn, and vice versa. */
    error: string | null;
}) {
    const [filter, setFilter] = useState<IssueFilterState>(EMPTY_ISSUE_FILTER);
    const [sort, setSort] = useState<SortState>({ key: "cost", dir: -1 });
    const [expanded, setExpanded] = useState<string | null>(null);

    // Memoised so the identity is stable across renders — a fresh `[]`
    // every render would re-run the filter below on every keystroke
    // anywhere on the page.
    const rows = useMemo(() => payload?.rows ?? [], [payload]);
    const visible = useMemo(() => filterIssues(rows, filter), [rows, filter]);

    const loadRuns = useCallback(
        () => fetchRunsForIssue(Number(expanded)),
        [expanded]
    );

    return (
        <Section
            title="Issues"
            meta={`Per-issue spend by role. Fixup-rate — ${fixupRate(payload?.tiers)}. Click a header to sort, a row for its runs.`}
        >
            {error ? (
                <Unavailable
                    reason={`could not read the issue rows: ${error}`}
                    consequence="Per-issue spend and the fixup rate are unknown for this range."
                />
            ) : (
                <>
                    <IssueFilters
                        rows={rows}
                        value={filter}
                        onChange={setFilter}
                    />
                    <DataTable
                        caption="Per-issue spend by role"
                        columns={COLUMNS}
                        rows={visible}
                        rowKey={(r) => String(r.issue)}
                        sort={sort}
                        onSort={(key) => setSort(nextSort(sort, key))}
                        emptyMessage={
                            rows.length
                                ? GLOSSARY["empty.issues.filtered"].tip
                                : GLOSSARY["empty.issues.none"].tip
                        }
                        expandedKey={expanded}
                        onToggleRow={(r) =>
                            setExpanded((cur) =>
                                cur === String(r.issue) ? null : String(r.issue)
                            )
                        }
                        renderExpanded={(r) => (
                            <RunsPanel
                                load={loadRuns}
                                caption={`Subagent runs for issue #${r.issue}`}
                            />
                        )}
                    />
                </>
            )}
        </Section>
    );
}

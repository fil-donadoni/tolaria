import { useCallback, useMemo, useState } from "react";
import { Section } from "../Section";
import { Unavailable } from "../Unavailable";
import { fmtDur, fmtMin, fmtUsd } from "../../lib/format";
import { fetchRunsForSession } from "../../lib/historyQuery";
import type { SessionRow, SessionsPayload } from "../../lib/historyPayload";
import {
    EMPTY_SESSION_FILTER,
    filterSessions,
    prCount,
    prList,
    type SessionFilterState,
} from "../../lib/historyRows";
import { nextSort, type SortState } from "../../lib/dataSort";
import { GLOSSARY } from "../../glossary";
import { DataTable } from "./DataTable";
import type { DataColumn } from "./DataColumn";
import { EmptyMark } from "./EmptyMark";
import { RunsPanel } from "./RunsPanel";
import { SessionFilters } from "./SessionFilters";
import { SessionsPrCell } from "./SessionsPrCell";
import { TruncatedCell } from "./TruncatedCell";

/**
 * The Sessions card (PRD #3148 S3) — one row per session in range, expandable
 * into its subagent runs. Ported from
 * `scripts/dashboard/history-sessions-table.js` (#2625/#2634/#2635).
 *
 * `term` overrides `key` for the glossary lookup on exactly one column:
 * `title` renders `history.session-title`, not the bare `session` dimension
 * entry, whose tip says the id is "deliberately absent from the filter
 * pickers" — misleading here, since this table DOES search over it (#2634
 * review). `key` alone drives sorting.
 *
 * `prs` is the one column whose sort value is not a field on the row: the
 * column renders a COUNT of a JSON array the row carries as a string, so it
 * declares `sortValue` and sorts by that count rather than by the string's
 * lexical order.
 */
const COLUMNS: readonly DataColumn<SessionRow>[] = [
    {
        key: "title",
        term: "history.session-title",
        cell: (r) => (
            <span className="block max-w-[18rem]">
                <TruncatedCell text={r.title ?? r.session.slice(0, 8)} />
            </span>
        ),
    },
    {
        key: "cmd",
        cell: (r) => (
            <span className="block max-w-[16rem]">
                <TruncatedCell text={r.cmd ?? "—"} />
            </span>
        ),
    },
    {
        key: "t0",
        num: true,
        cell: (r) =>
            new Date(r.t0 * 1000).toLocaleString([], {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            }),
    },
    {
        key: "wall_min",
        num: true,
        // Stored in minutes, read as elapsed time: `fmtDur` takes seconds.
        cell: (r) => fmtDur((r.wall_min ?? 0) * 60),
    },
    {
        key: "impl_min",
        num: true,
        cell: (r) => (r.impl_min ? fmtMin(r.impl_min) : <EmptyMark />),
    },
    {
        key: "rev_min",
        num: true,
        cell: (r) => (r.rev_min ? fmtMin(r.rev_min) : <EmptyMark />),
    },
    {
        key: "fix_min",
        num: true,
        cell: (r) => (r.fix_min ? fmtMin(r.fix_min) : <EmptyMark />),
    },
    {
        key: "other_min",
        num: true,
        cell: (r) => (r.other_min ? fmtMin(r.other_min) : <EmptyMark />),
    },
    { key: "issues", num: true, cell: (r) => r.issues ?? <EmptyMark /> },
    {
        key: "prs",
        num: true,
        sortValue: prCount,
        cell: (r) => <SessionsPrCell prs={prList(r)} />,
    },
    { key: "orch_cost", num: true, cell: (r) => fmtUsd(r.orch_cost) },
    { key: "cost", num: true, cell: (r) => <b>{fmtUsd(r.cost)}</b> },
];

export function SessionsCard({
    payload,
    error,
}: {
    payload: SessionsPayload | null;
    error: string | null;
}) {
    const [filter, setFilter] =
        useState<SessionFilterState>(EMPTY_SESSION_FILTER);
    const [sort, setSort] = useState<SortState>({ key: "t0", dir: -1 });
    const [expanded, setExpanded] = useState<string | null>(null);

    const rows = payload?.rows ?? [];
    const visible = useMemo(() => filterSessions(rows, filter), [rows, filter]);

    const loadRuns = useCallback(
        () => fetchRunsForSession(expanded ?? ""),
        [expanded]
    );

    return (
        <Section
            title="Sessions"
            meta="One row per session in range. Click a header to sort, a row for its agent runs."
        >
            {error ? (
                <Unavailable
                    reason={`could not read the session rows: ${error}`}
                    consequence="Per-session wall clock and spend are unknown for this range."
                />
            ) : (
                <>
                    <SessionFilters
                        rows={rows}
                        value={filter}
                        onChange={setFilter}
                    />
                    <DataTable
                        caption="Sessions in range"
                        columns={COLUMNS}
                        rows={visible}
                        rowKey={(r) => r.session}
                        sort={sort}
                        onSort={(key) => setSort(nextSort(sort, key))}
                        emptyMessage={
                            rows.length
                                ? GLOSSARY["empty.sessions.filtered"].tip
                                : GLOSSARY["empty.sessions.none"].tip
                        }
                        expandedKey={expanded}
                        onToggleRow={(r) =>
                            setExpanded((cur) =>
                                cur === r.session ? null : r.session
                            )
                        }
                        renderExpanded={(r) => (
                            <RunsPanel
                                load={loadRuns}
                                caption={`Subagent runs for session ${r.title ?? r.session}`}
                            />
                        )}
                    />
                </>
            )}
        </Section>
    );
}

import { useEffect, useState } from "react";
import { fmtNum, fmtUsd, tier } from "../../lib/format";
import type { RunRow, RunsPayload } from "../../lib/historyPayload";
import { DataTable } from "./DataTable";
import type { DataColumn } from "./DataColumn";
import { TruncatedCell } from "./TruncatedCell";

/**
 * A row's drill-down (PRD #3148 S3) — the subagent runs under one issue or one
 * session, ported from `scripts/dashboard/history-drilldown.js` (#2625).
 *
 * SHARED VERBATIM by the Issues and the Sessions tables, which differ only in
 * the `/api/runs` query they pass. That was true of the vanilla module too and
 * is the reason it existed; what the port adds is that the fetch's three
 * outcomes are now STATES rather than a row that silently never appears.
 *
 * A failed read renders as a failed read. The vanilla version did
 * `await (await fetch(url)).json()` with no catch at all: a rejected request
 * left the row expanded and empty, which reads as "this issue had no runs".
 * That is the same confusion `Unavailable` exists to kill on the Now view.
 */

const COLUMNS: readonly DataColumn<RunRow>[] = [
    {
        key: "agent",
        label: "agent",
        fixed: true,
        cell: (r) => <TruncatedCell text={r.description ?? r.agent_id} />,
    },
    { key: "role", fixed: true, cell: (r) => r.role },
    { key: "model", label: "tier", fixed: true, cell: (r) => tier(r.model) },
    { key: "min", label: "min", fixed: true, cell: (r) => `${r.min}'` },
    { key: "msgs", label: "msgs", fixed: true, cell: (r) => r.msgs },
    {
        key: "avg_ctx_k",
        label: "avg ctx",
        fixed: true,
        cell: (r) => `${r.avg_ctx_k}k`,
    },
    {
        key: "out_tok",
        fixed: true,
        cell: (r) => fmtNum(r.out_tok, true),
    },
    { key: "cost", fixed: true, cell: (r) => fmtUsd(r.cost) },
];

export function RunsPanel({
    load,
    caption,
}: {
    /** The `/api/runs` read for THIS row — the one thing the two callers
     *  differ in. */
    load: () => Promise<RunsPayload>;
    caption: string;
}) {
    const [rows, setRows] = useState<RunRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        setRows(null);
        setError(null);
        load()
            .then((payload) => {
                if (live) setRows(payload.rows);
            })
            .catch((e: unknown) => {
                if (live) setError(e instanceof Error ? e.message : String(e));
            });
        return () => {
            live = false;
        };
    }, [load]);

    if (error)
        return (
            <div role="status" className="text-state-bad px-3 py-2 text-xs">
                could not read this row&rsquo;s runs: {error}
            </div>
        );
    if (!rows)
        return (
            <div className="text-muted-foreground px-3 py-2 text-xs">
                loading runs…
            </div>
        );

    return (
        <div className="p-2">
            <DataTable
                columns={COLUMNS}
                rows={rows}
                rowKey={(r) => r.agent_id}
                sort={null}
                emptyMessage="No subagent runs recorded for this row."
                caption={caption}
            />
        </div>
    );
}

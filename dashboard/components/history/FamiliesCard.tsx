import { useMemo } from "react";
import { Section } from "../Section";
import { Unavailable } from "../Unavailable";
import { fmtUsd, mc } from "../../lib/format";
import type { FamiliesPayload } from "../../lib/historyPayload";
import {
    pivotFamilies,
    ROLE_COLS,
    type FamilyPivotRow,
} from "../../lib/historyRows";
import { GLOSSARY } from "../../glossary";
import { DataTable } from "./DataTable";
import type { DataColumn } from "./DataColumn";
import { EmptyMark } from "./EmptyMark";

/**
 * The "Agent family × role" pivot (PRD #3148 S3) — families as rows, agent
 * roles as columns. Ported from
 * `scripts/dashboard/history-families-table.js` (#2625/#2634).
 *
 * FIXED ORDER, descending by total cost, with no interactive sort — as before
 * this port. Every column is declared `fixed`, which is what turns the header
 * back into a plain cell rather than a button that promises an ordering it
 * cannot deliver.
 *
 * The role columns already read as plain English, so relabelling is not the
 * point: each gets its OWN glossary tooltip (`role.<name>`) instead of one
 * generic dimension tip repeated four times (#2634). The total column's label
 * is the glossary's own, never a hand-maintained literal — `cost`'s label
 * already reads correctly here.
 *
 * TITLE AND SUBTITLE ARE STATIC GLOSSARY COPY, rendered unconditionally. In
 * the vanilla code they were written from inside the narrative fetch, so any
 * one of three failed reads left the card with no subtitle at all (#2634
 * review finding 2); `history-refresh.js` moved the two writes out ahead of
 * the awaits to fix it. Here the card renders its own copy on every render,
 * including the render where `error` is set, so the ordering that fix arranged
 * is structural.
 */
const COLUMNS: readonly DataColumn<FamilyPivotRow>[] = [
    { key: "family", fixed: true, cell: (r) => r.family },
    { key: "issues", fixed: true, cell: (r) => r.issues },
    ...ROLE_COLS.map(
        (role): DataColumn<FamilyPivotRow> => ({
            key: role,
            term: `role.${role}`,
            fixed: true,
            cell: (r) => {
                const cell = r.roles[role];
                return cell ? mc(cell.minutes, cell.cost) : <EmptyMark />;
            },
        })
    ),
    { key: "cost", fixed: true, cell: (r) => <b>{fmtUsd(r.total)}</b> },
];

export function FamiliesCard({
    payload,
    error,
}: {
    payload: FamiliesPayload | null;
    error: string | null;
}) {
    const rows = useMemo(
        () => pivotFamilies(payload?.rows ?? []),
        [payload?.rows]
    );

    return (
        <Section
            title={GLOSSARY["card.family-role"].label}
            meta={GLOSSARY["card.family-role"].tip}
        >
            {error ? (
                <Unavailable
                    reason={`could not read the family rows: ${error}`}
                    consequence="Which agent families are spending the time is unknown for this range."
                />
            ) : (
                <DataTable
                    caption="Agent family by role"
                    columns={COLUMNS}
                    rows={rows}
                    rowKey={(r) => r.family}
                    sort={null}
                    emptyMessage={GLOSSARY["empty.families.none"].tip}
                />
            )}
        </Section>
    );
}

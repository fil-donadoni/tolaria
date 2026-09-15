// The resolution outbox (issue #3582, ADR 0128 §5/§6): how an admin's decision
// about a Contested Position becomes an immutable object in the Verdict Store.
//
// The same one-way door a judgement takes (`verdictsOutbox.ts`), for the same
// reason: the admin decides in a browser, the store is reached only through
// the deployment's write credential in a `"use node"` action, and a click must
// be safe the moment it lands. So `verdictResolutions.record` writes a row, the
// drain uploads it and READS IT BACK, and only then is the row marked stored.
// A resolution row is small — a position key, a handful of ids and reasons —
// so unlike a verdict row it is never slimmed: `storedAt` is the whole
// transition. A deployment without the write key (every local backend) keeps
// its rows pending forever, and the review surface reads them from the table.
//
// Decisions only: no credential, no Convex function. Exercised against the
// in-memory store; reachable from the `"use node"` drain, so it imports the
// store port and the pure resolution module and nothing else.

import type { VerdictResolution } from "./gre/ai/verdicts/types";
import {
    putResolution,
    readResolution,
    type VerdictStorePutOutcome,
    type VerdictStoreWriter,
} from "./verdictStore";

/** A `verdictResolutions` row as the outbox reads it. */
export interface ResolutionOutboxRow {
    _id: string;
    positionKey: string;
    /** The id `record` computed — the drain refuses to store a row whose
     *  decision no longer hashes to it. */
    resolutionId: string;
    acceptedVerdictId: string | null;
    rejected: { verdictId: string; reason: string }[];
    /** `${deployment}:${userId}` of the resolver. */
    resolverAuthor: string;
    createdAt: number;
    note?: string;
    deployment: string;
    deploymentKind: "cloud" | "local";
    storedAt?: number;
}

/** The resolution a row stands for. */
export function resolutionOfRow(row: ResolutionOutboxRow): VerdictResolution {
    return {
        positionKey: row.positionKey,
        acceptedVerdictId: row.acceptedVerdictId,
        rejected: row.rejected,
        author: row.resolverAuthor,
        createdAt: row.createdAt,
        ...(row.note === undefined ? {} : { note: row.note }),
        deployment: row.deployment,
        deploymentKind: row.deploymentKind,
    };
}

export type ResolutionStoreResult =
    | {
          status: "stored";
          rowId: string;
          resolutionId: string;
          outcome: VerdictStorePutOutcome;
      }
    | { status: "pending"; rowId: string; reason: string };

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Upload one row's resolution and confirm it by re-reading. Never throws:
 *  one bad row must not stop a drain from storing the rest. */
export async function storeResolutionRow(
    store: VerdictStoreWriter,
    row: ResolutionOutboxRow
): Promise<ResolutionStoreResult> {
    const rowId = row._id;
    const pending = (reason: string): ResolutionStoreResult => ({
        status: "pending",
        rowId,
        reason,
    });
    const resolution = resolutionOfRow(row);
    let resolutionId: string;
    let outcome: VerdictStorePutOutcome;
    try {
        const put = await putResolution(store, resolution);
        resolutionId = put.resolutionId;
        outcome = put.outcome;
    } catch (error) {
        return pending(`upload failed: ${messageOf(error)}`);
    }
    // Stored under another name than the row promised: the canonicalisation
    // moved since `record` ran. The object is harmless (it is a decision in
    // its own right), but marking this row stored would say the store holds
    // a name it does not, so the row waits for a human.
    if (resolutionId !== row.resolutionId) {
        return pending(
            `stored as ${resolutionId}, not as the recorded ${row.resolutionId}`
        );
    }
    try {
        if (
            (await readResolution(store, row.positionKey, resolutionId)) ===
            null
        ) {
            return pending(
                `${resolutionId} is not in the store after its upload`
            );
        }
    } catch (error) {
        return pending(`re-read failed: ${messageOf(error)}`);
    }
    return { status: "stored", rowId, resolutionId, outcome };
}

/** Everything a resolution drain needs, injected. */
export interface ResolutionDrainPorts {
    store: VerdictStoreWriter;
    now: () => number;
    pendingResolutions: () => Promise<ResolutionOutboxRow[]>;
    markResolutionStored: (args: {
        rowId: string;
        resolutionId: string;
        storedAt: number;
    }) => Promise<void>;
}

export type ResolutionDrainReport = {
    stored: number;
    pending: { rowId: string; reason: string }[];
};

/** Store every pending resolution row, marking each only after its re-read. */
export async function drainResolutionOutbox(
    ports: ResolutionDrainPorts
): Promise<ResolutionDrainReport> {
    const report: ResolutionDrainReport = { stored: 0, pending: [] };
    for (const row of await ports.pendingResolutions()) {
        const result = await storeResolutionRow(ports.store, row);
        if (result.status === "pending") {
            report.pending.push({ rowId: result.rowId, reason: result.reason });
            continue;
        }
        try {
            await ports.markResolutionStored({
                rowId: result.rowId,
                resolutionId: result.resolutionId,
                storedAt: ports.now(),
            });
            report.stored += 1;
        } catch (error) {
            report.pending.push({
                rowId: result.rowId,
                reason: `marking stored failed: ${messageOf(error)}`,
            });
        }
    }
    return report;
}

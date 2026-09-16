// The Verdict outbox (issue #3580, PRD #3574, ADR 0128 §5): how a row in the
// `verdicts` table becomes an immutable object in the Verdict Store, and when
// the row may forget the judgement it carries.
//
// THE TABLE IS AN OUTBOX, NOT THE CORPUS. `verdicts.submit` validates a
// judgement and writes it here FAT — the whole position, candidates and
// answer — stamped with its `verdictHash` and `positionKey`. A drain
// (`verdictsDrain.ts`, the only code holding the write credential) uploads the
// verdict object, then its attestation, READS BOTH BACK, and only then asks
// `verdicts.markStored` to slim the row. Until that re-read confirms the bytes,
// the row is the only copy of the judgement, so nothing short of a confirmed
// store ever drops a fat field: a failed put, a put that "succeeded" but left
// nothing behind, an object the store holds under the name but with other
// bytes — each leaves the row fat and pending, and the next drain retries it.
//
// IDEMPOTENT BY CONSTRUCTION, not by bookkeeping. Both object names are
// decided by content (the verdict id; the verdict id and the author), and the
// port never overwrites, so a second drain of a row whose slimming was lost —
// or two drains racing — writes nothing new: both puts answer `"exists"`, both
// re-reads confirm, and `markStored` on a row already slim is a no-op.
//
// This module decides; it holds no credential and runs no Convex function. It
// is exercised against the in-memory store (`verdictStoreMemory.ts`), and it
// imports no engine code beyond the pure identity module, because the `"use
// node"` drain reaches it (`scripts/__tests__/convex-node-bundle-seam.test.ts`).

import {
    positionKeyOf,
    verdictIdOf,
    type VerdictJudgement,
} from "./gre/ai/verdicts/identity";
import type {
    VerdictAnswer,
    VerdictAttestation,
    VerdictCandidate,
} from "./gre/ai/verdicts/types";
import { isLocalDeploymentUrl } from "./lib/uiGateLaneAccount";
import {
    VERDICT_DEPLOYMENT_NAME_PATTERN,
    putAttestation,
    putVerdict,
    readAttestation,
    readVerdict,
    verdictAuthorOf,
    type VerdictStorePutOutcome,
    type VerdictStoreWriter,
} from "./verdictStore";

/** Where a judgement entered the outbox. */
export type VerdictDeployment = {
    /** The deployment's name (`jovial-guineapig-250`), or `local-<port>`. */
    name: string;
    /** `local` marks test traffic (issue #3580) — rows and attestations from a
     *  local backend stay filterable wherever they end up. */
    kind: "cloud" | "local";
};

const CONVEX_CLOUD_HOST_SUFFIX = ".convex.cloud";

/**
 * The deployment a function is running on, from its `CONVEX_CLOUD_URL` (set
 * by Convex for every function, local backends included).
 *
 * FAILS CLOSED: a deployment that cannot say where it is cannot attribute a
 * judgement, and an author with a guessed deployment half would be one person
 * silently merged with — or split from — themselves.
 */
export function verdictDeploymentOf(
    url: string | undefined
): VerdictDeployment {
    let parsed: URL;
    try {
        parsed = new URL(url ?? "");
    } catch {
        throw new Error(
            `cannot attribute a verdict: CONVEX_CLOUD_URL ${JSON.stringify(url)} does not name a deployment`
        );
    }
    const name = isLocalDeploymentUrl(url)
        ? `local-${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`
        : parsed.hostname.endsWith(CONVEX_CLOUD_HOST_SUFFIX)
          ? parsed.hostname.slice(0, -CONVEX_CLOUD_HOST_SUFFIX.length)
          : parsed.hostname;
    if (!VERDICT_DEPLOYMENT_NAME_PATTERN.test(name)) {
        throw new Error(
            `cannot attribute a verdict: ${JSON.stringify(name)} is not a deployment name`
        );
    }
    return {
        name,
        kind: isLocalDeploymentUrl(url) ? "local" : "cloud",
    };
}

/** A `verdicts` row as the outbox reads it — fat while pending, slim after.
 *  Structural rather than `Doc<"verdicts">` so the node drain's import graph
 *  does not need the generated data model. */
export interface OutboxRow {
    _id: string;
    // The judgement — present while pending, dropped by `markStored`.
    spec?: unknown;
    setup?: unknown[];
    seat?: "me" | "opp";
    deckKnowledge?: { seat: "me" | "opp"; cards: string[] }[];
    candidates?: VerdictCandidate[];
    answer?: VerdictAnswer;
    botPickIndex?: number;
    seq?: number;
    // Provenance — kept on the slim row.
    gameId?: string;
    authorId?: string;
    author: string;
    attestationAuthor?: string;
    deployment?: string;
    deploymentKind?: "cloud" | "local";
    createdAt: number;
    note?: string;
    verdictHash?: string;
    positionKey?: string;
    storedAt?: number;
}

/** The judgement a row still carries, or `null` once it has been slimmed. */
export function judgementOfRow(row: OutboxRow): VerdictJudgement | null {
    if (
        row.spec === undefined ||
        row.seat === undefined ||
        row.candidates === undefined ||
        row.answer === undefined
    ) {
        return null;
    }
    return {
        spec: row.spec as VerdictJudgement["spec"],
        ...(row.setup === undefined
            ? {}
            : { setup: row.setup as VerdictJudgement["setup"] }),
        seat: row.seat,
        ...(row.deckKnowledge === undefined
            ? {}
            : { deckKnowledge: row.deckKnowledge }),
        candidates: row.candidates,
        answer: row.answer,
    };
}

/** Both hashes of a judgement — what `submit` stamps and `markStored`
 *  re-derives before it lets a row forget anything. */
export function verdictStampOf(judgement: VerdictJudgement): {
    verdictHash: string;
    positionKey: string;
} {
    return {
        verdictHash: verdictIdOf(judgement),
        positionKey: positionKeyOf(judgement),
    };
}

/** Who and where a row's attestation names. A row stamped by `submit` carries
 *  both; a row written before the outbox existed carries neither, and was
 *  necessarily written on the deployment now draining it (a drain only ever
 *  reads its own table), so `here` and its `authorId` are the truth. */
export function attributionOfRow(
    row: OutboxRow,
    here: VerdictDeployment
): {
    attestationAuthor: string;
    deployment: string;
    deploymentKind: "cloud" | "local";
} {
    if (row.attestationAuthor !== undefined) {
        return {
            attestationAuthor: row.attestationAuthor,
            deployment: row.deployment ?? here.name,
            deploymentKind: row.deploymentKind ?? here.kind,
        };
    }
    if (row.authorId === undefined) {
        throw new Error(`verdict row ${row._id} names no author to attest`);
    }
    return {
        attestationAuthor: verdictAuthorOf(here.name, row.authorId),
        deployment: here.name,
        deploymentKind: here.kind,
    };
}

/** The attestation a row stands for — what the drain uploads, and what the
 *  review surface reads for a row not yet stored (issue #3582), so a local
 *  backend's pending judgement is attested exactly as its object will be. */
export function attestationOfRow(
    row: OutboxRow,
    verdictId: string,
    attribution: ReturnType<typeof attributionOfRow>
): VerdictAttestation {
    return {
        verdictId,
        author: attribution.attestationAuthor,
        // Every row the outbox holds is a judgement a person GAVE — in play or
        // through the bulk door. No producer of implicit judgements exists yet
        // (ADR 0128 §11); the day one does, it names its axis on the row.
        sourceAxis: "explicit",
        createdAt: row.createdAt,
        ...(row.note === undefined ? {} : { note: row.note }),
        deployment: attribution.deployment,
        deploymentKind: attribution.deploymentKind,
        ...(row.botPickIndex === undefined
            ? {}
            : { botPickIndex: row.botPickIndex }),
        ...(row.gameId === undefined ? {} : { gameId: row.gameId }),
        ...(row.seq === undefined ? {} : { seq: row.seq }),
    };
}

/** What storing one row came to. */
export type OutboxStoreResult =
    | {
          status: "stored";
          rowId: string;
          verdictHash: string;
          positionKey: string;
          attestationAuthor: string;
          deployment: string;
          deploymentKind: "cloud" | "local";
          verdict: VerdictStorePutOutcome;
          attestation: VerdictStorePutOutcome;
      }
    | { status: "already-slim"; rowId: string }
    | { status: "pending"; rowId: string; reason: string };

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** A fat row made ready to store: its judgement, both hashes, who attests it
 *  and the attestation itself — or why it cannot be stored. Shared by the
 *  direct upload and the forward (`verdictForward.ts`), so a row forwarded to
 *  the writer passes exactly the checks a row uploaded here does. */
export type PreparedOutboxRow =
    | {
          status: "ready";
          judgement: VerdictJudgement;
          stamp: { verdictHash: string; positionKey: string };
          attribution: ReturnType<typeof attributionOfRow>;
          attestation: VerdictAttestation;
      }
    | { status: "already-slim"; rowId: string }
    | { status: "pending"; rowId: string; reason: string };

export function prepareOutboxRow(
    row: OutboxRow,
    here: VerdictDeployment
): PreparedOutboxRow {
    const rowId = row._id;
    const pending = (reason: string): PreparedOutboxRow => ({
        status: "pending",
        rowId,
        reason,
    });
    const judgement = judgementOfRow(row);
    if (judgement === null) return { status: "already-slim", rowId };

    let stamp: { verdictHash: string; positionKey: string };
    let attribution: ReturnType<typeof attributionOfRow>;
    try {
        stamp = verdictStampOf(judgement);
        attribution = attributionOfRow(row, here);
    } catch (error) {
        return pending(messageOf(error));
    }
    // A stamp that disagrees with the judgement it sits beside means the
    // canonicalisation moved since `submit` ran. Uploading would store the
    // judgement under a name the row never promised — and the row would then
    // slim to a hash that names nothing — so it waits for a human instead.
    if (
        row.verdictHash !== undefined &&
        row.verdictHash !== stamp.verdictHash
    ) {
        return pending(
            `stamped ${row.verdictHash}, but the judgement now hashes to ${stamp.verdictHash}`
        );
    }
    if (
        row.positionKey !== undefined &&
        row.positionKey !== stamp.positionKey
    ) {
        return pending(
            `stamped position key ${row.positionKey}, but the judgement now keys to ${stamp.positionKey}`
        );
    }
    return {
        status: "ready",
        judgement,
        stamp,
        attribution,
        attestation: attestationOfRow(row, stamp.verdictHash, attribution),
    };
}

/**
 * Upload one row's verdict object and attestation, then confirm both by
 * re-reading. Never throws: every failure is a `pending` result naming why,
 * because one bad row must not stop a drain from storing the rest.
 */
export async function storeOutboxRow(
    store: VerdictStoreWriter,
    row: OutboxRow,
    here: VerdictDeployment
): Promise<OutboxStoreResult> {
    const rowId = row._id;
    const pending = (reason: string): OutboxStoreResult => ({
        status: "pending",
        rowId,
        reason,
    });
    const prepared = prepareOutboxRow(row, here);
    if (prepared.status !== "ready") return prepared;
    const { judgement, stamp, attribution, attestation } = prepared;

    let verdictOutcome: VerdictStorePutOutcome;
    let attestationOutcome: VerdictStorePutOutcome;
    try {
        // The verdict object BEFORE its attestation: an attestation naming a
        // verdict the store does not hold is what `classifyVerdicts` refuses
        // loudly, so the store must never be left in that state even briefly.
        const put = await putVerdict(store, judgement);
        if (put.verdictId !== stamp.verdictHash) {
            return pending(
                `stored as ${put.verdictId}, not as the stamped ${stamp.verdictHash}`
            );
        }
        verdictOutcome = put.outcome;
        attestationOutcome = (await putAttestation(store, attestation)).outcome;
    } catch (error) {
        return pending(`upload failed: ${messageOf(error)}`);
    }

    // THE RE-READ. A put's answer is the transport's word; the bytes coming
    // back — verified against their names by the decoders — are the store's.
    try {
        if ((await readVerdict(store, stamp.verdictHash)) === null) {
            return pending(
                `${stamp.verdictHash} is not in the store after its upload`
            );
        }
        if (
            (await readAttestation(
                store,
                stamp.verdictHash,
                attribution.attestationAuthor
            )) === null
        ) {
            return pending(
                `the attestation of ${stamp.verdictHash} by ${attribution.attestationAuthor} is not in the store after its upload`
            );
        }
    } catch (error) {
        return pending(`re-read failed: ${messageOf(error)}`);
    }

    return {
        status: "stored",
        rowId,
        ...stamp,
        ...attribution,
        verdict: verdictOutcome,
        attestation: attestationOutcome,
    };
}

/** One page of pending rows, as `verdicts.pendingPage` returns it. */
export type OutboxPage = {
    rows: OutboxRow[];
    cursor: string;
    isDone: boolean;
};

/** How a drain stores one row: uploaded here with the write key
 *  (`directOutboxStore`), or forwarded to the deployment holding it
 *  (`verdictForward.ts`, issue #3745). Either way it never throws. */
export type OutboxRowStore = (row: OutboxRow) => Promise<OutboxStoreResult>;

/** The direct way: this deployment holds the write key. */
export function directOutboxStore(
    store: VerdictStoreWriter,
    here: VerdictDeployment
): OutboxRowStore {
    return (row) => storeOutboxRow(store, row, here);
}

/** Everything a drain needs, injected — the node action binds these to the
 *  GCS writer (or the forward) and the two internal functions; a test binds
 *  them to fakes. */
export interface OutboxDrainPorts {
    storeRow: OutboxRowStore;
    now: () => number;
    pendingPage: (cursor: string | null) => Promise<OutboxPage>;
    markStored: (args: {
        rowId: string;
        verdictHash: string;
        positionKey: string;
        attestationAuthor: string;
        deployment: string;
        deploymentKind: "cloud" | "local";
        storedAt: number;
    }) => Promise<"slimmed" | "already-slim">;
}

/** What a drain did. `pending` names every row left fat, and why. */
export type OutboxDrainReport = {
    stored: number;
    alreadySlim: number;
    pending: { rowId: string; reason: string }[];
};

/** Store every pending row, slimming each only after its re-read confirms. */
export async function drainOutbox(
    ports: OutboxDrainPorts
): Promise<OutboxDrainReport> {
    const report: OutboxDrainReport = {
        stored: 0,
        alreadySlim: 0,
        pending: [],
    };
    let cursor: string | null = null;
    for (;;) {
        const page: OutboxPage = await ports.pendingPage(cursor);
        for (const row of page.rows) {
            const result = await ports.storeRow(row);
            if (result.status === "pending") {
                report.pending.push({
                    rowId: result.rowId,
                    reason: result.reason,
                });
                continue;
            }
            if (result.status === "already-slim") {
                report.alreadySlim += 1;
                continue;
            }
            // A row `markStored` refuses (deleted, re-stamped by a racing
            // drain) stays as it is and is reported — one bad row must not
            // cost the report for every row after it.
            let marked: "slimmed" | "already-slim";
            try {
                marked = await ports.markStored({
                    rowId: result.rowId,
                    verdictHash: result.verdictHash,
                    positionKey: result.positionKey,
                    attestationAuthor: result.attestationAuthor,
                    deployment: result.deployment,
                    deploymentKind: result.deploymentKind,
                    storedAt: ports.now(),
                });
            } catch (error) {
                report.pending.push({
                    rowId: result.rowId,
                    reason: `slimming failed: ${messageOf(error)}`,
                });
                continue;
            }
            if (marked === "slimmed") report.stored += 1;
            else report.alreadySlim += 1;
        }
        if (page.isDone) return report;
        cursor = page.cursor;
    }
}

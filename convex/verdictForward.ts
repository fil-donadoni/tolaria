// The forward (issue #3745, ADR 0128 § Amendment — the forward token): how a
// deployment WITHOUT the write key gets its outbox into the Verdict Store.
//
// Judgements are given on local backends (the owner) and on production (other
// testers), and both are equivalent sources. The write key must never reach a
// development machine, so a local backend cannot upload — and before this, its
// fat rows had no way out but a manual export. Now its drain FORWARDS each row
// to the deployment that holds the key, over an authenticated HTTP route, and
// that deployment re-validates, uploads, reads back and only then answers.
//
// THE THIRD CREDENTIAL. A forward token is bound to ONE deployment name on the
// writer (`VERDICT_STORE_FORWARD_TOKENS`, a list of `{deployment, sha256}` — the
// writer keeps only the token's hash). What it can do is narrow by
// construction:
//
//  - it can attest only as `<its deployment>:<userId>`, with the attestation's
//    own `deployment` and `deploymentKind` naming that deployment — never as
//    anyone on another one;
//  - it cannot name an object: the writer derives every object name from the
//    content, exactly as its own drain does, and never overwrites;
//  - it cannot skip validation: the judgement passes the checks `submit` runs,
//    a resolution the checks `record` runs;
//  - it is revoked by deleting its entry on the writer.
//
// The write key itself never leaves the cloud deployments.
//
// ORIGIN IS PRESERVED. The writer stores the attestation the local deployment
// computed — its deployment, `deploymentKind: local`, `gameId`, `seq`,
// `createdAt`, `botPickIndex`, note — and never rewrites it to itself.
//
// Decisions only: the writer's HTTP action (`verdictForwardHttp.ts`) and the
// local drain (`verdictsDrain.ts`) bind them. Reachable from the `"use node"`
// drain, so it imports the pure outbox modules and nothing that reaches the
// card registry (`scripts/__tests__/convex-node-bundle-seam.test.ts`).

import type { VerdictJudgement } from "./gre/ai/verdicts/identity";
import {
    resolutionIdOf,
    resolutionProblems,
} from "./gre/ai/verdicts/resolution";
import { sha256Hex } from "./gre/ai/verdicts/sha256";
import type {
    VerdictAttestation,
    VerdictResolution,
} from "./gre/ai/verdicts/types";
import {
    resolutionOfRow,
    type ResolutionOutboxRow,
    type ResolutionRowStore,
} from "./verdictResolutionsOutbox";
import {
    VERDICT_AUTHOR_PATTERN,
    VERDICT_DEPLOYMENT_NAME_PATTERN,
    type VerdictStorePutOutcome,
} from "./verdictStore";
import {
    prepareOutboxRow,
    verdictStampOf,
    type OutboxRow,
    type OutboxRowStore,
    type OutboxStoreResult,
    type VerdictDeployment,
} from "./verdictsOutbox";

/** On a deployment WITHOUT the write key: the token it presents. */
export const VERDICT_STORE_FORWARD_TOKEN_ENV = "VERDICT_STORE_FORWARD_TOKEN";

/** On a deployment WITHOUT the write key: the writer's HTTP actions URL
 *  (`https://<deployment>.convex.site`). */
export const VERDICT_STORE_FORWARD_URL_ENV = "VERDICT_STORE_FORWARD_URL";

/** On the deployment WITH the write key: the tokens it accepts, as a JSON
 *  array of `{ "deployment": "<name>", "sha256": "<hex of the token>" }`. */
export const VERDICT_STORE_FORWARD_TOKENS_ENV = "VERDICT_STORE_FORWARD_TOKENS";

/** The route the writer serves the forward on. */
export const VERDICT_FORWARD_PATH = "/verdicts/forward";

// ── The writer's token registry ──────────────────────────────────────────────

/** One accepted token. `resolutions` opts the token into forwarding
 *  resolutions: `record` is admin-only on the deployment that ran it, and the
 *  writer cannot see that deployment's admins, so a token carries a
 *  resolver's power only when the writer's owner says so. */
export type ForwardTokenEntry = {
    deployment: string;
    sha256: string;
    resolutions: boolean;
};

/** How far a forwarded `createdAt` may run ahead of the writer's clock. The
 *  newest resolution applies (`quarantine.ts`), so a date in the future would
 *  decide a position until that date — refused rather than believed. */
export const FORWARD_CLOCK_SKEW_MS = 5 * 60 * 1000;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Parse the writer's accepted tokens. Absent means none. A malformed value
 *  throws — naming the env var, never echoing its content. */
export function parseForwardTokenRegistry(
    text: string | undefined
): ForwardTokenEntry[] {
    if (text === undefined || text.trim() === "") return [];
    const refuse = (): never => {
        throw new Error(
            `${VERDICT_STORE_FORWARD_TOKENS_ENV} is not a JSON array of {"deployment", "sha256", "resolutions"?}`
        );
    };
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return refuse();
    }
    if (!Array.isArray(raw)) return refuse();
    return raw.map((entry: unknown) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        if (
            typeof e.deployment !== "string" ||
            !VERDICT_DEPLOYMENT_NAME_PATTERN.test(e.deployment) ||
            typeof e.sha256 !== "string" ||
            !SHA256_HEX.test(e.sha256) ||
            !(e.resolutions === undefined || typeof e.resolutions === "boolean")
        ) {
            return refuse();
        }
        return {
            deployment: e.deployment,
            sha256: e.sha256,
            resolutions: e.resolutions === true,
        };
    });
}

/** Equal-length strings compared without an early exit. */
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let difference = 0;
    for (let i = 0; i < a.length; i++) {
        difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return difference === 0;
}

/** The registry entry a presented token matches, or `null` for a token the
 *  writer does not accept. Every entry is compared, match or not. */
export function forwardTokenEntryOf(
    registry: readonly ForwardTokenEntry[],
    token: string
): ForwardTokenEntry | null {
    if (token === "") return null;
    const presented = sha256Hex(token);
    let bound: ForwardTokenEntry | null = null;
    for (const entry of registry) {
        if (constantTimeEqual(entry.sha256, presented) && bound === null) {
            bound = entry;
        }
    }
    return bound;
}

/** A deployment's kind from its name alone: `verdictDeploymentOf` names every
 *  local backend `local-<port>`, and nothing else. */
export function deploymentKindOfName(name: string): "cloud" | "local" {
    return /^local-\d+$/.test(name) ? "local" : "cloud";
}

// ── The wire ─────────────────────────────────────────────────────────────────

export type ForwardRequest =
    | {
          kind: "verdict";
          verdictHash: string;
          positionKey: string;
          judgement: VerdictJudgement;
          attestation: VerdictAttestation;
      }
    | {
          kind: "resolution";
          resolutionId: string;
          resolution: VerdictResolution;
      };

export type ForwardResponse =
    | {
          status: "stored";
          kind: "verdict";
          verdictId: string;
          positionKey: string;
          attestationAuthor: string;
          verdict: VerdictStorePutOutcome;
          attestation: VerdictStorePutOutcome;
      }
    | {
          status: "stored";
          kind: "resolution";
          resolutionId: string;
          outcome: VerdictStorePutOutcome;
      }
    /** The writer will not store it as sent: a re-send changes nothing. */
    | { status: "refused"; reason: string }
    /** The writer could not store it now: the next drain retries. */
    | { status: "pending"; reason: string };

export type ForwardAnswer = { httpStatus: number; response: ForwardResponse };

// ── The writer's side ────────────────────────────────────────────────────────

/** What the writer's HTTP action binds. */
export interface ForwardWriterPorts {
    /** The accepted tokens; throws on a malformed registry. */
    registry: () => ForwardTokenEntry[];
    /** The writer's clock. */
    now: () => number;
    /** The checks `verdicts.submit` runs on a judgement; throws the reason. */
    checkAdmissible: (
        judgement: VerdictJudgement & { botPickIndex?: number }
    ) => Promise<void>;
    /** Upload + re-read with the write key (`storeOutboxRow`). */
    storeVerdict: OutboxRowStore;
    /** Upload + re-read with the write key (`storeResolutionRow`). */
    storeResolution: ResolutionRowStore;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const refused = (httpStatus: number, reason: string): ForwardAnswer => ({
    httpStatus,
    response: { status: "refused", reason },
});

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const optional = (value: unknown, type: "string" | "number"): boolean =>
    value === undefined || typeof value === type;

/** The judgement's own fields, and only those: anything else in the body is
 *  outside the hash and is not carried to the store. */
function judgementOfBody(raw: Fields): VerdictJudgement | null {
    if (
        !isObject(raw.spec) ||
        (raw.seat !== "me" && raw.seat !== "opp") ||
        !Array.isArray(raw.candidates) ||
        !isObject(raw.answer) ||
        !(raw.setup === undefined || Array.isArray(raw.setup)) ||
        !(raw.deckKnowledge === undefined || Array.isArray(raw.deckKnowledge))
    ) {
        return null;
    }
    return {
        spec: raw.spec,
        ...(raw.setup === undefined ? {} : { setup: raw.setup }),
        seat: raw.seat,
        ...(raw.deckKnowledge === undefined
            ? {}
            : { deckKnowledge: raw.deckKnowledge }),
        candidates: raw.candidates,
        answer: raw.answer,
    } as VerdictJudgement;
}

/** The attestation's own fields, type-checked, or `null`. */
function attestationOfBody(raw: Fields): VerdictAttestation | null {
    if (
        typeof raw.verdictId !== "string" ||
        typeof raw.author !== "string" ||
        raw.sourceAxis !== "explicit" ||
        typeof raw.createdAt !== "number" ||
        typeof raw.deployment !== "string" ||
        (raw.deploymentKind !== "cloud" && raw.deploymentKind !== "local") ||
        !optional(raw.note, "string") ||
        !optional(raw.botPickIndex, "number") ||
        !optional(raw.gameId, "string") ||
        !optional(raw.seq, "number")
    ) {
        return null;
    }
    return {
        verdictId: raw.verdictId,
        author: raw.author,
        sourceAxis: raw.sourceAxis,
        createdAt: raw.createdAt,
        ...(raw.note === undefined ? {} : { note: raw.note as string }),
        deployment: raw.deployment,
        deploymentKind: raw.deploymentKind,
        ...(raw.botPickIndex === undefined
            ? {}
            : { botPickIndex: raw.botPickIndex as number }),
        ...(raw.gameId === undefined ? {} : { gameId: raw.gameId as string }),
        ...(raw.seq === undefined ? {} : { seq: raw.seq as number }),
    };
}

function resolutionOfBody(raw: Fields): VerdictResolution | null {
    if (
        typeof raw.positionKey !== "string" ||
        !(
            raw.acceptedVerdictId === null ||
            typeof raw.acceptedVerdictId === "string"
        ) ||
        !Array.isArray(raw.rejected) ||
        !raw.rejected.every(
            (r: unknown) =>
                isObject(r) &&
                typeof r.verdictId === "string" &&
                typeof r.reason === "string"
        ) ||
        typeof raw.author !== "string" ||
        typeof raw.createdAt !== "number" ||
        !optional(raw.note, "string") ||
        typeof raw.deployment !== "string" ||
        (raw.deploymentKind !== "cloud" && raw.deploymentKind !== "local")
    ) {
        return null;
    }
    return {
        positionKey: raw.positionKey,
        acceptedVerdictId: raw.acceptedVerdictId,
        rejected: (raw.rejected as Fields[]).map((r) => ({
            verdictId: r.verdictId as string,
            reason: r.reason as string,
        })),
        author: raw.author,
        createdAt: raw.createdAt,
        ...(raw.note === undefined ? {} : { note: raw.note as string }),
        deployment: raw.deployment,
        deploymentKind: raw.deploymentKind,
    };
}

/** Why an origin is outside the token's deployment, or `null` when it is
 *  inside. The author, the named deployment and its kind must ALL be the
 *  token's: a token bound to `local-3210` attests as `local-3210:<userId>`
 *  and as nothing else. */
export function originOutsideDeployment(
    origin: { author: string; deployment?: string; deploymentKind?: string },
    deployment: string
): string | null {
    if (
        !VERDICT_AUTHOR_PATTERN.test(origin.author) ||
        !origin.author.startsWith(`${deployment}:`)
    ) {
        return `author ${JSON.stringify(origin.author)} is outside ${deployment}, the deployment this forward token is bound to`;
    }
    if (origin.deployment !== deployment) {
        return `deployment ${JSON.stringify(origin.deployment)} is not ${deployment}, the deployment this forward token is bound to`;
    }
    const kind = deploymentKindOfName(deployment);
    if (origin.deploymentKind !== kind) {
        return `deployment kind ${JSON.stringify(origin.deploymentKind)} is not ${kind}, the kind of ${deployment}`;
    }
    return null;
}

/**
 * Answer one forward. Never throws: every outcome is an HTTP status and a
 * body saying what happened, because the caller is a drain on another
 * machine that must be told why its row stays fat.
 */
export async function acceptForward(
    ports: ForwardWriterPorts,
    authorization: string | null,
    body: unknown
): Promise<ForwardAnswer> {
    const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1] ?? "";
    if (token === "") return refused(401, "no forward token was presented");
    let registry: ForwardTokenEntry[];
    try {
        registry = ports.registry();
    } catch (error) {
        return refused(500, messageOf(error));
    }
    const entry = forwardTokenEntryOf(registry, token);
    if (entry === null) {
        return refused(
            401,
            "this deployment does not accept that forward token"
        );
    }
    if (!isObject(body)) return refused(400, "the body is not a JSON object");

    if (body.kind === "verdict") {
        return acceptForwardedVerdict(ports, entry.deployment, body);
    }
    if (body.kind === "resolution") {
        if (!entry.resolutions) {
            return refused(
                403,
                `this forward token does not carry resolutions for ${entry.deployment}`
            );
        }
        return acceptForwardedResolution(ports, entry.deployment, body);
    }
    return refused(400, `unknown forward kind ${JSON.stringify(body.kind)}`);
}

async function acceptForwardedVerdict(
    ports: ForwardWriterPorts,
    deployment: string,
    body: Fields
): Promise<ForwardAnswer> {
    const judgement = isObject(body.judgement)
        ? judgementOfBody(body.judgement)
        : null;
    const attestation = isObject(body.attestation)
        ? attestationOfBody(body.attestation)
        : null;
    if (
        judgement === null ||
        attestation === null ||
        typeof body.verdictHash !== "string" ||
        typeof body.positionKey !== "string"
    ) {
        return refused(400, "not a forwarded verdict");
    }
    const outside = originOutsideDeployment(attestation, deployment);
    if (outside !== null) return refused(403, outside);
    const future = futureCreatedAt(ports, attestation.createdAt as number);
    if (future !== null) return refused(422, future);
    const stamp = verdictStampOf(judgement);
    if (
        stamp.verdictHash !== body.verdictHash ||
        stamp.positionKey !== body.positionKey
    ) {
        return refused(
            422,
            `the judgement hashes to ${stamp.verdictHash}, not the stamped ${body.verdictHash}`
        );
    }
    if (attestation.verdictId !== body.verdictHash) {
        return refused(
            422,
            `the attestation names ${attestation.verdictId}, not the stamped ${body.verdictHash}`
        );
    }
    try {
        await ports.checkAdmissible({
            ...judgement,
            ...(attestation.botPickIndex === undefined
                ? {}
                : { botPickIndex: attestation.botPickIndex }),
        });
    } catch (error) {
        return refused(422, `inadmissible judgement: ${messageOf(error)}`);
    }

    // The row the writer's own drain would hold, had the judgement been given
    // here — so the forward stores through exactly the code a direct drain
    // does, stamps and re-read included.
    const row: OutboxRow = {
        _id: `forward:${body.verdictHash}`,
        ...judgement,
        ...(attestation.botPickIndex === undefined
            ? {}
            : { botPickIndex: attestation.botPickIndex }),
        ...(attestation.gameId === undefined
            ? {}
            : { gameId: attestation.gameId }),
        ...(attestation.seq === undefined ? {} : { seq: attestation.seq }),
        author: attestation.author,
        attestationAuthor: attestation.author,
        deployment: attestation.deployment,
        deploymentKind: attestation.deploymentKind,
        createdAt: attestation.createdAt as number,
        ...(attestation.note === undefined ? {} : { note: attestation.note }),
        verdictHash: body.verdictHash,
        positionKey: body.positionKey,
    };
    let result: OutboxStoreResult;
    try {
        result = await ports.storeVerdict(row);
    } catch (error) {
        return pendingAnswer(`the writer could not store: ${messageOf(error)}`);
    }
    if (result.status === "pending") return pendingAnswer(result.reason);
    if (result.status === "already-slim") {
        return refused(400, "the forwarded judgement is incomplete");
    }
    return {
        httpStatus: 200,
        response: {
            status: "stored",
            kind: "verdict",
            verdictId: result.verdictHash,
            positionKey: result.positionKey,
            attestationAuthor: result.attestationAuthor,
            verdict: result.verdict,
            attestation: result.attestation,
        },
    };
}

async function acceptForwardedResolution(
    ports: ForwardWriterPorts,
    deployment: string,
    body: Fields
): Promise<ForwardAnswer> {
    const resolution = isObject(body.resolution)
        ? resolutionOfBody(body.resolution)
        : null;
    if (resolution === null || typeof body.resolutionId !== "string") {
        return refused(400, "not a forwarded resolution");
    }
    const outside = originOutsideDeployment(resolution, deployment);
    if (outside !== null) return refused(403, outside);
    const future = futureCreatedAt(ports, resolution.createdAt as number);
    if (future !== null) return refused(422, future);
    // `record` trims every reason and the note before hashing; a forward
    // carrying untrimmed prose is not a decision `record` could have made.
    if (
        resolution.rejected.some((r) => r.reason !== r.reason.trim()) ||
        (resolution.note !== undefined &&
            resolution.note !== resolution.note.trim())
    ) {
        return refused(422, "a reason or the note is not trimmed");
    }
    const problems = resolutionProblems(resolution);
    if (problems.length > 0) {
        return refused(422, `not a resolution: ${problems.join("; ")}`);
    }
    const resolutionId = resolutionIdOf(resolution);
    if (resolutionId !== body.resolutionId) {
        return refused(
            422,
            `the decision hashes to ${resolutionId}, not the recorded ${body.resolutionId}`
        );
    }
    const row: ResolutionOutboxRow = {
        _id: `forward:${resolutionId}`,
        positionKey: resolution.positionKey,
        resolutionId,
        acceptedVerdictId: resolution.acceptedVerdictId,
        rejected: resolution.rejected,
        resolverAuthor: resolution.author,
        createdAt: resolution.createdAt as number,
        ...(resolution.note === undefined ? {} : { note: resolution.note }),
        deployment: resolution.deployment as string,
        deploymentKind: resolution.deploymentKind as "cloud" | "local",
    };
    try {
        const result = await ports.storeResolution(row);
        if (result.status === "pending") return pendingAnswer(result.reason);
        return {
            httpStatus: 200,
            response: {
                status: "stored",
                kind: "resolution",
                resolutionId: result.resolutionId,
                outcome: result.outcome,
            },
        };
    } catch (error) {
        return pendingAnswer(`the writer could not store: ${messageOf(error)}`);
    }
}

function futureCreatedAt(
    ports: ForwardWriterPorts,
    createdAt: number
): string | null {
    const limit = ports.now() + FORWARD_CLOCK_SKEW_MS;
    return createdAt > limit
        ? `createdAt ${createdAt} is later than this deployment's clock allows (${limit})`
        : null;
}

const pendingAnswer = (reason: string): ForwardAnswer => ({
    httpStatus: 503,
    response: { status: "pending", reason },
});

// ── The forwarding side ──────────────────────────────────────────────────────

/** Sends one forward and returns the writer's answer. Throws only when no
 *  answer came back (the writer is down, or answered something else). */
export type ForwardTransport = (
    request: ForwardRequest
) => Promise<ForwardAnswer>;

/** How long one forward may take before its row is left pending. */
export const FORWARD_TIMEOUT_MS = 30_000;

/** The real transport: a POST to the writer's route, bearing the token. */
export function httpForwardTransport(
    writerUrl: string,
    token: string,
    fetchImpl: typeof fetch = fetch
): ForwardTransport {
    const endpoint = `${writerUrl.replace(/\/+$/, "")}${VERDICT_FORWARD_PATH}`;
    return async (request) => {
        const response = await fetchImpl(endpoint, {
            method: "POST",
            // A writer that accepts the connection and never answers must
            // not stall the whole drain: the row becomes pending instead.
            signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(request),
        });
        let parsed: unknown;
        try {
            parsed = await response.json();
        } catch {
            parsed = undefined;
        }
        if (
            !isObject(parsed) ||
            !["stored", "refused", "pending"].includes(parsed.status as string)
        ) {
            throw new Error(
                `the writer answered ${response.status} with no forward response`
            );
        }
        return {
            httpStatus: response.status,
            response: parsed as ForwardResponse,
        };
    };
}

function notStored(answer: ForwardAnswer): string | null {
    const { response, httpStatus } = answer;
    if (response.status === "stored") return null;
    return `forward ${response.status} (${httpStatus}): ${response.reason}`;
}

/**
 * Store a row by forwarding it. The row is prepared exactly as a direct drain
 * prepares it — legacy rows included, attributed to this deployment — and
 * counts as stored only when the writer confirmed the read-back of the very
 * verdict, position and author this row promised. Never throws.
 */
export function forwardOutboxStore(
    transport: ForwardTransport,
    here: VerdictDeployment
): OutboxRowStore {
    return async (row) => {
        const prepared = prepareOutboxRow(row, here);
        if (prepared.status !== "ready") return prepared;
        const { judgement, stamp, attribution, attestation } = prepared;
        const pending = (reason: string): OutboxStoreResult => ({
            status: "pending",
            rowId: row._id,
            reason,
        });
        let answer: ForwardAnswer;
        try {
            answer = await transport({
                kind: "verdict",
                ...stamp,
                judgement,
                attestation,
            });
        } catch (error) {
            return pending(`forward failed: ${messageOf(error)}`);
        }
        const refusal = notStored(answer);
        if (refusal !== null) return pending(refusal);
        const confirmed = answer.response;
        if (
            confirmed.status !== "stored" ||
            confirmed.kind !== "verdict" ||
            confirmed.verdictId !== stamp.verdictHash ||
            confirmed.positionKey !== stamp.positionKey ||
            confirmed.attestationAuthor !== attribution.attestationAuthor
        ) {
            return pending(
                `the writer confirmed something other than ${stamp.verdictHash} attested by ${attribution.attestationAuthor}`
            );
        }
        return {
            status: "stored",
            rowId: row._id,
            ...stamp,
            ...attribution,
            verdict: confirmed.verdict,
            attestation: confirmed.attestation,
        };
    };
}

/** Store a resolution row by forwarding it. Never throws. */
export function forwardResolutionStore(
    transport: ForwardTransport
): ResolutionRowStore {
    return async (row) => {
        const pending = (reason: string) => ({
            status: "pending" as const,
            rowId: row._id,
            reason,
        });
        let answer: ForwardAnswer;
        try {
            answer = await transport({
                kind: "resolution",
                resolutionId: row.resolutionId,
                resolution: resolutionOfRow(row),
            });
        } catch (error) {
            return pending(`forward failed: ${messageOf(error)}`);
        }
        const refusal = notStored(answer);
        if (refusal !== null) return pending(refusal);
        const confirmed = answer.response;
        if (
            confirmed.status !== "stored" ||
            confirmed.kind !== "resolution" ||
            confirmed.resolutionId !== row.resolutionId
        ) {
            return pending(
                `the writer confirmed something other than ${row.resolutionId}`
            );
        }
        return {
            status: "stored",
            rowId: row._id,
            resolutionId: confirmed.resolutionId,
            outcome: confirmed.outcome,
        };
    };
}

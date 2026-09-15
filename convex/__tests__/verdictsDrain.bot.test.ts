// The outbox drain's edges (issue #3580): the two registered actions, a row
// the slimming mutation refuses, and the attestation decoder's type check.
//
// `drain` / `drainNow` are the REGISTERED actions, driven through `_handler`
// with a stub ctx — the harness convention `gameMutationHarness.ts` sets for
// mutations. Nothing here reaches GCS: both paths under test end before a
// writer is constructed.
//
// A `.bot.test.ts` because it builds verdicts through `convex/gre/ai/verdicts`
// (`bot-suite-boundary.test.ts`).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    canonicalJson,
    type VerdictJudgement,
} from "../gre/ai/verdicts/identity";
import {
    VerdictStoreIntegrityError,
    decodeAttestationObject,
    encodeAttestationObject,
    verdictAuthorOf,
} from "../verdictStore";
import { createMemoryVerdictStore } from "../verdictStoreMemory";
import { drain, drainNow } from "../verdictsDrain";
import {
    drainOutbox,
    verdictDeploymentOf,
    verdictStampOf,
    type OutboxRow,
    type VerdictDeployment,
} from "../verdictsOutbox";

type ActionHandler = {
    _handler: (ctx: unknown, args: Record<string, never>) => Promise<unknown>;
};

const HERE: VerdictDeployment = { name: "jovial-guineapig-250", kind: "cloud" };

const JUDGEMENT: VerdictJudgement = {
    spec: { cards: [{ name: "Mountain", owner: "me" }] },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
    ],
    answer: { kind: "right", rightIndexes: [1] },
};

function fatRow(id: string): OutboxRow {
    return {
        _id: id,
        ...JUDGEMENT,
        author: "Tessa",
        authorId: "u-tester",
        createdAt: 1,
        ...verdictStampOf(JUDGEMENT),
        attestationAuthor: verdictAuthorOf(HERE.name, "u-tester"),
        deployment: HERE.name,
        deploymentKind: HERE.kind,
    };
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("verdictsDrain actions (issue #3580)", () => {
    it("the scheduled drain on a deployment without the write key is skipped, not failed", async () => {
        vi.stubEnv("VERDICT_STORE_WRITE_KEY", "");
        const ctx = {
            runQuery: vi.fn(async () => {
                throw new Error("the skipped drain read the table");
            }),
            runMutation: vi.fn(),
        };
        const report = await (drain as unknown as ActionHandler)._handler(
            ctx,
            {}
        );
        expect(report).toMatchObject({
            stored: 0,
            pending: [],
            skipped: expect.stringContaining("VERDICT_STORE_WRITE_KEY"),
        });
        expect(ctx.runQuery).not.toHaveBeenCalled();
    });

    it("drainNow refuses a caller who is not an admin before anything else", async () => {
        const runQuery = vi.fn(async () => {
            throw new Error("Forbidden: admin only");
        });
        await expect(
            (drainNow as unknown as ActionHandler)._handler(
                { runQuery, runMutation: vi.fn() },
                {}
            )
        ).rejects.toThrow("Forbidden: admin only");
        expect(runQuery).toHaveBeenCalledTimes(1);
    });

    it("drainNow tells an admin that this deployment cannot upload", async () => {
        vi.stubEnv("VERDICT_STORE_WRITE_KEY", "");
        vi.stubEnv(
            "CONVEX_CLOUD_URL",
            "https://jovial-guineapig-250.convex.cloud"
        );
        await expect(
            (drainNow as unknown as ActionHandler)._handler(
                { runQuery: vi.fn(async () => null), runMutation: vi.fn() },
                {}
            )
        ).rejects.toThrow("VERDICT_STORE_WRITE_KEY is not set");
    });
});

describe("drainOutbox keeps going past a row it cannot slim (issue #3580)", () => {
    it("reports the refused row pending and still slims the next", async () => {
        const marked: string[] = [];
        const report = await drainOutbox({
            store: createMemoryVerdictStore(),
            here: HERE,
            now: () => 2,
            pendingPage: async () => ({
                rows: [fatRow("r-bad"), fatRow("r-good")],
                cursor: "",
                isDone: true,
            }),
            markStored: async ({ rowId }) => {
                if (rowId === "r-bad") {
                    throw new Error("verdict row r-bad does not exist");
                }
                marked.push(rowId);
                return "slimmed";
            },
        });
        expect(report).toEqual({
            stored: 1,
            alreadySlim: 0,
            pending: [
                {
                    rowId: "r-bad",
                    reason: "slimming failed: verdict row r-bad does not exist",
                },
            ],
        });
        expect(marked).toEqual(["r-good"]);
    });
});

describe("attestation decoding checks field types (issue #3580)", () => {
    it("refuses canonical bytes whose provenance has the wrong type", () => {
        const attestation = {
            verdictId: verdictStampOf(JUDGEMENT).verdictHash,
            author: verdictAuthorOf(HERE.name, "u-tester"),
            sourceAxis: "explicit" as const,
            createdAt: 1,
        };
        const { name } = encodeAttestationObject(attestation);
        const bytes = new TextEncoder().encode(
            canonicalJson({ ...attestation, createdAt: "yesterday" })
        );
        expect(() => decodeAttestationObject(name, bytes)).toThrow(
            VerdictStoreIntegrityError
        );
        expect(() => decodeAttestationObject(name, bytes)).toThrow(
            "createdAt has the wrong type"
        );
    });
});

describe("verdictDeploymentOf on https (issue #3580)", () => {
    it("names a local https backend with no explicit port by 443", () => {
        expect(verdictDeploymentOf("https://localhost")).toEqual({
            name: "local-443",
            kind: "local",
        });
    });
});

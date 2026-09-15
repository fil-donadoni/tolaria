// The resolution outbox's table door (issue #3582, ADR 0128 §6): the REGISTERED
// `record` / `markResolutionStored` bindings driven through the shared stub ctx
// (`gameMutationHarness.ts`) — the path that is deployed, not an extracted
// helper.
//
// A `.bot.test.ts` because it derives ids through
// `convex/gre/ai/verdicts/identity`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { positionKeyOf, verdictIdOf } from "../gre/ai/verdicts/identity";
import { resolutionIdOf } from "../gre/ai/verdicts/resolution";
import { markResolutionStored, record } from "../verdictResolutions";
import { makeMutationCtx, runMutation, type Row } from "./gameMutationHarness";

const ADMIN: Row = {
    _id: "u-admin",
    __table: "users",
    nickname: "Ada",
    isAdmin: true,
};
const TESTER: Row = {
    _id: "u-tester",
    __table: "users",
    nickname: "Tessa",
    isTester: true,
};

const POSITION = {
    spec: { cards: [{ name: "Mountain", owner: "me" as const }] },
    seat: "me" as const,
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
    ],
};
const PASS = {
    ...POSITION,
    answer: { kind: "right" as const, rightIndexes: [0] },
};
const BOLT = {
    ...POSITION,
    answer: { kind: "right" as const, rightIndexes: [1] },
};

const ARGS = {
    positionKey: positionKeyOf(PASS),
    acceptedVerdictId: verdictIdOf(BOLT),
    rejected: [{ verdictId: verdictIdOf(PASS), reason: "  Bolt is lethal  " }],
    note: "  opponent at 3  ",
};

beforeEach(() => {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://jovial-guineapig-250.convex.cloud");
});
afterEach(() => {
    vi.unstubAllEnvs();
});

describe("verdictResolutions.record", () => {
    it("refuses a caller who is not an admin — a tester judges, an admin resolves", async () => {
        const stub = makeMutationCtx("u-tester", [TESTER]);
        await expect(runMutation(record, stub.ctx, ARGS)).rejects.toThrow();
        expect(stub.writes).toEqual([]);
    });

    it("stamps the resolver from auth, trims the prose, and schedules the drain", async () => {
        const stub = makeMutationCtx("u-admin", [ADMIN]);
        const runAfter = vi.spyOn(stub.ctx.scheduler, "runAfter");
        const resolutionId = await runMutation<typeof ARGS, string>(
            record,
            stub.ctx,
            ARGS
        );
        const resolverAuthor = "jovial-guineapig-250:u-admin";
        const [write] = stub.writes;
        // The id covers the decision and the moment it was recorded.
        expect(resolutionId).toBe(
            resolutionIdOf({
                positionKey: ARGS.positionKey,
                acceptedVerdictId: ARGS.acceptedVerdictId,
                rejected: [
                    { verdictId: verdictIdOf(PASS), reason: "Bolt is lethal" },
                ],
                author: resolverAuthor,
                createdAt: stub.doc(write.id).createdAt as number,
            })
        );
        expect(write.table).toBe("verdictResolutions");
        expect(stub.doc(write.id)).toMatchObject({
            resolutionId,
            authorId: "u-admin",
            author: "Ada",
            resolverAuthor,
            rejected: [
                { verdictId: verdictIdOf(PASS), reason: "Bolt is lethal" },
            ],
            note: "opponent at 3",
            deployment: "jovial-guineapig-250",
            deploymentKind: "cloud",
        });
        expect(stub.doc(write.id).storedAt).toBeUndefined();
        expect(runAfter).toHaveBeenCalledTimes(1);
    });

    it("refuses a rejection without a reason, writing nothing", async () => {
        const stub = makeMutationCtx("u-admin", [ADMIN]);
        await expect(
            runMutation(record, stub.ctx, {
                ...ARGS,
                rejected: [{ verdictId: verdictIdOf(PASS), reason: "   " }],
            })
        ).rejects.toThrow(/rejected without a reason/);
        expect(stub.writes).toEqual([]);
    });
});

describe("verdictResolutions.markResolutionStored", () => {
    const ROW: Row = {
        _id: "r-1",
        __table: "verdictResolutions",
        resolutionId: "v1-" + "a".repeat(64),
    };

    it("marks the row it was told about", async () => {
        const stub = makeMutationCtx(null, [ROW]);
        await runMutation(markResolutionStored, stub.ctx, {
            rowId: "r-1",
            resolutionId: ROW.resolutionId,
            storedAt: 7,
        });
        expect(stub.doc("r-1").storedAt).toBe(7);
    });

    it("refuses a stored id the row did not record", async () => {
        const stub = makeMutationCtx(null, [ROW]);
        await expect(
            runMutation(markResolutionStored, stub.ctx, {
                rowId: "r-1",
                resolutionId: "v1-" + "b".repeat(64),
                storedAt: 7,
            })
        ).rejects.toThrow(/records/);
        expect(stub.doc("r-1").storedAt).toBeUndefined();
    });
});

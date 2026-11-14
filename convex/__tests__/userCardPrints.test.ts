// Preferred printing per card (issue #8755). The handlers are driven for real
// against the shared in-memory ctx (no convex-test harness, see
// `joinByCode.test.ts`): the owner comes from `ctx.auth`, never from an
// argument, the key is the folded card name, and a second pick patches the
// same row.
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import { listMyCardPrints, setMyCardPrint } from "../userCardPrints";
import {
    makeInMemoryDb,
    type InMemoryRow,
} from "./fixtures/inMemoryDb.fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: MutationCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: MutationCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

const ALICE = "user-alice";
const BOB = "user-bob";
const USERS = [
    { _id: ALICE, nickname: "Alice", email: "a@example.com" },
    { _id: BOB, nickname: "Bob", email: "b@example.com" },
];

function db(identity?: string, userCardPrints: InMemoryRow[] = []) {
    return makeInMemoryDb(
        { users: USERS, userCardPrints },
        identity === undefined ? {} : { identitySubject: `${identity}|s` }
    );
}

const EFREET = {
    cardName: "Ifh-Bíff Efreet",
    printId: "efreet-me4",
    setCode: "ME4",
};

describe("setMyCardPrint (issue #8755)", () => {
    it("refuses an unauthenticated caller and writes nothing", async () => {
        const { ctx, tables } = db();
        await expect(run(setMyCardPrint, ctx, EFREET)).rejects.toThrow(
            "Not authenticated"
        );
        expect(tables.userCardPrints ?? []).toEqual([]);
    });

    it("stores the caller's row under the folded card name with its Set", async () => {
        const { ctx, tables } = db(ALICE);
        await run(setMyCardPrint, ctx, EFREET);
        expect(tables.userCardPrints).toHaveLength(1);
        expect(tables.userCardPrints[0]).toMatchObject({
            userId: ALICE,
            cardKey: "ifh-biff efreet",
            printId: "efreet-me4",
            setCode: "me4",
        });
    });

    it("a second pick of the same card patches its row", async () => {
        const { ctx, tables } = db(ALICE);
        await run(setMyCardPrint, ctx, EFREET);
        await run(setMyCardPrint, ctx, {
            cardName: "ifh-biff efreet",
            printId: "efreet-arn",
            setCode: "arn",
        });
        expect(tables.userCardPrints).toHaveLength(1);
        expect(tables.userCardPrints[0]).toMatchObject({
            printId: "efreet-arn",
            setCode: "arn",
        });
    });

    it("refuses an empty card name", async () => {
        const { ctx } = db(ALICE);
        await expect(
            run(setMyCardPrint, ctx, { ...EFREET, cardName: "  " })
        ).rejects.toThrow("Invalid card name");
    });
});

describe("listMyCardPrints (issue #8755)", () => {
    const rows = [
        {
            _id: "p-alice",
            userId: ALICE,
            cardKey: "sliver queen",
            printId: "sq-plst",
            setCode: "plst",
        },
        {
            _id: "p-bob",
            userId: BOB,
            cardKey: "sliver queen",
            printId: "sq-sth",
            setCode: "sth",
        },
    ];

    it("returns only the caller's preferences", async () => {
        const { ctx } = db(ALICE, rows);
        expect(await run(listMyCardPrints, ctx, {})).toEqual([
            { cardKey: "sliver queen", printId: "sq-plst", setCode: "plst" },
        ]);
    });

    it("returns nothing to an unauthenticated caller", async () => {
        const { ctx } = db(undefined, rows);
        expect(await run(listMyCardPrints, ctx, {})).toEqual([]);
    });
});

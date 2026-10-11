// `createLimitedEvent` with a Pack Source key (PRD #5383, issue #5385): the
// server resolves the key through the catalogue into the per-pack sets it
// already accepted, so an event created by key stores exactly the
// `packSlots` the old raw-slots path stored. Runs the real mutation handler
// against an in-memory `ctx` (the project has no convex-test harness).
import { describe, it, expect } from "vitest";
import type { MutationCtx } from "../_generated/server";
import { createLimitedEvent } from "../limitedEvents";

type CreateArgs = {
    type: "sealed" | "draft";
    seatCount: number;
    packSource?: string;
    packSlots?: string[];
};

function fakeCtx() {
    const docs = new Map<string, Record<string, unknown>>([
        ["user1", { _id: "user1", nickname: "Creator" }],
    ]);
    const ctx = {
        auth: {
            getUserIdentity: async () => ({ subject: "user1|session1" }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Record<string, unknown>) => {
                const _id = `${table}-${docs.size}`;
                docs.set(_id, { ...doc, _id });
                return _id;
            },
        },
    };
    return { ctx: ctx as unknown as MutationCtx, docs };
}

async function create(args: CreateArgs): Promise<Record<string, unknown>> {
    const { ctx, docs } = fakeCtx();
    const id = await (
        createLimitedEvent as unknown as {
            _handler: (ctx: MutationCtx, args: CreateArgs) => Promise<string>;
        }
    )._handler(ctx, args);
    return docs.get(id)!;
}

describe("createLimitedEvent — Pack Source key (issue #5385)", () => {
    it.each([
        ["draft", "lea", ["lea", "lea", "lea"]],
        ["sealed", "lea", ["lea"]],
        ["draft", "ice", ["ice", "ice", "ice"]],
        [
            "draft",
            "vintage-cube",
            ["vintage-cube", "vintage-cube", "vintage-cube"],
        ],
    ] as const)(
        "%s on %s stores the same packSlots the raw-slots path stored",
        async (type, key, oldPackSlots) => {
            const byKey = await create({ type, seatCount: 2, packSource: key });
            const byOldPath = await create({
                type,
                seatCount: 2,
                packSlots: [...oldPackSlots],
            });
            expect(byKey.packSlots).toEqual(oldPackSlots);
            expect(byKey.packSlots).toEqual(byOldPath.packSlots);
        }
    );

    it("rejects a key the catalogue does not hold", async () => {
        await expect(
            create({ type: "draft", seatCount: 2, packSource: "nope" })
        ).rejects.toThrow(/Unknown Pack Source/);
    });

    it("rejects the cube for Sealed through its key", async () => {
        await expect(
            create({ type: "sealed", seatCount: 2, packSource: "vintage-cube" })
        ).rejects.toThrow(/Draft-only/);
    });

    it("rejects a request carrying both or neither of packSource / packSlots", async () => {
        await expect(
            create({
                type: "draft",
                seatCount: 2,
                packSource: "lea",
                packSlots: ["lea"],
            })
        ).rejects.toThrow(/exactly one/);
        await expect(create({ type: "draft", seatCount: 2 })).rejects.toThrow(
            /exactly one/
        );
    });
});

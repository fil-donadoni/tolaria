// The event row is the Limited domain's hot document, and two fields were
// riding on it that had no business being there (PRD #1776 follow-up):
//
//  - `cubePool` — 11.71 KB of a 16.0 KB prod event row, consumed only when a
//    booster round is DEALT (three times in a whole draft) yet re-read by
//    every pick, click, drag and open subscription. Now `limitedCubePools`.
//  - `selectedPickId` — a tentative click, private to its own seat, whose
//    write rewrote the whole event row and re-executed every other seat's
//    `getLimitedEvent`. Now `limitedSelections`.
//
// Both are READ-SET properties: the projection and the stored selection are
// identical either way, so a regression that puts the reads back is invisible
// to every result-shaped assertion and surfaces only as a bill (and, for the
// selection, as other people's boards re-rendering). Hence the assertions on
// `reads`/`writes` from the shared in-memory ctx.
//
// No convex-test harness in this repo (see `convex/__tests__/decks.test.ts`),
// so this drives the registered functions' own `_handler`s.
import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { makeInMemoryDb } from "./fixtures/inMemoryDb";
import { getLimitedEvent, selectDraftPick } from "../limitedEvents";
import {
    deleteCubePool,
    loadCubePool,
    saveCubePool,
} from "../limitedCubePoolStore";

const EVENT_ID = "event-cube" as Id<"limitedEvents">;

const PACK = [0, 1, 2].map((n) => ({
    scryfallId: `sf-${n}`,
    cardId: `card-${n}`,
    cardName: `Card ${n}`,
    pickId: `r0-p0-c${n}`,
}));

/** A started cube Draft: one human seat holding a booster, the frozen pool in
 *  its own row. `inlinePool` seeds the LEGACY shape instead — the pool still
 *  on the event row, as every event started before the split has it. */
function seedDraft({ inlinePool = false }: { inlinePool?: boolean } = {}) {
    const pool = Array.from({ length: 40 }, (_, i) => `cube-card-${i}`);
    return makeInMemoryDb(
        {
            users: [{ _id: "user1", nickname: "Alice" }],
            limitedEvents: [
                {
                    _id: EVENT_ID,
                    createdBy: "user1",
                    type: "draft",
                    status: "started",
                    seatCount: 1,
                    packSlots: ["vintage-cube"],
                    seed: 7,
                    draftRound: 0,
                    draftPacksRemaining: 1,
                    seats: [
                        {
                            seatIndex: 0,
                            userId: "user1",
                            nickname: "Alice",
                            poolCount: 0,
                        },
                    ],
                    ...(inlinePool ? { cubePool: pool } : {}),
                    createdAt: 0,
                    updatedAt: 100,
                },
            ],
            limitedSeats: [
                {
                    _id: "seat-cube-0",
                    eventId: EVENT_ID,
                    seatIndex: 0,
                    pool: [],
                    currentPack: PACK,
                },
            ],
            limitedSelections: [],
            ...(inlinePool
                ? {}
                : {
                      limitedCubePools: [
                          { _id: "cubepool-1", eventId: EVENT_ID, pool },
                      ],
                  }),
        },
        { identitySubject: "user1|session1" }
    );
}

const selectHandler = (
    selectDraftPick as unknown as {
        _handler: (
            ctx: MutationCtx,
            args: { eventId: Id<"limitedEvents">; pickId: string | null }
        ) => Promise<null>;
    }
)._handler;

const getEventHandler = (
    getLimitedEvent as unknown as {
        _handler: (
            ctx: QueryCtx,
            args: { eventId: Id<"limitedEvents"> }
        ) => Promise<{ cubePool: string[] | null } | null>;
    }
)._handler;

describe("selectDraftPick — a click costs one small row (limitedSelections)", () => {
    it("writes the selection row and NOTHING else", async () => {
        const { ctx, tables, writes } = seedDraft();
        writes.length = 0;

        await selectHandler(ctx, { eventId: EVENT_ID, pickId: "r0-p0-c1" });

        // The whole point: the shared event document is untouched, so no other
        // seat's subscription re-executes and no pick contends with this write.
        expect(writes.map((w) => w.table)).toEqual(["limitedSelections"]);
        expect(tables.limitedSelections).toMatchObject([
            { eventId: EVENT_ID, seatIndex: 0, pickId: "r0-p0-c1" },
        ]);
        // `updatedAt` is deliberately not bumped — bumping it would BE the
        // event-row write this change removed.
        expect(tables.limitedEvents[0].updatedAt).toBe(100);
    });

    it("clearing deletes the row", async () => {
        const { ctx, tables } = seedDraft();
        await selectHandler(ctx, { eventId: EVENT_ID, pickId: "r0-p0-c1" });
        await selectHandler(ctx, { eventId: EVENT_ID, pickId: null });
        expect(tables.limitedSelections).toHaveLength(0);
    });

    it("still refuses a pickId that is not in the caller's own pack", async () => {
        const { ctx } = seedDraft();
        await expect(
            selectHandler(ctx, { eventId: EVENT_ID, pickId: "r9-p9-c9" })
        ).rejects.toThrow(/not in your current pack/);
    });
});

describe("getLimitedEvent — the cube pool is off the read path", () => {
    it("never reads limitedCubePools for a non-admin viewer", async () => {
        const { ctx, reads } = seedDraft();
        reads.length = 0;

        const view = await getEventHandler(ctx, { eventId: EVENT_ID });

        expect(reads.some((r) => r.table === "limitedCubePools")).toBe(false);
        // …and the pool was never on the wire for this viewer anyway, which is
        // why reading it was pure waste.
        expect(view?.cubePool).toBeNull();
    });
});

describe("limitedCubePoolStore — child row wins, inline copy still works", () => {
    const event = (row: Record<string, unknown>) =>
        row as unknown as Doc<"limitedEvents">;

    it("reads the child row", async () => {
        const { ctx, tables } = seedDraft();
        const loaded = await loadCubePool(ctx, event(tables.limitedEvents[0]));
        expect(loaded).toHaveLength(40);
        expect(loaded?.[0]).toBe("cube-card-0");
    });

    it("folds in a LEGACY inline pool when no child row exists", async () => {
        const { ctx, tables } = seedDraft({ inlinePool: true });
        const loaded = await loadCubePool(ctx, event(tables.limitedEvents[0]));
        expect(loaded).toHaveLength(40);
    });

    it("prefers the child row over a stale inline copy", async () => {
        const { ctx, tables } = seedDraft({ inlinePool: true });
        await saveCubePool(ctx, EVENT_ID, ["fresh"]);
        expect(await loadCubePool(ctx, event(tables.limitedEvents[0]))).toEqual(
            ["fresh"]
        );
    });

    it("deleteCubePool drops the row", async () => {
        const { ctx, tables } = seedDraft();
        await deleteCubePool(ctx, EVENT_ID);
        expect(tables.limitedCubePools).toHaveLength(0);
        // The event row carries no inline copy either, so a non-cube event and
        // a deleted one read alike: nothing.
        expect(
            await loadCubePool(ctx, event(tables.limitedEvents[0]))
        ).toBeUndefined();
    });
});

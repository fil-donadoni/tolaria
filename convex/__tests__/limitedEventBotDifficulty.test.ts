// Bot difficulty per Limited Event (issue #6916): chosen at `createLimitedEvent`,
// resolved for legacy rows, and read back per Game by the vs-AI driver through
// `getMatchBotDifficulty`. The project has no convex-test harness, so the
// REGISTERED handlers run against in-memory ctxs (see `getSeatDeck.test.ts`).
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getMatchBotDifficulty } from "../gameReads";
import { createLimitedEvent } from "../limitedEvents";
import { DEFAULT_DIFFICULTY } from "../gre/difficulty";
import { resolveEventBotDifficulty } from "../limited/botDifficulty";
import {
    makeInMemoryDb,
    type InMemoryRow,
} from "./fixtures/inMemoryDb.fixture";

type Handler<A, R, C> = { _handler: (ctx: C, args: A) => Promise<R> };

async function createEvent(
    botDifficulty?: "easy" | "medium" | "hard" | "expert"
): Promise<Record<string, unknown>> {
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
    } as unknown as MutationCtx;
    const id = await (
        createLimitedEvent as unknown as Handler<unknown, string, MutationCtx>
    )._handler(ctx, {
        type: "draft",
        seatCount: 2,
        packSource: "lea",
        botDifficulty,
    });
    return docs.get(id)!;
}

describe("createLimitedEvent — Bot difficulty (issue #6916)", () => {
    it("stores the creator's choice on the event", async () => {
        expect((await createEvent("hard")).botDifficulty).toBe("hard");
    });

    it("defaults to medium when the setup sends none", async () => {
        expect((await createEvent()).botDifficulty).toBe("medium");
    });

    it("resolves an event row written before the field to medium", () => {
        expect(resolveEventBotDifficulty({})).toBe("medium");
        expect(resolveEventBotDifficulty({})).toBe(DEFAULT_DIFFICULTY);
        expect(resolveEventBotDifficulty({ botDifficulty: "expert" })).toBe(
            "expert"
        );
    });
});

describe("getMatchBotDifficulty (issue #6916)", () => {
    const row = (r: Record<string, unknown>) => r as unknown as InMemoryRow;
    const ask = (
        tables: Record<string, InMemoryRow[]>,
        gameId: string
    ): Promise<string | null> =>
        (
            getMatchBotDifficulty as unknown as Handler<
                { gameId: Id<"games"> },
                string | null,
                QueryCtx
            >
        )._handler(makeInMemoryDb(tables).ctx as unknown as QueryCtx, {
            gameId: gameId as Id<"games">,
        });

    it("answers the difficulty its Match was started with", async () => {
        const tables = {
            matches: [row({ _id: "m1", botDifficulty: "hard" })],
            games: [row({ _id: "g1", matchId: "m1" })],
        };
        expect(await ask(tables, "g1")).toBe("hard");
    });

    it("answers null for a Match that carries none (lobby Match, legacy row)", async () => {
        const tables = {
            matches: [row({ _id: "m1" })],
            games: [row({ _id: "g1", matchId: "m1" })],
        };
        expect(await ask(tables, "g1")).toBeNull();
    });

    it("answers null for a Game with no Match or an unknown Game", async () => {
        const tables = { games: [row({ _id: "g1" })] };
        expect(await ask(tables, "g1")).toBeNull();
        expect(await ask(tables, "nope")).toBeNull();
    });
});

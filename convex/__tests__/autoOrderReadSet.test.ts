// Issue #10900 — the auto-order hydration (issue #9988) must not read the
// `games` row on every game mutation. A vs-AI Game's second seat (`-p2`) is
// the Bot's, and telling it from a human `-p2` seat needs the `vsAi` flag —
// which the `gameStates` row mirrors at insert (`convex/schema.ts`) and the
// loader has just read. Reading `games` for it put a whole extra document in
// every mutation's read set (Convex bills a read by the whole document).
//
// Driven through the real seam: `saveGameState` stamps the mode flags,
// `getLatestGameState` loads the position and hydrates `autoOrderSeatIds`.

import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import { getLatestGameState, saveGameState } from "../gameStateStore";
import { makePlayer, makeState } from "../cards/__tests__/setup.helper";
import {
    makeMutationCtx,
    type MutationStub,
    type Row,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;
const USER = "u1";
const HUMAN = `${USER}-p1`;
const BOT = `${USER}-p2`;

function vsAiGameRow(): Row {
    return {
        _id: GAME_ID,
        __table: "games",
        name: "Game",
        status: "playing",
        solo: true,
        vsAi: true,
        players: [{ id: HUMAN }, { id: BOT }],
        createdAt: 0,
        updatedAt: 0,
    };
}

function optedInSettings(): Row {
    return {
        _id: "settings-1",
        __table: "userSettings",
        userId: USER,
        autoOrderPrompts: true,
    };
}

async function savedVsAiGame(): Promise<MutationStub> {
    const stub = makeMutationCtx(USER, [vsAiGameRow(), optedInSettings()]);
    const state = makeState({
        players: [makePlayer(HUMAN), makePlayer(BOT)],
    });
    await saveGameState(stub.ctx, GAME_ID, 0, state, null);
    return stub;
}

function hotRow(stub: MutationStub): Row {
    const write = stub.writes.find((w) => w.table === "gameStates");
    return stub.doc(write!.id);
}

describe("auto-order hydration reads no `games` row (issue #10900)", () => {
    it("takes vsAi off the loaded gameStates row", async () => {
        const stub = await savedVsAiGame();
        expect(hotRow(stub).vsAi).toBe(true);
        stub.gets.length = 0;

        const loaded = (await getLatestGameState(stub.ctx, GAME_ID))!;

        expect(stub.gets).not.toContain(GAME_ID);
        // The opted-in human seat is listed, the Bot seat never is.
        expect(loaded.state.autoOrderSeatIds).toEqual([HUMAN]);
    });

    it("a legacy row with neither mode flag still reads `games`", async () => {
        const stub = await savedVsAiGame();
        const row = hotRow(stub);
        delete row.solo;
        delete row.vsAi;
        stub.gets.length = 0;

        const loaded = (await getLatestGameState(stub.ctx, GAME_ID))!;

        expect(stub.gets).toContain(GAME_ID);
        expect(loaded.state.autoOrderSeatIds).toEqual([HUMAN]);
    });
});

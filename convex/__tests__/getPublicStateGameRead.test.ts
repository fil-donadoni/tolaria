// `getPublicState` reads the `games` row for NOTHING but `solo`/`vsAi`
// (PRD #1776 follow-up).
//
// A document read in Convex is billed by the whole document, and the prod
// `games` row measured 8.3 KB — 7.33 KB of it the two decklists this query
// does not project. That read re-executed on every subscription re-run and was
// 54% of `getPublicState`'s database I/O, the single largest line on the
// deployment's bill. The flags are now mirrored onto the `gameStates` row the
// query already reads (`convex/schema.ts`).
//
// Every assertion here is about the READ SET, not the result: the projection
// is byte-identical whichever row the flags came from, so a regression that
// simply re-adds the `games` read is invisible to every result-shaped test and
// shows up only as a bill. The repo has no convex-test harness, so this drives
// the registered query's own `_handler` against the shared stub ctx
// (`gameMutationHarness.ts`).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { Id } from "../_generated/dataModel";
import type { GameState } from "../gre/state";
import { getPublicState } from "../game";
import { makePlayer, makeState } from "../cards/__tests__/setup";
import type { CardInstanceState } from "../gre/state";
import { makeMutationCtx, runMutation, type Row } from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

/** A hand card with an inline definition rather than a registry id: this file
 *  is about which seat the projection treats as the viewer, and nothing here
 *  depends on a real card. */
function handCard(owner: string): CardInstanceState {
    return {
        id: `${owner}-h1`,
        card: { id: `def-${owner}`, name: "Card", manaCost: { R: 1 } },
        controllerId: owner,
        ownerId: owner,
        zone: "hand",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
    } as unknown as CardInstanceState;
}

/** p2 is the chooser while priority still reads as p1 — the mid-resolution
 *  divergence a solo viewer must resolve (`computeSoloViewerId`). Each seat
 *  holds a card so "which seat did the projection pick as viewer" is readable
 *  off the wire: the viewer's hand comes back as cards, the other seat's as
 *  nulls (ADR 0026). Without the solo branch the viewer is the requested
 *  `playerId` (p1) and the two swap. */
function stateWithSearch(): GameState {
    return makeState({
        players: [
            makePlayer("p1", { hand: [handCard("p1")] }),
            makePlayer("p2", { hand: [handCard("p2")] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingChoices: [
            {
                stackItemId: "s1",
                step: 0,
                choiceId: "p2",
                playerId: "p2",
                kind: "search-library",
                zone: "library",
                count: 1,
                prompt: "Search your library for a card.",
            },
        ],
    });
}

/** The fat `games` row: solo, and carrying the decklists that make it fat. */
function gameRow(): Row {
    return {
        _id: GAME_ID,
        __table: "games",
        name: "Solo",
        status: "playing",
        solo: true,
        players: [
            { id: "p1", name: "P1", bgColor: "#000", deck: { cards: [] } },
            { id: "p2", name: "P2", bgColor: "#111", deck: { cards: [] } },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

/** `mirror: false` seeds the legacy shape — a row written before the mirror
 *  existed, carrying NEITHER flag. */
function stateRow(mirror: boolean): Row {
    return {
        _id: "gs-1",
        __table: "gameStates",
        gameId: GAME_ID,
        seq: 1,
        state: stateWithSearch(),
        ...(mirror ? { solo: true, vsAi: false } : {}),
        updatedAt: 0,
    };
}

interface PublicState {
    players: { id: string; hand: (unknown | null)[] }[];
}

/** Which seat the projection treated as the viewer: the one whose hand came
 *  back as real cards rather than nulls. */
function viewerSeat(result: PublicState): string {
    return result.players.find((p) => p.hand.every((c) => c !== null))!.id;
}

async function project(mirror: boolean) {
    const { ctx, gets } = makeMutationCtx("u1", [gameRow(), stateRow(mirror)]);
    const result = await runMutation<
        { gameId: Id<"games">; playerId: string },
        PublicState
    >(getPublicState, ctx, { gameId: GAME_ID, playerId: "p1" });
    return { result, gets };
}

describe("getPublicState — the games row is not on the hot path", () => {
    it("resolves the solo viewer from the mirror WITHOUT reading the games row", async () => {
        const { result, gets } = await project(true);

        // The solo branch ran: the viewer followed the chooser (p2), not the
        // requested playerId (p1).
        expect(viewerSeat(result)).toBe("p2");
        // …and it did so without touching the 8.3 KB row.
        expect(gets).not.toContain(GAME_ID);
    });

    it("falls back to the games row for a state written before the mirror", async () => {
        const { result, gets } = await project(false);

        // Same answer — a legacy row must not silently lose solo mode.
        expect(viewerSeat(result)).toBe("p2");
        // …and THIS is the case that pays for the fat read, which is what
        // makes running `backfillGameStateMode` part of the deploy.
        expect(gets).toContain(GAME_ID);
    });
});

describe("gameStates insert stamps the mirror", () => {
    // A structural guard rather than a behavioural one: reaching the insert
    // branch of `saveGameState` means driving a whole Game into existence
    // (`chooseFirstPlayer` → `buildInitialGameState` off real decklists), and
    // the failure this defends against is not a wrong answer but a silent loss
    // of the saving — an unstamped row still projects correctly, by falling
    // back to the fat read forever. `saveGameState` is private, and the schema
    // comment states it is the SOLE inserter, so the invariant worth pinning is
    // exactly that: one insert site, and it writes both flags.
    it('every insert("gameStates") in game.ts writes solo and vsAi', () => {
        const source = fs.readFileSync(
            path.join(import.meta.dirname, "..", "game.ts"),
            "utf8"
        );
        const sites = [...source.matchAll(/insert\("gameStates",\s*\{/g)];
        expect(sites).toHaveLength(1);

        const body = source.slice(
            sites[0].index!,
            source.indexOf("});", sites[0].index!)
        );
        expect(body).toMatch(/\bsolo:/);
        expect(body).toMatch(/\bvsAi:/);
    });
});

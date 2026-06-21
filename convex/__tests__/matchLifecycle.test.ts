import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import {
    ACTIVE_MATCH_STATUSES,
    gamesToWin,
    matchBelongsToUser,
    projectMatch,
    recordGameResult,
    snapshotDeck,
    type MatchCore,
    type MatchPlayer,
} from "../matches";

// The Match orchestration (ADR 0029 / PRD #387). The project has no convex-test
// harness, so — like gameLifecycle.test.ts — these tests drive the SAME pure
// functions the `game.ts` mutations call (recordGameResult on finalizeGameOver,
// snapshotDeck on create, the single-active-match guard, the projection) and
// assert external behavior at the highest available seam.

function player(id: string, score = 0, ready = false): MatchPlayer {
    return {
        id,
        name: id,
        bgColor: "#000",
        deck: snapshotDeck({
            id: "d",
            name: "Deck",
            format: "vintage",
            maindeck: [{ cardId: "c1", cardName: "Card 1" }],
            sideboard: [{ cardId: "s1", cardName: "Side 1" }],
        }),
        score,
        ready,
    };
}

function match(bestOf: 1 | 3, players: MatchPlayer[]): MatchCore {
    return {
        bestOf,
        status: "playing",
        players,
        currentGameNumber: 1,
    };
}

describe("gamesToWin (CR 100.6 best-of-N)", () => {
    it("Bo1 needs 1 game, Bo3 needs 2", () => {
        expect(gamesToWin(1)).toBe(1);
        expect(gamesToWin(3)).toBe(2);
    });
});

describe("snapshotDeck (PRD #387 — Match deck copy)", () => {
    it("copies maindeck + sideboard into independent arrays", () => {
        const main = [{ cardId: "c", cardName: "C" }];
        const deck = snapshotDeck({
            id: "d",
            name: "D",
            format: "vintage",
            maindeck: main,
        });
        expect(deck.maindeck).toEqual(main);
        expect(deck.maindeck).not.toBe(main); // defensive copy
        expect(deck.sideboard).toEqual([]); // absent → empty
    });
});

describe("recordGameResult — Bo1 spine (PRD #387)", () => {
    it("a single Game win finishes the Bo1 Match and sets the winner", () => {
        const m = match(1, [player("a"), player("b")]);
        const patch = recordGameResult(m, "a");
        expect(patch).not.toBeNull();
        expect(patch!.status).toBe("finished");
        expect(patch!.winner).toBe("a");
        // winner's score bumped to the games-to-win threshold
        expect(patch!.players!.find((p) => p.id === "a")!.score).toBe(1);
        expect(patch!.players!.find((p) => p.id === "b")!.score).toBe(0);
    });

    it("a draw (no winner in the seat list) leaves the Match untouched", () => {
        const m = match(1, [player("a"), player("b")]);
        expect(recordGameResult(m, "ghost")).toBeNull();
    });
});

describe("recordGameResult — Bo3 transitions (PRD #387)", () => {
    it("a non-deciding Game routes to sideboarding and resets ready", () => {
        const m = match(3, [player("a"), player("b", 0, true)]);
        const patch = recordGameResult(m, "a");
        expect(patch!.status).toBe("sideboarding");
        expect(patch!.winner).toBeUndefined();
        expect(patch!.players!.find((p) => p.id === "a")!.score).toBe(1);
        // both ready flags reset between Games
        expect(patch!.players!.every((p) => p.ready === false)).toBe(true);
        // the previous Game's loser chooses play/draw next
        expect(patch!.playDrawChooserId).toBe("b");
    });

    it("reaching 2 wins finishes the Bo3 Match", () => {
        const m = match(3, [player("a", 1), player("b")]);
        const patch = recordGameResult(m, "a");
        expect(patch!.status).toBe("finished");
        expect(patch!.winner).toBe("a");
        expect(patch!.players!.find((p) => p.id === "a")!.score).toBe(2);
    });
});

describe("matchBelongsToUser (#155 → single-active-match guard)", () => {
    const userId = "user_abc123";
    const other = "user_xyz789";
    const m = (ids: string[]) => ({ players: ids.map((id) => ({ id })) });

    it("matches a 2-player seat, both solo seats, and rejects other users", () => {
        expect(matchBelongsToUser(m([userId, other]), userId)).toBe(true);
        expect(
            matchBelongsToUser(m([`${userId}-p1`, `${userId}-p2`]), userId)
        ).toBe(true);
        expect(matchBelongsToUser(m([other]), userId)).toBe(false);
        expect(matchBelongsToUser(m([`prefix${userId}`]), userId)).toBe(false);
    });

    it("counts only waiting / playing / sideboarding as active", () => {
        expect(ACTIVE_MATCH_STATUSES).toEqual([
            "waiting",
            "playing",
            "sideboarding",
        ]);
        expect(ACTIVE_MATCH_STATUSES).not.toContain("finished");
    });
});

// --- Projection (wire-format seam, PRD #387) ------------------------------

function matchDoc(overrides: Partial<Doc<"matches">> = {}): Doc<"matches"> {
    return {
        _id: "match_1" as Id<"matches">,
        _creationTime: 0,
        bestOf: 1,
        status: "playing",
        players: [player("p1"), player("p2")],
        currentGameNumber: 1,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as Doc<"matches">;
}

describe("projectMatch (wire format, PRD #387)", () => {
    it("exposes public meta to both players (score, status, format)", () => {
        const proj = projectMatch(
            matchDoc({
                bestOf: 1,
                status: "finished",
                winner: "p1",
                players: [player("p1", 1), player("p2")],
            }),
            "p1"
        );
        expect(proj.bestOf).toBe(1);
        expect(proj.status).toBe("finished");
        expect(proj.winner).toBe("p1");
        expect(proj.players.map((p) => p.score)).toEqual([1, 0]);
    });

    it("strips the opponent's deck copy in a 2-player Match", () => {
        const proj = projectMatch(matchDoc(), "p1");
        const me = proj.players.find((p) => p.id === "p1")!;
        const opp = proj.players.find((p) => p.id === "p2")!;
        expect(me.deck).toBeDefined();
        expect(me.deck!.maindeck.length).toBe(1);
        // opponent's contents are secret during the Match
        expect(opp.deck).toBeUndefined();
        // ready-state is still visible so the UI can show "waiting on opponent"
        expect(opp.ready).toBe(false);
    });

    it("Solo reveals both seats' deck copies", () => {
        const proj = projectMatch(
            matchDoc({
                solo: true,
                players: [player("u-p1"), player("u-p2")],
            }),
            "u" // viewer is the single user behind both seats
        );
        expect(proj.players.every((p) => p.deck !== undefined)).toBe(true);
    });
});

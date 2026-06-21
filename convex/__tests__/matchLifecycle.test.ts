import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import {
    ACTIVE_MATCH_STATUSES,
    buildNextGameSeats,
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

// --- buildNextGameSeats (Continue → next Game, PRD #387) ------------------

describe("buildNextGameSeats (Bo3 next-Game build, PRD #387)", () => {
    it("maps each Match player to a seat whose library is its maindeck", () => {
        const m = match(3, [player("a"), player("b")]);
        const seats = buildNextGameSeats(m);
        expect(seats.map((s) => s.id)).toEqual(["a", "b"]);
        // library cards come from the Match maindeck (cards[] = maindeck)
        expect(seats[0].deck.cards).toEqual([
            { cardId: "c1", cardName: "Card 1" },
        ]);
        // defensive copy — the new Game owns its own arrays
        expect(seats[0].deck.cards).not.toBe(m.players[0].deck.maindeck);
        expect(seats[0].deck.sideboard).toEqual([
            { cardId: "s1", cardName: "Side 1" },
        ]);
    });
});

// --- Bo3 end-to-end progression (PRD #387, AC: integration test) ----------
//
// The project has no convex-test harness, so this drives the SAME pure
// transitions the Convex mutations call across a full Bo3 — `recordGameResult`
// (finalizeGameOver) applied to a mutable Match between Games, with
// `buildNextGameSeats` (continueMatch) threading the next-Game build. It
// asserts: score progression 0→1→1→2, the interstitial gate ("sideboarding")
// after each undecided Game, the next-Game seat build, and the terminal
// transition ("finished" + winner) once a player reaches two wins.

/** Applies a `recordGameResult` patch onto a mutable Match, mirroring how the
 *  `finalizeGameOver` mutation patches the `matches` row. */
function applyResult(m: MatchCore, winnerId: string): MatchCore {
    const patch = recordGameResult(m, winnerId);
    if (!patch) return m;
    return { ...m, ...patch };
}

/** Mirrors `continueMatch`: an undecided Match advances to the next Game —
 *  status flips back to "playing", the game counter bumps, and the seats are
 *  rebuilt from the current maindeck. */
function continueToNextGame(m: MatchCore): {
    match: MatchCore;
    seatIds: string[];
} {
    expect(m.status).toBe("sideboarding");
    const seats = buildNextGameSeats(m);
    return {
        match: {
            ...m,
            status: "playing",
            currentGameNumber: m.currentGameNumber + 1,
        },
        seatIds: seats.map((s) => s.id),
    };
}

describe("Bo3 Match plays to two wins (PRD #387 — integration)", () => {
    it("score progresses across Games and transitions interstitial → terminal", () => {
        let m = match(3, [player("a"), player("b")]);
        expect(gamesToWin(m.bestOf)).toBe(2);

        // --- Game 1: A wins. Undecided → interstitial. ---
        m = applyResult(m, "a");
        expect(m.status).toBe("sideboarding"); // interstitial gate
        expect(m.winner).toBeUndefined();
        expect(m.players.find((p) => p.id === "a")!.score).toBe(1);
        expect(m.players.find((p) => p.id === "b")!.score).toBe(0);
        // the previous Game's loser is recorded as the next play/draw chooser
        expect(m.playDrawChooserId).toBe("b");

        // Continue → Game 2 auto-builds from the maindeck.
        const cont1 = continueToNextGame(m);
        m = cont1.match;
        expect(m.status).toBe("playing");
        expect(m.currentGameNumber).toBe(2);
        expect(cont1.seatIds).toEqual(["a", "b"]);

        // --- Game 2: B wins. Score 1–1, still undecided → interstitial. ---
        m = applyResult(m, "b");
        expect(m.status).toBe("sideboarding");
        expect(m.winner).toBeUndefined();
        expect(m.players.find((p) => p.id === "a")!.score).toBe(1);
        expect(m.players.find((p) => p.id === "b")!.score).toBe(1);

        // Continue → Game 3 (the decider).
        const cont2 = continueToNextGame(m);
        m = cont2.match;
        expect(m.status).toBe("playing");
        expect(m.currentGameNumber).toBe(3);

        // --- Game 3: A wins → reaches two wins → terminal Match result. ---
        m = applyResult(m, "a");
        expect(m.status).toBe("finished"); // terminal
        expect(m.winner).toBe("a");
        expect(m.players.find((p) => p.id === "a")!.score).toBe(2);
        expect(m.players.find((p) => p.id === "b")!.score).toBe(1);
    });

    it("a 2–0 sweep finishes the Match without a third Game", () => {
        let m = match(3, [player("a"), player("b")]);
        m = applyResult(m, "a");
        expect(m.status).toBe("sideboarding");
        m = continueToNextGame(m).match;
        m = applyResult(m, "a");
        expect(m.status).toBe("finished");
        expect(m.winner).toBe("a");
        expect(m.players.find((p) => p.id === "a")!.score).toBe(2);
    });

    it("Bo1 collapses straight to the terminal result (no interstitial)", () => {
        let m = match(1, [player("a"), player("b")]);
        m = applyResult(m, "a");
        expect(m.status).toBe("finished");
        expect(m.winner).toBe("a");
    });
});

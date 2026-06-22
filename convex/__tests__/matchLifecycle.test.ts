import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import {
    ACTIVE_MATCH_STATUSES,
    allSeatsReady,
    applySideboard,
    botIsChooser,
    botSeatId,
    buildNextGameSeats,
    forfeitMatch,
    gamesToWin,
    isBotSeat,
    matchBelongsToUser,
    nextGameActivePlayerId,
    projectMatch,
    recordGameResult,
    snapshotDeck,
    type MatchCore,
    type MatchDeck,
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

describe("forfeitMatch — ends the whole Match (PRD #387 / issue #396)", () => {
    it("Bo1: forfeit ends the Match, opponent wins (== conceding the Game)", () => {
        const m = match(1, [player("a"), player("b")]);
        const patch = forfeitMatch(m, "a");
        expect(patch).not.toBeNull();
        expect(patch!.status).toBe("finished");
        expect(patch!.winner).toBe("b");
        // Opponent is awarded the one game needed to win the Bo1.
        expect(patch!.players!.find((p) => p.id === "b")!.score).toBe(1);
        expect(patch!.players!.find((p) => p.id === "a")!.score).toBe(0);
    });

    it("Bo3: forfeit at 0–0 ends the Match, opponent jumps to 2 wins", () => {
        const m = match(3, [player("a"), player("b")]);
        const patch = forfeitMatch(m, "a");
        expect(patch!.status).toBe("finished");
        expect(patch!.winner).toBe("b");
        expect(patch!.players!.find((p) => p.id === "b")!.score).toBe(2);
        expect(patch!.players!.find((p) => p.id === "a")!.score).toBe(0);
    });

    it("Bo3: forfeit mid-Match (1–1) still finishes; opponent reaches 2", () => {
        const m = match(3, [player("a", 1), player("b", 1)]);
        const patch = forfeitMatch(m, "a");
        expect(patch!.status).toBe("finished");
        expect(patch!.winner).toBe("b");
        // Opponent already had 1; forfeit lifts them to the games-to-win (2).
        expect(patch!.players!.find((p) => p.id === "b")!.score).toBe(2);
        // The forfeiter's own score is untouched.
        expect(patch!.players!.find((p) => p.id === "a")!.score).toBe(1);
    });

    it("an unknown forfeiter (no such seat) is a no-op", () => {
        const m = match(3, [player("a"), player("b")]);
        expect(forfeitMatch(m, "ghost")).toBeNull();
    });
});

// Concede-vs-Forfeit equivalence/divergence (#396). Conceding a Game routes
// through `recordGameResult` (what `finalizeGameOver` calls); forfeiting routes
// through `forfeitMatch`. In a Bo1 they coincide (both finish the Match); in a
// Bo3 they diverge — a concede of Game 1 leaves the Match in progress (score
// 0–1, sideboarding gate), while a forfeit ends it outright.
describe("concede (Game) vs forfeit (Match) — integration (#396)", () => {
    it("Bo1: concede and forfeit both finish the Match with the opponent", () => {
        const m = match(1, [player("a"), player("b")]);
        // Concede = the loser's opponent wins the Game → recordGameResult.
        const conceded = recordGameResult(m, "b");
        const forfeited = forfeitMatch(m, "a");
        expect(conceded!.status).toBe("finished");
        expect(forfeited!.status).toBe("finished");
        expect(conceded!.winner).toBe("b");
        expect(forfeited!.winner).toBe("b");
    });

    it("Bo3: conceding Game 1 leaves the Match in progress (0–1, sideboarding)", () => {
        const m = match(3, [player("a"), player("b")]);
        // A concedes Game 1 → B wins that Game; the Match is undecided.
        const patch = recordGameResult(m, "b")!;
        const after = { ...m, ...patch };
        expect(after.status).toBe("sideboarding"); // proceeds to next step
        expect(after.winner).toBeUndefined(); // Match NOT decided
        expect(after.players.find((p) => p.id === "a")!.score).toBe(0);
        expect(after.players.find((p) => p.id === "b")!.score).toBe(1);
    });

    it("Bo3: forfeiting Game 1's position ends the Match immediately", () => {
        const m = match(3, [player("a"), player("b")]);
        const patch = forfeitMatch(m, "a")!;
        const after = { ...m, ...patch };
        expect(after.status).toBe("finished"); // ends immediately
        expect(after.winner).toBe("b");
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
        // the per-Game seat snapshot holds ONLY the maindeck — the sideboard
        // lives on the Match copy and never reaches the `games` row (PRD #387,
        // matches the `games` table schema which has no `sideboard` field).
        expect(seats[0].deck).not.toHaveProperty("sideboard");
    });
});

// --- Play/draw choice for Games 2+ (#394, CR 103.4) -----------------------

describe("nextGameActivePlayerId (#394, CR 103.4)", () => {
    const m = (chooser: string | undefined) => ({
        players: [{ id: "a" }, { id: "b" }],
        playDrawChooserId: chooser,
    });

    it("'play' makes the chooser the active player", () => {
        expect(nextGameActivePlayerId(m("b"), "play")).toBe("b");
    });

    it("'draw' makes the opponent the active player", () => {
        expect(nextGameActivePlayerId(m("b"), "draw")).toBe("a");
    });

    it("falls back to undefined (default active player) with no chooser", () => {
        expect(nextGameActivePlayerId(m(undefined), "play")).toBeUndefined();
    });

    it("falls back to undefined when the chooser isn't a seat", () => {
        expect(nextGameActivePlayerId(m("ghost"), "play")).toBeUndefined();
    });
});

describe("botIsChooser / isBotSeat (#394 — vs-AI auto-play)", () => {
    it("the bot seat is the `${userId}-p2` seat (ADR 0001)", () => {
        expect(isBotSeat("u1-p2")).toBe(true);
        expect(isBotSeat("u1-p1")).toBe(false);
        expect(isBotSeat("u1")).toBe(false);
    });

    it("the bot is the chooser only in a vs-AI Match whose chooser is `-p2`", () => {
        expect(botIsChooser({ vsAi: true, playDrawChooserId: "u1-p2" })).toBe(
            true
        );
        // human chooser (`-p1`) → not the bot
        expect(botIsChooser({ vsAi: true, playDrawChooserId: "u1-p1" })).toBe(
            false
        );
        // non-AI Match has no bot, even at a `-p2` seat (solo human/human)
        expect(botIsChooser({ vsAi: false, playDrawChooserId: "u1-p2" })).toBe(
            false
        );
        // no chooser recorded
        expect(botIsChooser({ vsAi: true })).toBe(false);
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
 *  status flips back to "playing", the game counter bumps, the seats are rebuilt
 *  from the current maindeck, and the chooser's play/draw `choice` resolves the
 *  turn-1 active player (#394). `playDrawChooserId` is consumed (cleared). */
function continueToNextGame(
    m: MatchCore,
    choice: "play" | "draw" = "play"
): {
    match: MatchCore;
    seatIds: string[];
    activePlayerId: string | undefined;
} {
    expect(m.status).toBe("sideboarding");
    const seats = buildNextGameSeats(m);
    // Mirror continueMatch: bot chooser auto-plays; otherwise use the choice.
    const effective = botIsChooser(m) ? "play" : choice;
    const activePlayerId = nextGameActivePlayerId(m, effective);
    return {
        match: {
            ...m,
            status: "playing",
            currentGameNumber: m.currentGameNumber + 1,
            playDrawChooserId: undefined,
        },
        seatIds: seats.map((s) => s.id),
        activePlayerId,
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

    // #394: the loser of the previous Game chooses play/draw, which sets the
    // turn-1 active player of the next Game. The on-the-play skip-first-draw rule
    // is independent of which player is active (keys off `state.turn === 1`,
    // CR 103.8) — covered by phases.test.ts "skips draw on turn 1".
    it("the previous Game's loser chooses play → loser is active player 2", () => {
        let m = match(3, [player("a"), player("b")]);
        // Game 1: A wins → B (the loser) is the recorded chooser.
        m = applyResult(m, "a");
        expect(m.playDrawChooserId).toBe("b");
        // B chooses PLAY → B is the active player at turn 1 of Game 2.
        const cont = continueToNextGame(m, "play");
        expect(cont.activePlayerId).toBe("b");
        expect(cont.match.playDrawChooserId).toBeUndefined();
    });

    it("the previous Game's loser chooses draw → opponent is active player 2", () => {
        let m = match(3, [player("a"), player("b")]);
        m = applyResult(m, "a"); // B is the chooser
        const cont = continueToNextGame(m, "draw");
        // "draw" hands the first turn to A (the winner / opponent of the chooser).
        expect(cont.activePlayerId).toBe("a");
    });

    it("vs-AI: when the bot is the chooser it auto-chooses play", () => {
        let m: MatchCore = {
            ...match(3, [player("u1-p1"), player("u1-p2")]),
            vsAi: true,
        };
        // Game 1: the human (-p1) wins → the bot (-p2) is the chooser.
        m = applyResult(m, "u1-p1");
        expect(m.playDrawChooserId).toBe("u1-p2");
        expect(botIsChooser(m)).toBe(true);
        // continueMatch forces "play" for the bot even if "draw" is requested.
        const cont = continueToNextGame(m, "draw");
        expect(cont.activePlayerId).toBe("u1-p2");
    });
});

// --- Sideboarding step + ready gate (issue #395) --------------------------
//
// `applySideboard` is the pure heart of the Sideboarding step: it re-partitions
// a player's Match deck copy under two invariants (size-lock + pool
// preservation) and rejects any illegal swap. The mutations (`submitSideboard` /
// `setReady`) are thin wrappers — these tests drive the same pure function they
// call, plus the readiness predicates, then an end-to-end "play a Game →
// sideboard → ready → next Game library reflects the new Maindeck" integration.

function deck(
    maindeck: { cardId: string; cardName: string }[],
    sideboard: { cardId: string; cardName: string }[] = []
): MatchDeck {
    return snapshotDeck({
        id: "d",
        name: "Deck",
        format: "vintage",
        maindeck,
        sideboard,
    });
}

const C = (id: string) => ({ cardId: id, cardName: id });

describe("applySideboard — size-lock + pool preservation (issue #395)", () => {
    it("applies a valid swap (one card main↔side) and keeps the deck copy", () => {
        const d = deck([C("a"), C("b")], [C("x")]);
        // Swap: b → sideboard, x → maindeck. Maindeck stays size 2.
        const next = applySideboard(d, {
            maindeck: [C("a"), C("x")],
            sideboard: [C("b")],
        });
        expect(next.maindeck.map((c) => c.cardId).sort()).toEqual(["a", "x"]);
        expect(next.sideboard.map((c) => c.cardId)).toEqual(["b"]);
        // Defensive copies — the returned deck owns its own arrays.
        expect(next.maindeck).not.toBe(d.maindeck);
        // Metadata carried over unchanged.
        expect(next.id).toBe("d");
        expect(next.format).toBe("vintage");
    });

    it("a no-op (no swaps) is valid and returns the same partition", () => {
        const d = deck([C("a"), C("b")], [C("x")]);
        const next = applySideboard(d, {
            maindeck: [C("a"), C("b")],
            sideboard: [C("x")],
        });
        expect(next.maindeck.map((c) => c.cardId)).toEqual(["a", "b"]);
        expect(next.sideboard.map((c) => c.cardId)).toEqual(["x"]);
    });

    it("rejects a size-lock violation (Maindeck shrinks)", () => {
        const d = deck([C("a"), C("b")], [C("x")]);
        // Moved b to side without bringing anything back → maindeck size 1 ≠ 2.
        expect(() =>
            applySideboard(d, {
                maindeck: [C("a")],
                sideboard: [C("b"), C("x")],
            })
        ).toThrow(/locked/i);
    });

    it("rejects a size-lock violation (Maindeck grows)", () => {
        const d = deck([C("a"), C("b")], [C("x")]);
        expect(() =>
            applySideboard(d, {
                maindeck: [C("a"), C("b"), C("x")],
                sideboard: [],
            })
        ).toThrow(/locked/i);
    });

    it("rejects a pool violation (a card appears that wasn't in the pool)", () => {
        const d = deck([C("a"), C("b")], [C("x")]);
        // Same size (2) but the pool now contains a phantom "z" and drops "x".
        expect(() =>
            applySideboard(d, {
                maindeck: [C("a"), C("z")],
                sideboard: [C("b")],
            })
        ).toThrow(/pool/i);
    });

    it("preserves the combined pool across a valid swap (multiset unchanged)", () => {
        const d = deck([C("a"), C("a"), C("b")], [C("x"), C("y")]);
        const next = applySideboard(d, {
            // Swap both a's out for x and y; size stays 3.
            maindeck: [C("b"), C("x"), C("y")],
            sideboard: [C("a"), C("a")],
        });
        const pool = [...next.maindeck, ...next.sideboard]
            .map((c) => c.cardId)
            .sort();
        expect(pool).toEqual(["a", "a", "b", "x", "y"]);
    });
});

describe("allSeatsReady / botSeatId (ready gate, issue #395)", () => {
    it("the gate opens only once every seat is ready", () => {
        expect(
            allSeatsReady({ players: [{ ready: true }, { ready: false }] })
        ).toBe(false);
        expect(
            allSeatsReady({ players: [{ ready: true }, { ready: true }] })
        ).toBe(true);
        // an empty Match never readies
        expect(allSeatsReady({ players: [] })).toBe(false);
    });

    it("the bot seat is the vs-AI `-p2` seat, null otherwise", () => {
        expect(
            botSeatId({ vsAi: true, players: [{ id: "u-p1" }, { id: "u-p2" }] })
        ).toBe("u-p2");
        // not vs-AI → no bot seat even with a `-p2` seat (solo human/human)
        expect(
            botSeatId({
                vsAi: false,
                players: [{ id: "u-p1" }, { id: "u-p2" }],
            })
        ).toBeNull();
    });
});

// --- Integration: play → sideboard → ready → next Game (issue #395) --------
//
// Mirrors the `submitSideboard` + `setReady` mutations over a mutable Match:
// after Game 1 the Match is "sideboarding"; the loser swaps a Sideboard card
// into their Maindeck (`applySideboard`); both seats ready (`allSeatsReady`);
// the next Game is built from the POST-SWAP Maindeck. Asserts the next Game's
// library (`buildNextGameSeats` → `deck.cards`) reflects the new Maindeck.

/** Mirror `submitSideboard`: validate + persist the seat's new deck copy. */
function submit(
    m: MatchCore,
    seatId: string,
    next: {
        maindeck: { cardId: string; cardName: string }[];
        sideboard: { cardId: string; cardName: string }[];
    }
): MatchCore {
    const players = m.players.map((p) =>
        p.id === seatId ? { ...p, deck: applySideboard(p.deck, next) } : p
    );
    return { ...m, players };
}

/** Mirror `setReady`: ready a seat (auto-ready the bot in vs-AI). */
function ready(m: MatchCore, seatId: string): MatchCore {
    const bot = botSeatId(m);
    const players = m.players.map((p) => {
        if (p.id === seatId) return { ...p, ready: true };
        if (bot && p.id === bot) return { ...p, ready: true };
        return p;
    });
    return { ...m, players };
}

describe("Sideboarding integration: next Game library reflects the swap (#395)", () => {
    it("a swapped-in Sideboard card appears in the next Game's library", () => {
        // Game 1: A wins → Match routes to sideboarding, both ready reset.
        let m = match(3, [
            { ...player("a"), deck: deck([C("a1"), C("a2")], [C("aS")]) },
            { ...player("b"), deck: deck([C("b1"), C("b2")], [C("bS")]) },
        ]);
        m = { ...m, ...recordGameResult(m, "a")! };
        expect(m.status).toBe("sideboarding");
        expect(m.players.every((p) => p.ready === false)).toBe(true);

        // B (the loser/chooser) swaps b2 OUT and brings bS IN (size stays 2).
        m = submit(m, "b", {
            maindeck: [C("b1"), C("bS")],
            sideboard: [C("b2")],
        });
        // A leaves their deck unchanged but must still ready.
        m = submit(m, "a", {
            maindeck: [C("a1"), C("a2")],
            sideboard: [C("aS")],
        });

        // Ready B then A; the gate only opens once both are ready.
        m = ready(m, "b");
        expect(allSeatsReady(m)).toBe(false);
        m = ready(m, "a");
        expect(allSeatsReady(m)).toBe(true);

        // Build the next Game from the post-swap Maindecks.
        const seats = buildNextGameSeats(m);
        const bSeat = seats.find((s) => s.id === "b")!;
        const bLibrary = bSeat.deck.cards.map((c) => c.cardId).sort();
        // bS swapped in, b2 swapped out.
        expect(bLibrary).toEqual(["b1", "bS"]);
        // A's library is unchanged.
        const aSeat = seats.find((s) => s.id === "a")!;
        expect(aSeat.deck.cards.map((c) => c.cardId).sort()).toEqual([
            "a1",
            "a2",
        ]);
    });

    it("vs-AI: the human readies once and the bot auto-readies → gate opens", () => {
        let m: MatchCore = {
            ...match(3, [
                {
                    ...player("u-p1"),
                    deck: deck([C("h1"), C("h2")], [C("hS")]),
                },
                { ...player("u-p2"), deck: deck([C("ai1"), C("ai2")]) },
            ]),
            vsAi: true,
        };
        m = { ...m, ...recordGameResult(m, "u-p1")! };
        expect(m.status).toBe("sideboarding");

        // The human swaps; the bot makes no swaps.
        m = submit(m, "u-p1", {
            maindeck: [C("h1"), C("hS")],
            sideboard: [C("h2")],
        });
        // Human readies → the bot is auto-readied in the same step → gate opens.
        m = ready(m, "u-p1");
        expect(allSeatsReady(m)).toBe(true);

        const seats = buildNextGameSeats(m);
        expect(
            seats
                .find((s) => s.id === "u-p1")!
                .deck.cards.map((c) => c.cardId)
                .sort()
        ).toEqual(["h1", "hS"]);
    });

    it("swaps mutate the Match deck copy only (snapshot independence)", () => {
        // The Match deck is a snapshot; `applySideboard` returns a NEW deck and
        // never mutates the input — modelling the `userDecks` row staying intact.
        const original = deck([C("a"), C("b")], [C("x")]);
        const before = JSON.stringify(original);
        applySideboard(original, {
            maindeck: [C("a"), C("x")],
            sideboard: [C("b")],
        });
        expect(JSON.stringify(original)).toBe(before);
    });
});

// --- 2-player Sideboarding sync + barrier (issue #397) --------------------
//
// The both-ready BARRIER: in a 2-player Match the next Game must build only
// after BOTH seats are ready, regardless of order — neither seat triggers the
// build alone. Mirrors `setReady`'s gate (`allSeatsReady`) and the production
// rule that `buildNextGameForMatch` runs only past the gate.

describe("2-player ready barrier (issue #397)", () => {
    it("the next Game builds only after BOTH seats ready (either order)", () => {
        // Game 1: A wins → Match → sideboarding, both ready reset.
        let m = match(3, [player("a"), player("b")]);
        m = { ...m, ...recordGameResult(m, "a")! };
        expect(m.status).toBe("sideboarding");
        expect(allSeatsReady(m)).toBe(false);

        // Only B readies → the barrier is still closed (the build must NOT run).
        m = ready(m, "b");
        expect(m.players.find((p) => p.id === "b")!.ready).toBe(true);
        expect(m.players.find((p) => p.id === "a")!.ready).toBe(false);
        expect(allSeatsReady(m)).toBe(false);

        // A readies too → barrier opens; the next Game is now buildable.
        m = ready(m, "a");
        expect(allSeatsReady(m)).toBe(true);
    });

    it("readying in the reverse order opens the same barrier", () => {
        let m = match(3, [player("a"), player("b")]);
        m = { ...m, ...recordGameResult(m, "b")! };
        m = ready(m, "a");
        expect(allSeatsReady(m)).toBe(false);
        m = ready(m, "b");
        expect(allSeatsReady(m)).toBe(true);
    });

    it("re-readying the same seat does not open the barrier alone", () => {
        let m = match(3, [player("a"), player("b")]);
        m = { ...m, ...recordGameResult(m, "a")! };
        m = ready(m, "a");
        m = ready(m, "a"); // idempotent double-ready of the SAME seat
        expect(allSeatsReady(m)).toBe(false);
    });
});

describe("projectMatch — 2-player sideboarding secrecy (issue #397)", () => {
    it("hides the opponent's deck + swaps but keeps their ready-state public", () => {
        // Mid-sideboarding: the opponent (p2) has swapped a Sideboard card in and
        // readied. The viewer (p1) must see p2's ready flag but NONE of p2's
        // maindeck / sideboard / swaps.
        const doc = matchDoc({
            status: "sideboarding",
            players: [
                {
                    ...player("p1", 0, false),
                    deck: snapshotDeck({
                        id: "d1",
                        name: "Mine",
                        format: "vintage",
                        maindeck: [{ cardId: "m1", cardName: "M1" }],
                        sideboard: [{ cardId: "s1", cardName: "S1" }],
                    }),
                },
                {
                    ...player("p2", 1, true),
                    deck: snapshotDeck({
                        id: "d2",
                        name: "Secret",
                        format: "vintage",
                        maindeck: [
                            { cardId: "secretSwap", cardName: "Secret" },
                        ],
                        sideboard: [{ cardId: "secretSB", cardName: "Hidden" }],
                    }),
                },
            ],
        });
        const proj = projectMatch(doc, "p1");
        const me = proj.players.find((p) => p.id === "p1")!;
        const opp = proj.players.find((p) => p.id === "p2")!;

        // The viewer's own deck copy survives the projection.
        expect(me.deck).toBeDefined();
        expect(me.deck!.maindeck.map((c) => c.cardId)).toEqual(["m1"]);

        // The opponent's deck contents and swaps are stripped entirely.
        expect(opp.deck).toBeUndefined();
        // But their public ready-state is preserved for the indicator.
        expect(opp.ready).toBe(true);
        expect(opp.score).toBe(1);
        expect(opp.name).toBe("p2");

        // Match meta is public to both sides.
        expect(proj.status).toBe("sideboarding");
        expect(proj.bestOf).toBe(1); // matchDoc default; meta still crosses
    });

    it("Solo sees BOTH seats' deck copies during sideboarding", () => {
        const doc = matchDoc({
            status: "sideboarding",
            solo: true,
            players: [player("u-p1"), player("u-p2", 1, true)],
        });
        const proj = projectMatch(doc, "u");
        expect(proj.players.every((p) => p.deck !== undefined)).toBe(true);
        // ready-states still public in Solo too.
        expect(proj.players.find((p) => p.id === "u-p2")!.ready).toBe(true);
    });
});

// Foretell (CR 702.143, issue #2096) — the special action and the foretold
// designation, across every surface they cross:
//   - GRE unit: the special action's window (702.143a / 116.2h — any priority
//     of your OWN turn, stack empty or not, no main-phase restriction), its {2}
//     cost, the face-down exile it makes, the cast window it opens ("after the
//     current turn has ended", the card's own timing — a foretold instant in
//     the opponent's turn), the foretell-cost price, the CR 702.143c stack
//     fact, the CR 702.143d granted cost and the CR 702.143f reveal.
//   - Integration: the `foretellCard` and `announceCast` mutations, driven
//     through their own handlers — foretell on one turn, cast for the foretell
//     cost on a later one.
//   - Wire format: the hand card's `canForetell`; the foretold card in exile
//     as each player sees it through `projectPublicState`.
//   - Serialization: the designation and its permission survive the DB
//     round-trip.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { announceCast, foretellCard } from "../../game";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import {
    applyForetell,
    canForetell,
    foretellableHandCards,
    makeForetold,
} from "../foretell";
import { castRawManaCost } from "../castCost";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import { FACE_DOWN_CARD_ID } from "../../cards";
import {
    endGame,
    getPlayer,
    moveCard,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

// Behold the Multiverse — {3}{U} instant, "Scry 2, then draw two cards.
// Foretell {1}{U}": an instant with no target, so its cast window is the
// timing question alone. Augury Raven — {3}{U} creature, Foretell {1}{U}.
const BEHOLD = getCardByName("Behold the Multiverse").id;
const RAVEN = getCardByName("Augury Raven").id;
const ISLAND = getCardByName("Island").id;
const BOLT = getCardByName("Lightning Bolt").id;

function own(cardId: string, id: string, zone: CardInstanceState["zone"]) {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
}

/** p1, active in their precombat main with priority and an empty stack, holds
 *  `cardId` and controls `lands` untapped Islands; both have a library. */
function board(cardId = BEHOLD, lands = 2, turn = 3): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [own(cardId, "omen", "hand")],
                battlefield: Array.from({ length: lands }, (_, i) =>
                    own(ISLAND, `land${i}`, "battlefield")
                ),
                library: Array.from({ length: 6 }, (_, i) =>
                    own(ISLAND, `lib${i}`, "library")
                ),
            }),
            makePlayer("p2", {
                library: Array.from({ length: 6 }, (_, i) =>
                    makeInstance(ISLAND, {
                        id: `olib${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    })
                ),
            }),
        ],
    });
    state.turn = turn;
    return state;
}

const p1 = (state: GameState) => getPlayer(state, "p1");
const omenIn = (state: GameState) =>
    [...p1(state).hand, ...p1(state).exile].find((c) => c.id === "omen")!;

/** Whether `viewer`'s client is offered the foretold card's cast — through the
 *  REAL reducer, whose exile `legalActions` is what the Cast button gates on. */
function castOffered(state: GameState, viewer = "p1"): boolean {
    const card = projectPublicState(state, 1, viewer).players[0].exile.find(
        (c) => c.id === "omen"
    );
    return card?.legalActions?.includes("cast") ?? false;
}

/** `cardId` foretold on turn 3, play moved on to `turn`, every land untapped;
 *  `activePlayerId` p1 unless `theirTurn`, priority with p1 either way. */
function foretoldOn3(
    turn: number,
    opts: { cardId?: string; lands?: number; theirTurn?: boolean } = {}
): GameState {
    const state = board(opts.cardId ?? BEHOLD, opts.lands ?? 2);
    applyForetell(state, "p1", "omen");
    state.turn = turn;
    for (const l of p1(state).battlefield) l.isTapped = false;
    if (opts.theirTurn) {
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p1";
    }
    return state;
}

describe("Foretell — the special action's window (CR 702.143a, CR 116.2h)", () => {
    it("is offered with priority in your own main phase, {2} affordable", () => {
        const state = board();
        expect(canForetell(state, p1(state), omenIn(state))).toBe(true);
        expect(
            foretellableHandCards(state, p1(state)).map((c) => c.id)
        ).toEqual(["omen"]);
    });

    it("is offered OUTSIDE a main phase and with a non-empty stack — any priority of your turn", () => {
        const combat = board();
        combat.phase = "BEGINNING_OF_COMBAT";
        expect(canForetell(combat, p1(combat), omenIn(combat))).toBe(true);

        const busy = board();
        busy.stack.push({
            ...makeInstance(BOLT, { id: "bolt", zone: "stack" }),
            castById: "p2",
        });
        expect(canForetell(busy, p1(busy), omenIn(busy))).toBe(true);
    });

    it("is refused during the opponent's turn, even with priority", () => {
        const theirs = board();
        theirs.activePlayerId = "p2";
        theirs.priorityPlayerId = "p1";
        expect(canForetell(theirs, p1(theirs), omenIn(theirs))).toBe(false);
    });

    it("is refused without priority, with {2} unaffordable, and for a card without foretell", () => {
        const noPriority = board();
        noPriority.priorityPlayerId = "p2";
        expect(
            canForetell(noPriority, p1(noPriority), omenIn(noPriority))
        ).toBe(false);

        const short = board(BEHOLD, 1);
        expect(canForetell(short, p1(short), omenIn(short))).toBe(false);

        const bolt = board(BOLT);
        expect(canForetell(bolt, p1(bolt), omenIn(bolt))).toBe(false);
    });
});

describe("Foretell — taking the action (CR 702.143a/b)", () => {
    it("pays {2}, exiles the card FACE DOWN as foretold, and keeps priority", () => {
        const state = board();
        state.passCount = 1;
        applyForetell(state, "p1", "omen");

        expect(p1(state).hand).toHaveLength(0);
        const exiled = p1(state).exile.find((c) => c.id === "omen")!;
        expect(exiled).toMatchObject({
            zone: "exile",
            foretold: true,
            // CR 702.143a — "exile … face down. That player may look at that
            // card as long as it remains in exile."
            knownTo: ["p1"],
            faceDownBy: "face-down-exile",
            castableFromExileBy: "p1",
            // "after the current turn has ended"
            castableFromExileFromTurn: 4,
        });
        expect(p1(state).battlefield.every((l) => l.isTapped)).toBe(true);
        expect(Object.values(p1(state).manaPool).every((n) => !n)).toBe(true);
        // CR 702.143b — no stack; passes reset, priority stays (CR 116.3).
        expect(state.stack).toHaveLength(0);
        expect(state.passCount).toBe(0);
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("an unpayable {2} leaves the card in hand and every land untapped", () => {
        const state = board(BEHOLD, 1);
        expect(() => applyForetell(state, "p1", "omen")).toThrow();
        expect(p1(state).hand.map((c) => c.id)).toEqual(["omen"]);
        expect(p1(state).exile).toHaveLength(0);
        expect(p1(state).battlefield.some((l) => l.isTapped)).toBe(false);
    });
});

describe("Foretell — the foretold card's cast (CR 702.143a)", () => {
    it("is CLOSED during the turn the card was foretold", () => {
        expect(castOffered(foretoldOn3(3))).toBe(false);
    });

    it("is OPEN on a later turn, for the FORETELL cost {1}{U} — not the printed {3}{U}", () => {
        // Two Islands: the printed cost is not payable, the foretell cost is.
        const state = foretoldOn3(5);
        expect(castOffered(state)).toBe(true);
        expect(castRawManaCost(state, omenIn(state), "exile")).toEqual({
            X: 1,
            U: 1,
        });
    });

    it("a foretold INSTANT is castable during the opponent's turn", () => {
        expect(castOffered(foretoldOn3(4, { theirTurn: true }))).toBe(true);
    });

    it("a foretold CREATURE keeps its own timing: not in the opponent's turn, yes in your main phase", () => {
        expect(
            castOffered(foretoldOn3(4, { cardId: RAVEN, theirTurn: true }))
        ).toBe(false);
        expect(castOffered(foretoldOn3(5, { cardId: RAVEN }))).toBe(true);
    });
});

describe("Foretell — an effect makes a card foretold (CR 702.143d)", () => {
    it("the cost the effect gives wins, and the card need not have foretell", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    exile: [own(BOLT, "omen", "exile")],
                    battlefield: [own(ISLAND, "land0", "battlefield")],
                }),
                makePlayer("p2"),
            ],
        });
        state.turn = 2;
        makeForetold(state, omenIn(state), { foretellCost: { X: 1 } });
        expect(castRawManaCost(state, omenIn(state), "exile")).toEqual({
            X: 1,
        });
        expect(castOffered(state)).toBe(false);
        state.turn = 3;
        // Lightning Bolt has no legal target here besides players — any
        // target suffices; one Island pays the granted {1}.
        expect(castOffered(state)).toBe(true);
    });
});

type CardArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const run = (
    harness: ReturnType<typeof makeMutationCtx>,
    handler: unknown,
    cardInstanceId: string
) =>
    runMutation<CardArgs, void>(
        handler as Handler<CardArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId,
        }
    );

describe("Foretell — full path through the mutations (CR 702.143a/c)", () => {
    it("foretells on one turn, refuses the cast that turn, casts it for {1}{U} on a later one", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
        await run(harness, foretellCard, "omen");

        const foretold = harness.state();
        expect(p1(foretold).exile.map((c) => c.id)).toEqual(["omen"]);
        expect(p1(foretold).battlefield.every((l) => l.isTapped)).toBe(true);

        // Same turn: not castable ("after the current turn has ended").
        await expect(run(harness, announceCast, "omen")).rejects.toThrow();

        // Two turns on, with exactly {U}{U} floating: the {1}{U} cast
        // commits from the pool (the printed {3}{U} could not).
        const later = harness.state();
        later.turn = 5;
        p1(later).manaPool = { ...p1(later).manaPool, U: 2 };
        const next = makeMutationCtx("p1", [gameStateSeed(later, 2)]);
        await run(next, announceCast, "omen");
        const cast = next.state();
        expect(cast.pendingCast).toBeUndefined();
        expect(cast.stack.map((s) => s.id)).toEqual(["omen"]);
        expect(p1(cast).exile).toHaveLength(0);
        expect(p1(cast).manaPool.U ?? 0).toBe(0);
        // CR 702.143c — the spell "was a foretold card before it was cast".
        expect(cast.stack[0].foretold).toBe(true);
        expect(cast.stack[0].castFromZone).toBe("exile");
    });

    it("CR 702.143c — a foretold card cast for a cost OTHER than its foretell cost is still foretold", async () => {
        // A free-cast waiver on the same card (CR 118.9 — wins over the
        // foretell cost): the cast pays nothing, and the spell is still a
        // foretold spell.
        const later = foretoldOn3(5, { lands: 2 });
        for (const l of p1(later).battlefield) l.isTapped = true;
        omenIn(later).castFromExileWithoutPayingManaCost = true;
        expect(castRawManaCost(later, omenIn(later), "exile")).toEqual({});
        const harness = makeMutationCtx("p1", [gameStateSeed(later)]);
        await run(harness, announceCast, "omen");
        const cast = harness.state();
        expect(cast.stack.map((s) => s.id)).toEqual(["omen"]);
        expect(cast.stack[0].foretold).toBe(true);
    });

    it("a spell cast from hand is never foretold", async () => {
        const state = board(BEHOLD, 0);
        p1(state).manaPool = { ...p1(state).manaPool, U: 4 };
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, announceCast, "omen");
        const cast = harness.state();
        expect(cast.stack.map((s) => s.id)).toEqual(["omen"]);
        expect(cast.stack[0].foretold).toBeUndefined();
    });
});

describe("Foretell — the designation does not outlive the spell (CR 702.143c, 400.7)", () => {
    it("a foretold creature resolves, dies and is exiled under another grant: priced at its PRINTED cost", async () => {
        const later = foretoldOn3(5, { cardId: RAVEN });
        p1(later).manaPool = { ...p1(later).manaPool, U: 2 };
        const harness = makeMutationCtx("p1", [gameStateSeed(later)]);
        await run(harness, announceCast, "omen");
        const cast = harness.state();
        expect(cast.stack[0].foretold).toBe(true);

        resolveTopOfStack(cast);
        const raven = p1(cast).battlefield.find((c) => c.id === "omen")!;
        expect(raven.foretold).toBeUndefined();

        moveCard(p1(cast), "omen", "battlefield", "graveyard");
        const exiled = moveCard(p1(cast), "omen", "graveyard", "exile");
        expect(exiled.foretold).toBeUndefined();
        exiled.castableFromExileBy = "p1";
        expect(castRawManaCost(cast, exiled, "exile")).toEqual({ X: 3, U: 1 });
    });
});

describe("Foretell — wire format (CR 406.3, 702.143e)", () => {
    it("the hand card carries canForetell for its owner only while foretelling is legal", () => {
        const hand = projectPublicState(board(), 1, "p1").players[0].hand;
        expect(hand[0]).toMatchObject({ id: "omen", canForetell: true });

        const shortHand = projectPublicState(board(BEHOLD, 1), 1, "p1")
            .players[0].hand;
        expect(shortHand[0]?.canForetell).toBeUndefined();
    });

    it("the opponent sees a face-down FORETOLD card with no identity; the owner sees the card", () => {
        const state = foretoldOn3(3);
        const theirs = projectPublicState(state, 1, "p2").players[0].exile[0];
        expect(theirs.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(theirs.types).toEqual([]);
        expect(theirs.foretold).toBe(true);
        expect(theirs.legalActions).toBeUndefined();

        const mine = projectPublicState(state, 1, "p1").players[0].exile[0];
        expect(mine.card.id).toBe(BEHOLD);
        expect(mine.faceDown).toBe(true);
        expect(mine.foretold).toBe(true);
    });
});

describe("Foretell — the end-of-game reveal (CR 702.143f)", () => {
    it("reveals every foretold card to all players, and no other face-down exile", () => {
        const state = foretoldOn3(4);
        // A face-down exile that is NOT foretold (Necropotence's shape).
        p1(state).exile.push({
            ...own(BOLT, "hidden", "exile"),
            knownTo: ["p1"],
            faceDownBy: "face-down-exile",
        });
        endGame(state, { winnerId: "p1", reason: "concede" } as never);

        const theirs = projectPublicState(state, 1, "p2").players[0].exile;
        expect(theirs.find((c) => c.id === "omen")?.card.id).toBe(BEHOLD);
        expect(theirs.find((c) => c.id === "hidden")?.card.id).toBe(
            FACE_DOWN_CARD_ID
        );
    });
});

describe("Foretell — serialization", () => {
    it("round-trips the designation, its permission and a granted cost", () => {
        const state = foretoldOn3(3);
        omenIn(state).grantedForetellCost = { U: 1 };
        const back = expandState(compactState(state));
        expect(p1(back).exile[0]).toMatchObject({
            foretold: true,
            grantedForetellCost: { U: 1 },
            knownTo: ["p1"],
            castableFromExileBy: "p1",
            castableFromExileFromTurn: 4,
        });
    });
});

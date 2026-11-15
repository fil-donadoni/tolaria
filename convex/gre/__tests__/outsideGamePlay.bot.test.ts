// The Bot's reach over the outside-game play permission (CR 400.11b): the
// move enumerator offers the pool cards the permission covers, and the search
// executor commits them from outside the game — a cast spends the permission,
// and the card is in the game from then on (it resolves to its owner's
// graveyard like any other instant).
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    buildSpellContext,
    getPlayer,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";

const BEARS = getCardByName("Grizzly Bears").id;
const FOREST = getCardByName("Forest").id;
const BOLT = getCardByName("Lightning Bolt").id;

const pool = (defId: string, id: string) =>
    makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
    });

function board(granted: boolean): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 2, C: 0 },
                outsideGame: [
                    pool(BEARS, "sb-bears"),
                    pool(FOREST, "sb-forest"),
                    pool(BOLT, "sb-bolt"),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    if (granted) {
        const granter: StackItem = {
            ...makeInstance(BEARS, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            targets: [],
        };
        buildSpellContext(state, granter).grantOutsideGamePlays("p1", 1);
    }
    return state;
}

const poolMoves = (moves: Move[]) =>
    moves.filter(
        (m) =>
            (m.kind === "cast-spell" || m.kind === "play-land") &&
            m.cardInstanceId.startsWith("sb-")
    );

describe("enumerateMoves — outside-game play permission (CR 400.11b)", () => {
    it("offers no pool card without the permission", () => {
        expect(poolMoves(enumerateMoves(board(false), "p1"))).toEqual([]);
    });

    it("offers the casts (stamped outsideGame) and the land play under it", () => {
        const moves = poolMoves(enumerateMoves(board(true), "p1"));
        expect(
            moves
                .filter((m) => m.kind === "cast-spell")
                .map((m) => [
                    m.cardInstanceId,
                    m.kind === "cast-spell" ? m.castFromZone : undefined,
                ])
        ).toEqual(
            expect.arrayContaining([
                ["sb-bears", "outsideGame"],
                ["sb-bolt", "outsideGame"],
            ])
        );
        expect(
            moves.some(
                (m) =>
                    m.kind === "play-land" && m.cardInstanceId === "sb-forest"
            )
        ).toBe(true);
    });

    it("the executor casts from outside the game, spends the permission, and the card resolves into the game", () => {
        const before = board(true);
        const bolt = poolMoves(enumerateMoves(before, "p1")).find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "sb-bolt"
        )!;
        const after = applyMoveForSearch(before, "p1", bolt);
        expect(after.outsideGamePlaysThisTurn).toBeUndefined();
        expect(getPlayer(after, "p1").outsideGame!.map((c) => c.id)).toEqual([
            "sb-bears",
            "sb-forest",
        ]);
        expect(poolMoves(enumerateMoves(after, "p1"))).toEqual([]);
        // The search executor settles the stack after the cast: the instant
        // resolved into its owner's graveyard — in the game now.
        if (after.stack.length > 0) resolveTopOfStack(after);
        expect(getPlayer(after, "p1").graveyard.map((c) => c.id)).toEqual([
            "sb-bolt",
        ]);
    });

    it("the executor plays the land from outside the game", () => {
        const before = board(true);
        const play = poolMoves(enumerateMoves(before, "p1")).find(
            (m) => m.kind === "play-land"
        )!;
        const after = applyMoveForSearch(before, "p1", play);
        const p1 = getPlayer(after, "p1");
        expect(p1.battlefield.map((c) => c.id)).toEqual(["sb-forest"]);
        expect(p1.landsPlayedThisTurn).toBe(1);
        expect(after.outsideGamePlaysThisTurn).toBeUndefined();
    });
});

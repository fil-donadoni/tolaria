// Suspend (CR 702.62a / 116.2f, issue #10495) — the Bot's three seams:
// reachable (`enumerateMoves` offers the special action, `onlyPassIsLegal`
// does not hide it), appliable (both sandboxes exile with N time counters,
// priority kept), and WANTED — a suspended card is banked material for its
// owner (`exileCastOpensLater`), so the evaluator's hand term does not read the
// action as throwing the card away, and the search takes it on the banking
// tie (`free-development`, the plot shape).
import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { applyMoveForSearch } from "../applyMove";
import { exileCastLatent } from "../castCost";
import { evaluateBreakdown } from "../evaluate";
import {
    enumerateMoves,
    onlyPassIsLegal,
    SPECIAL_ACTION_MOVE_KINDS,
    type Move,
} from "../moves";
import { applyMoveInSearch, search } from "../search";
import type { CardInstanceState, GameState } from "../state";

/** Suspend 1—{R} on a {2}{R} sorcery: with one Mountain the suspend is
 *  payable and the cast is not. */
const BOLT: CardDefinition = {
    id: "test-suspend-bot-bolt",
    name: "Test Suspend Bot Bolt",
    rarity: "common",
    manaCost: { X: 2, R: 1 },
    types: ["Sorcery"],
    staticAbilities: ["suspend 1"],
    suspend: { R: 1 },
    effects: [{ op: "loseLife", player: "opponent", amount: 3 }],
};

const MOUNTAIN = getCardByName("Mountain").id;
const suspendMove: Move = { kind: "suspend", cardInstanceId: "bolt" };

function own(cardId: string, id: string, zone: CardInstanceState["zone"]) {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
}

/** p1's postcombat main, the Bolt in hand, one untapped Mountain. */
function board(): GameState {
    const state = makeState({
        phase: "POSTCOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                hand: [own(BOLT.id, "bolt", "hand")],
                battlefield: [own(MOUNTAIN, "m", "battlefield")],
                library: Array.from({ length: 10 }, (_, i) =>
                    own(MOUNTAIN, `lib${i}`, "library")
                ),
            }),
            makePlayer("p2", {
                library: Array.from({ length: 10 }, (_, i) =>
                    makeInstance(MOUNTAIN, {
                        id: `olib${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    })
                ),
            }),
        ],
    });
    state.turn = 3;
    return state;
}

const withBolt = <T>(fn: () => T): T => withTemporaryDefinition(BOLT, fn);

describe("Suspend — reachable (CR 116.2f)", () => {
    it("is a special action kind, enumerated for the suspendable hand card", () => {
        withBolt(() => {
            expect(SPECIAL_ACTION_MOVE_KINDS.has("suspend")).toBe(true);
            expect(enumerateMoves(board(), "p1")).toContainEqual(suspendMove);
        });
    });

    it("is not enumerated once the suspend cost cannot be paid", () => {
        withBolt(() => {
            const state = board();
            state.players[0].battlefield[0].isTapped = true;
            expect(
                enumerateMoves(state, "p1").some((m) => m.kind === "suspend")
            ).toBe(false);
        });
    });

    it("a suspend that is the only alternative to passing is not a forced pass", () => {
        withBolt(() => {
            const state = board();
            expect(
                enumerateMoves(state, "p1").filter((m) => m.kind !== "pass")
            ).toEqual([suspendMove]);
            expect(onlyPassIsLegal(state, "p1")).toBe(false);
        });
    });
});

describe("Suspend — appliable in both sandboxes (CR 702.62a)", () => {
    it("greedy sandbox (applyMoveForSearch) exiles with the time counter", () => {
        withBolt(() => {
            const next = applyMoveForSearch(board(), "p1", suspendMove);
            const card = next.players[0].exile.find((c) => c.id === "bolt");
            expect(card?.counters).toEqual({ time: 1 });
            expect(next.players[0].battlefield[0].isTapped).toBe(true);
        });
    });

    it("ISMCTS tree (applyMoveInSearch) keeps priority with the actor (CR 116.3)", () => {
        withBolt(() => {
            const state = board();
            applyMoveInSearch(state, "p1", suspendMove);
            expect(state.players[0].exile.map((c) => c.id)).toEqual(["bolt"]);
            expect(state.priorityPlayerId).toBe("p1");
            expect(state.stack).toHaveLength(0);
        });
    });
});

describe("Suspend — wanted: a suspended card is banked material (CR 702.62a/b)", () => {
    it("is latent for its owner only, and only while it has a time counter", () => {
        withBolt(() => {
            const next = applyMoveForSearch(board(), "p1", suspendMove);
            const card = next.players[0].exile[0];
            expect(exileCastLatent(next, card, "p1")).toBe(true);
            expect(exileCastLatent(next, card, "p2")).toBe(false);
            card.counters = undefined;
            expect(exileCastLatent(next, card, "p1")).toBe(false);
        });
    });

    it("the hand term does not drop when the card is suspended", () => {
        withBolt(() => {
            const before = evaluateBreakdown(board(), "p1").self.hand;
            const after = evaluateBreakdown(
                applyMoveForSearch(board(), "p1", suspendMove),
                "p1"
            ).self.hand;
            expect(before).toBeGreaterThan(0);
            expect(after).toBe(before);
        });
    });

    it("a real search suspends with the mana that would otherwise empty", () => {
        withBolt(() => {
            for (const seed of [0xb1ade, 1, 2]) {
                expect(
                    search(board(), "p1", { iterations: 200 }, seed)
                ).toEqual(suspendMove);
            }
        });
    });
});

// Bot reachability for Demonstrate (CR 702.144a): the cast is enumerated, the
// "you may copy it" has both answers, each copy's retarget offer is answerable in
// turn, and the search sandbox plays out the same copies the server does.
//
// Lives in a `*.bot.test.ts` file because `convex/gre/search.ts` and
// `convex/gre/moves.ts` are declared bot modules.
import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { resolveTopOfStack, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";

const SPELL = "synthetic-demonstrate-bot";
const BEAR = "synthetic-demonstrate-bot-bear";

preloadDefinitions([
    {
        id: SPELL,
        name: "Synthetic demonstrate bot spell",
        rarity: "rare",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        staticAbilities: ["demonstrate"],
        targetRequirement: { type: "Creature", count: 1 },
        effects: [{ op: "destroy", target: { target: 0 } }],
    } as CardDefinition,
    {
        id: BEAR,
        name: "Synthetic demonstrate bot bear",
        rarity: "common",
        manaCost: { X: 2 },
        types: ["Creature"],
        subtypes: [],
        power: 2,
        toughness: 2,
    } as CardDefinition,
]);

const bear = (id: string, owner: string) =>
    makeInstance(BEAR, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
    });

function position(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(SPELL, {
                        id: "spell",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [bear("mine", "p1")],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2", { battlefield: [bear("theirs", "p2")] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

/** Casts at "theirs" and resolves the trigger up to its "you may copy it". */
function atTheOffer(): GameState {
    const state = position();
    const cast = enumerateMoves(state, "p1").find(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === "spell" &&
            JSON.stringify(m).includes("theirs")
    );
    expect(cast).toBeDefined();
    applyMoveInSearch(state, "p1", cast!);
    resolveTopOfStack(state);
    return state;
}

const mayPayMoves = (state: GameState) =>
    enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "may-pay" }> => m.kind === "may-pay"
    );

describe("Demonstrate in the Bot's search (CR 702.144a)", () => {
    it("the Bot can answer the offer both ways", () => {
        expect(
            mayPayMoves(atTheOffer())
                .map((m) => m.accept)
                .sort()
        ).toEqual([false, true]);
    });

    it("the sandbox makes both copies and each player can answer their offer in turn", () => {
        const state = atTheOffer();
        const yes = mayPayMoves(state).find((m) => m.accept)!;
        applyMoveInSearch(state, "p1", yes);

        expect(state.stack.filter((s) => s.isCopy)).toHaveLength(2);
        expect(state.pendingTarget?.playerId).toBe("p1");
        const answer = enumerateMoves(state, "p1").find(
            (m) => m.kind === "submit-target"
        );
        expect(answer).toBeDefined();
        applyMoveInSearch(state, "p1", answer!);

        expect(state.pendingTarget?.playerId).toBe("p2");
        const reply = enumerateMoves(state, "p2").find(
            (m) => m.kind === "submit-target"
        );
        expect(reply).toBeDefined();
        applyMoveInSearch(state, "p2", reply!);

        expect(state.pendingTarget).toBeUndefined();
        expect(state.queuedCopyRetargets).toBeUndefined();
    });
});

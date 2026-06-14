// ISMCTS search (issue #112). Behavioral assertions on crafted positions: the
// Bot finds available lethal, uses a relevant instant response, and picks a
// multi-step line that greedy 1-ply misses. Plus the contract checks: the move
// is always legal, the search is deterministic given a seed, and it respects
// the budget bound. See `convex/gre/search.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { search } from "../search";
import { greedySelectMove } from "../greedy";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const GIANT = getCardByName("Hill Giant").id; // 3/3
const BOLT = getCardByName("Lightning Bolt").id; // R: 3 dmg any target
const MOUNTAIN = getCardByName("Mountain").id;

function creature(
    cardId: string,
    controllerId: string,
    id: string,
    extra = {}
) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        isSummoningSick: false,
        ...extra,
    });
}

function land(controllerId: string, id: string) {
    return makeInstance(MOUNTAIN, { controllerId, ownerId: controllerId, id });
}

function bolt(controllerId: string, id: string) {
    return makeInstance(BOLT, {
        controllerId,
        ownerId: controllerId,
        id,
        zone: "hand",
    });
}

/** Bot (p1) at sorcery speed with `hand`/`battlefield`, opponent p2 as given. */
function botMainPhase(
    hand: ReturnType<typeof makeInstance>[],
    battlefield: ReturnType<typeof makeInstance>[],
    opp: Parameters<typeof makePlayer>[1]
) {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { hand, battlefield }),
            makePlayer("p2", opp),
        ],
    });
}

const isLegal = (
    state: ReturnType<typeof makeState>,
    pid: string,
    move: unknown
) =>
    enumerateMoves(state, pid)
        .map((m) => JSON.stringify(m))
        .includes(JSON.stringify(move));

describe("search — legality & determinism (issue #112)", () => {
    it("returns a legal move for the acting player", () => {
        const state = botMainPhase([bolt("p1", "b")], [land("p1", "m")], {
            battlefield: [creature(GIANT, "p2", "ogre")],
        });
        const move = search(state, "p1", { iterations: 80 }, 1);
        expect(move).not.toBeNull();
        expect(isLegal(state, "p1", move)).toBe(true);
    });

    it("is deterministic: same seed + budget → identical move", () => {
        const state = botMainPhase(
            [bolt("p1", "b1"), bolt("p1", "b2")],
            [land("p1", "m1"), land("p1", "m2")],
            { life: 6, battlefield: [creature(GIANT, "p2", "ogre")] }
        );
        const a = search(state, "p1", { iterations: 300 }, 123);
        const b = search(state, "p1", { iterations: 300 }, 123);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("returns null when the player owes no action", () => {
        const state = botMainPhase([], [], {});
        // p2 does not have priority.
        expect(search(state, "p2", { iterations: 10 }, 1)).toBeNull();
    });
});

describe("search — finds available lethal (issue #112)", () => {
    it("burns the opponent's face for the kill", () => {
        const state = botMainPhase([bolt("p1", "b")], [land("p1", "m")], {
            life: 3,
        });
        const move = search(state, "p1", { iterations: 200 }, 7);
        expect(move?.kind).toBe("cast-spell");
        if (move?.kind !== "cast-spell") throw new Error("kind");
        expect(move.targets[0]?.id).toBe("p2");
    });
});

describe("search — relevant instant response (issue #112)", () => {
    it("bolts a lethal attacker to stay alive instead of taking the hit", () => {
        // Opponent p1 is attacking with a 3/3 and bot p2 is at 3 — taking the
        // hit is lethal. Bot has no blockers but holds Bolt + an untapped
        // Mountain with priority: the relevant response is to remove the
        // attacker and survive. Only bolting the OGRE saves the game (burning
        // p1's face does not), so the choice is unambiguous.
        const attacker = creature(GIANT, "p1", "ogre", {
            isAttacking: true,
            isTapped: true,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { life: 6, battlefield: [attacker] }),
                makePlayer("p2", {
                    life: 3,
                    hand: [bolt("p2", "b")],
                    battlefield: [land("p2", "m")],
                }),
            ],
            combat: {
                attackerIds: ["ogre"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const move = search(state, "p2", { iterations: 200 }, 5);
        expect(move?.kind).toBe("cast-spell");
        if (move?.kind !== "cast-spell") throw new Error("kind");
        expect(move.targets[0]?.id).toBe("ogre");
    });
});

describe("search — beats greedy 1-ply on a multi-step line (issue #112)", () => {
    it("burns face for a two-Bolt lethal where greedy kills the creature", () => {
        // Opp p2 at 6 with a 3/3. One Bolt at the 3/3 is the best SINGLE move by
        // material (+creature removal), so greedy takes it. But two Bolts to the
        // face is exactly lethal — only multi-step search sees it.
        const makePos = () =>
            botMainPhase(
                [bolt("p1", "b1"), bolt("p1", "b2")],
                [land("p1", "m1"), land("p1", "m2")],
                { life: 6, battlefield: [creature(GIANT, "p2", "ogre")] }
            );

        const greedy = greedySelectMove(makePos(), "p1");
        expect(greedy?.kind).toBe("cast-spell");
        if (greedy?.kind !== "cast-spell") throw new Error("kind");
        expect(greedy.targets[0]?.id).toBe("ogre"); // greedy removes the creature

        const searched = search(makePos(), "p1", { iterations: 500 }, 11);
        expect(searched?.kind).toBe("cast-spell");
        if (searched?.kind !== "cast-spell") throw new Error("kind");
        expect(searched.targets[0]?.id).toBe("p2"); // search goes for the kill
    });
});

describe("search — respects the budget bound (issue #112)", () => {
    it("terminates and returns a legal move under a 1-iteration budget", () => {
        const state = botMainPhase([bolt("p1", "b")], [land("p1", "m")], {
            battlefield: [creature(GIANT, "p2", "ogre")],
        });
        const move = search(state, "p1", { iterations: 1 }, 3);
        expect(move).not.toBeNull();
        expect(isLegal(state, "p1", move)).toBe(true);
    });

    it("stops on the wall-clock bound (injected clock)", () => {
        const state = botMainPhase([bolt("p1", "b")], [land("p1", "m")], {
            battlefield: [creature(GIANT, "p2", "ogre")],
        });
        // Clock jumps 10ms per read; a 5ms budget allows a single iteration.
        let t = 0;
        const now = () => (t += 10);
        const move = search(
            state,
            "p1",
            { iterations: 1_000_000, timeMs: 5, now },
            9
        );
        expect(move).not.toBeNull();
        expect(isLegal(state, "p1", move)).toBe(true);
    });
});

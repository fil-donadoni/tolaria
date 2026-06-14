// Greedy 1-ply selection + sandbox move simulation (issue #111). Behavioral
// assertions on crafted positions — the Bot makes a profitable block, declines
// a suicidal attack, and casts a relevant spell over passing. These exercise the
// full seam: enumerateMoves → applyMoveForSearch → evaluate → argmax.
// See `convex/gre/greedy.ts` and `convex/gre/applyMove.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { greedySelectMove } from "../greedy";
import { applyMoveForSearch } from "../applyMove";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2
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

describe("greedySelectMove — profitable block (issue #111)", () => {
    it("blocks an attacker it can kill while surviving, instead of taking damage", () => {
        // p1 attacks with a 2/2; bot (p2) has a 3/3. Blocking kills the 2/2 and
        // the 3/3 survives — strictly better than taking 2 to the face.
        const attacker = creature(BEARS, "p1", "atk", { isAttacking: true });
        const blocker = creature(GIANT, "p2", "blk");
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });

        const move = greedySelectMove(state, "p2");
        expect(move?.kind).toBe("declare-blockers");
        if (move?.kind !== "declare-blockers") throw new Error("kind");
        expect(move.assignments).toEqual([
            { blockerId: "blk", attackerId: "atk" },
        ]);
    });
});

describe("greedySelectMove — avoid suicidal attack (issue #111)", () => {
    it("declines to attack a 2/2 into a 3/3 that blocks and kills it", () => {
        // Bot (p1) is the active player declaring attackers. Its only attacker
        // is a 2/2; the defender holds a 3/3. Attacking just loses the 2/2 (the
        // defender blocks), so the best move is to hold back (empty attack).
        const botCreature = creature(BEARS, "p1", "mine");
        const wall = creature(GIANT, "p2", "wall");
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [botCreature] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });

        const move = greedySelectMove(state, "p1");
        expect(move?.kind).toBe("declare-attackers");
        if (move?.kind !== "declare-attackers") throw new Error("kind");
        expect(move.attackerIds).toEqual([]);
    });

    it("DOES attack when the swing is favorable (2/2 into an open board)", () => {
        // Same bot creature, but the defender has no blockers — attacking is
        // free damage, so the bot should declare the attack.
        const botCreature = creature(BEARS, "p1", "mine");
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [botCreature] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });

        const move = greedySelectMove(state, "p1");
        expect(move?.kind).toBe("declare-attackers");
        if (move?.kind !== "declare-attackers") throw new Error("kind");
        expect(move.attackerIds).toEqual(["mine"]);
    });
});

describe("greedySelectMove — cast a relevant spell (issue #111)", () => {
    it("bolts the opponent rather than passing or hitting itself", () => {
        // Bot (p1) has Lightning Bolt + an untapped Mountain to pay it; the
        // opponent has a 3/3. The relevant play removes opponent value (kill the
        // 3/3 or burn face); bolting itself or passing is strictly worse.
        const land = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            ownerId: "p1",
            id: "mtn",
        });
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            id: "bolt",
            zone: "hand",
        });
        const oppCreature = creature(GIANT, "p2", "ogre");
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { hand: [bolt], battlefield: [land] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });

        const move = greedySelectMove(state, "p1");
        expect(move?.kind).toBe("cast-spell");
        if (move?.kind !== "cast-spell") throw new Error("kind");
        expect(move.cardInstanceId).toBe("bolt");
        // Target must be on the opponent's side (their creature or their face),
        // never the bot itself.
        const target = move.targets[0];
        expect(target.id === "p2" || target.id === "ogre").toBe(true);
    });

    it("returns null when the player owes no action", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // p2 does not have priority — nothing to choose.
        expect(greedySelectMove(state, "p2")).toBeNull();
    });
});

describe("applyMoveForSearch — sandbox is pure (issue #111)", () => {
    it("does not mutate the input state", () => {
        const land = makeInstance(MOUNTAIN, {
            controllerId: "p1",
            ownerId: "p1",
            id: "mtn",
        });
        const bolt = makeInstance(BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            id: "bolt",
            zone: "hand",
        });
        const oppCreature = creature(GIANT, "p2", "ogre");
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [bolt], battlefield: [land] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        const before = JSON.stringify(state);

        const next = applyMoveForSearch(state, "p1", {
            kind: "cast-spell",
            cardInstanceId: "bolt",
            chosenX: undefined,
            chosenModeId: undefined,
            confirmTargets: false,
            targets: [{ type: "permanent", id: "ogre" }],
            tapPlan: [{ cardInstanceId: "mtn" }],
        });

        // Input untouched; result reflects the bolt (opponent's 3/3 gone).
        expect(JSON.stringify(state)).toBe(before);
        const oppBf = next.players.find((p) => p.id === "p2")!.battlefield;
        expect(oppBf.find((c) => c.id === "ogre")).toBeUndefined();
    });
});

// Next-opposing-combat exposure (issue #6909): the crackback the Danger Clock
// and the declared-combat predictor read when the Bot's own attack taps the
// blockers it needs. Each case is the seam in isolation, no search:
//
//   * CR 509.1a — a declared combat's blockers must be untapped, so a tapped
//     creature stops nothing in `predictCombatOutcome`;
//   * CR 502.3 / 702.20b — when the defender is the active player its tapped
//     creatures do not untap before the opponent's next combat, so an attacker
//     without vigilance is no blocker in the clock's next-combat read, while a
//     vigilance attacker (never tapped) still is, and the steady state (the
//     defender not active) counts every creature;
//   * mana-sink pumps and trample grants on the attacker's permanents, bounded
//     by its mana base, size the crackback (CR 702.19b overflow past a blocker).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { predictCombatOutcome, predictUnblockedThreat } from "../dangerClock";
import { activatedCombatPumps } from "../heldInteraction";
import { spendCost } from "../manaAvailability";

const GRIZZLY = getCardByName("Grizzly Bears").id; // 2/2
const HILL_GIANT = getCardByName("Hill Giant").id; // 3/3
const SERRA_ANGEL = getCardByName("Serra Angel").id; // 4/4 flying, vigilance
const LEECH = getCardByName("Andradite Leech").id; // 2/2, {B}: +1/+1
const ROOTWALLA = getCardByName("Blazing Rootwalla").id; // 1/1, {R}: +2/+0 once per turn
const MANTLE = getCardByName("Keldon Mantle").id; // Aura: {R}: +1/+0, {G}: trample
const SWAMP = getCardByName("Swamp").id;
const MOUNTAIN = getCardByName("Mountain").id;
const FOREST = getCardByName("Forest").id;

const creature = (
    cardId: string,
    owner: string,
    id: string,
    extra: Partial<ReturnType<typeof makeInstance>> = {}
) =>
    makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        isSummoningSick: false,
        ...extra,
    });
const land = (cardId: string, owner: string, id: string, tapped = false) =>
    makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        isTapped: tapped,
    });
const lands = (cardId: string, owner: string, n: number, tapped = false) =>
    Array.from({ length: n }, (_, i) =>
        land(cardId, owner, `${owner}-${cardId.slice(0, 4)}-${i}`, tapped)
    );

describe("declared combat ignores tapped blockers (CR 509.1a)", () => {
    const declared = (blockerTapped: boolean) => {
        const atk = creature(HILL_GIANT, "p1", "atk", { isAttacking: true });
        const blk = creature(HILL_GIANT, "p2", "blk", {
            isTapped: blockerTapped,
        });
        return makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
            players: [
                makePlayer("p1", { battlefield: [atk] }),
                makePlayer("p2", { battlefield: [blk] }),
            ],
        });
    };

    it("an untapped 3/3 trades with the attacking 3/3", () => {
        const out = predictCombatOutcome(declared(false), "p1", "p2");
        expect(out.deadAttackerIds).toEqual(["atk"]);
        expect(out.faceDamage).toBe(0);
    });

    it("the same 3/3 tapped stops nothing: the attacker connects", () => {
        const out = predictCombatOutcome(declared(true), "p1", "p2");
        expect(out.deadAttackerIds).toEqual([]);
        expect(out.faceDamage).toBe(3);
    });
});

describe("next-combat blockers after the defender's own attack (CR 502.3)", () => {
    // The Bot (p1) is the active player and has just attacked. The opponent's
    // crackback comes before p1's next untap step.
    const afterAttack = (
        attackerCard: string,
        attackerTapped: boolean,
        activePlayerId: string
    ) => {
        const mine = creature(attackerCard, "p1", "mine", {
            isAttacking: true,
            hasAttackedThisTurn: true,
            isTapped: attackerTapped,
        });
        const theirs = creature(GRIZZLY, "p2", "theirs");
        return makeState({
            phase: "POSTCOMBAT_MAIN",
            activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
    };

    it("a creature that attacked without vigilance is no blocker next turn", () => {
        const state = afterAttack(HILL_GIANT, true, "p1");
        expect(predictUnblockedThreat(state, "p2", "p1").damage).toBe(2);
    });

    it("a vigilance attacker never tapped and still blocks (CR 702.20b)", () => {
        const state = afterAttack(SERRA_ANGEL, false, "p1");
        expect(predictUnblockedThreat(state, "p2", "p1").damage).toBe(0);
    });

    it("the steady state (defender not active) counts a tapped creature: it untaps first", () => {
        const state = afterAttack(HILL_GIANT, true, "p2");
        expect(predictUnblockedThreat(state, "p2", "p1").damage).toBe(0);
    });
});

describe("mana-sink pumps size the crackback (issue #6909)", () => {
    const board = (
        attackerBattlefield: ReturnType<typeof makeInstance>[],
        defenderBattlefield: ReturnType<typeof makeInstance>[] = []
    ) =>
        makeState({
            phase: "POSTCOMBAT_MAIN",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: attackerBattlefield }),
                makePlayer("p2", { battlefield: defenderBattlefield }),
            ],
        });

    it("a firebreathing-style creature is pumped once per affordable activation", () => {
        const leech = creature(LEECH, "p1", "leech");
        // Three Swamps, all TAPPED now: the base untaps on p1's turn.
        const state = board([leech, ...lands(SWAMP, "p1", 3, true)]);
        expect(activatedCombatPumps(state, state.players[0])).toHaveLength(1);
        expect(predictUnblockedThreat(state, "p1", "p2").damage).toBe(5);
    });

    it("the pump is bounded by the mana base, colour included", () => {
        const leech = creature(LEECH, "p1", "leech");
        const one = board([leech, ...lands(SWAMP, "p1", 1)]);
        expect(predictUnblockedThreat(one, "p1", "p2").damage).toBe(3);
        const wrongColour = board([leech, ...lands(FOREST, "p1", 3)]);
        expect(predictUnblockedThreat(wrongColour, "p1", "p2").damage).toBe(2);
    });

    it("a once-per-turn pump is bought once however much mana there is", () => {
        const rootwalla = creature(ROOTWALLA, "p1", "walla");
        const state = board([rootwalla, ...lands(MOUNTAIN, "p1", 3)]);
        expect(predictUnblockedThreat(state, "p1", "p2").damage).toBe(3);
    });

    it("an Aura's pump lands on its host, and a bought trample pushes past the blocker (CR 702.19b)", () => {
        const bear = creature(GRIZZLY, "p1", "bear");
        const mantle = makeInstance(MANTLE, {
            id: "mantle",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const wall = creature(HILL_GIANT, "p2", "wall");
        // {G} buys trample, three {R} buy +3/+0: a 5/2 trampler into a 3/3
        // blocker pushes 2 through.
        const trampling = board(
            [
                bear,
                mantle,
                ...lands(MOUNTAIN, "p1", 3),
                ...lands(FOREST, "p1", 1),
            ],
            [wall]
        );
        expect(predictUnblockedThreat(trampling, "p1", "p2").damage).toBe(2);
        // No green source: the same four red pumps make a 6/2 with no
        // trample, and the one blocker stops all of it.
        const blocked = board(
            [bear, mantle, ...lands(MOUNTAIN, "p1", 4)],
            [wall]
        );
        expect(predictUnblockedThreat(blocked, "p1", "p2").damage).toBe(0);
        // Unblocked, every red source is a point of damage.
        const open = board([bear, mantle, ...lands(MOUNTAIN, "p1", 4)]);
        expect(predictUnblockedThreat(open, "p1", "p2").damage).toBe(6);
    });
});

describe("pump budget limits (review of issue #6909)", () => {
    const AEGIS = getCardByName("Aegis of the Meek").id; // {1},{T}: target 1/1 gets +1/+2
    const PLAINS = getCardByName("Plains").id;

    it("a {T}-cost pump on a non-creature is bought once, not once per land", () => {
        const walla = creature(ROOTWALLA, "p1", "walla"); // 1/1, its own pump needs {R}
        const aegis = makeInstance(AEGIS, {
            id: "aegis",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "POSTCOMBAT_MAIN",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", {
                    battlefield: [walla, aegis, ...lands(PLAINS, "p1", 6)],
                }),
                makePlayer("p2"),
            ],
        });
        const pumps = activatedCombatPumps(state, state.players[0]);
        expect(pumps.map((p) => p.singleUse)).toEqual([true]);
        expect(predictUnblockedThreat(state, "p1", "p2").damage).toBe(2);
    });

    it("a pump that costs no mana is left unmodelled rather than bought without end", () => {
        const def = {
            ...getCardByName("Grizzly Bears"),
            id: "test-free-pump-6909",
            name: "Free Pump Test Bear",
            activatedAbilities: [
                {
                    id: "free-pump",
                    oracleText:
                        "{0}: This creature gets +1/+0 until end of turn.",
                    cost: { mana: {} },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: 1,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        } as Parameters<typeof withTemporaryDefinition>[0];
        withTemporaryDefinition(def, () => {
            const bear = creature(def.id, "p1", "freebear");
            const state = makeState({
                phase: "POSTCOMBAT_MAIN",
                activePlayerId: "p2",
                players: [
                    makePlayer("p1", {
                        battlefield: [bear, ...lands(SWAMP, "p1", 2)],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(activatedCombatPumps(state, state.players[0])).toEqual([]);
            expect(predictUnblockedThreat(state, "p1", "p2").damage).toBe(2);
        });
    });
});

describe("spendCost — the crude pool reducer", () => {
    const units = (...sets: string[][]) =>
        sets.map((s) => new Set(s as ("W" | "U" | "B" | "R" | "G" | "C")[]));

    it("takes the most specific unit for a coloured pip and any unit for generic", () => {
        const pool = units(["R", "G"], ["R"], ["G"]);
        const after = spendCost(pool, { R: 1 });
        expect(after?.map((u) => [...u].sort())).toEqual([["G", "R"], ["G"]]);
        const after2 = spendCost(after!, { X: 1 });
        expect(after2).toHaveLength(1);
    });

    it("refuses what cannot be paid", () => {
        expect(spendCost(units(["G"]), { R: 1 })).toBeNull();
        expect(spendCost(units(["G"]), { X: 2 })).toBeNull();
    });
});

// Lifelink (CR 702.15b / CR 119.3, issue #936).
//
// CR 702.15b — "Damage dealt by a source with lifelink also causes that
// source's controller to gain that much life (in addition to any other results
// that damage causes)." The life gain is a consequence of the damage event
// (CR 119.3), happening simultaneously with the damage, for BOTH combat and
// non-combat damage. The engine wires this at every damage sink through the
// shared `applyLifelinkLifeGain` helper, which reads the source's EFFECTIVE
// static-ability set (the layer-6-materialized `staticAbilities` array on the
// instance — granted lifelink present, ability-loss-stripped lifelink absent),
// then funnels the gain through `gainLifeEmitting` (emitting LIFE_GAINED so a
// "whenever you gain life" trigger observes it).
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardType } from "../../cards/types";
import { dealDamageFromPermanentToPlayer, gainLifeEmitting } from "../state";
import { applyAllCombatDamage } from "../phases";
import { makePlayer, makeState } from "../../cards/__tests__/setup";

function creature(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

/** p1 (active) attacks; `blockerAssignments` maps blocker id -> attacker ids. */
function combatState(
    p1Field: CardInstanceState[],
    p2Field: CardInstanceState[],
    combat: Partial<GameState["combat"]> & { attackerIds: string[] }
): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: p1Field }),
            makePlayer("p2", { battlefield: p2Field }),
        ],
        combat: {
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
            damageConfirmed: false,
            ...combat,
        } as GameState["combat"],
    });
}

describe("lifelink combat damage to a player (CR 702.15b, AC1)", () => {
    it("unblocked 7/7 lifelink deals 7 and its controller gains 7 in the same step", () => {
        const griselbrand = creature("gris", 7, 7, {
            staticAbilities: ["flying", "lifelink"],
        });
        const state = combatState([griselbrand], [], {
            attackerIds: ["gris"],
        });

        applyAllCombatDamage(state, {});

        // Opponent took 7 combat damage...
        expect(state.players[1].life).toBe(13);
        // ...and the lifelink controller gained 7, simultaneously (CR 119.3).
        expect(state.players[0].life).toBe(27);
    });

    it("a non-lifelink attacker gains no life (control)", () => {
        const bear = creature("bear", 7, 7, { staticAbilities: [] });
        const state = combatState([bear], [], { attackerIds: ["bear"] });

        applyAllCombatDamage(state, {});

        expect(state.players[1].life).toBe(13);
        expect(state.players[0].life).toBe(20);
    });
});

describe("lifelink combat damage to a blocker (CR 702.15b, AC2)", () => {
    it("gains life equal to the damage dealt to the blocking creature", () => {
        const attacker = creature("gris", 7, 7, {
            staticAbilities: ["lifelink"],
        });
        const wall = creature("wall", 0, 10, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = combatState([attacker], [wall], {
            attackerIds: ["gris"],
            blockerAssignments: { wall: ["gris"] },
            blockedAttackerIds: ["gris"],
        });

        // Attacker assigns its 7 power to the wall.
        applyAllCombatDamage(state, { gris: { wall: 7 } });

        // Wall (0/10) survives; attacker's controller still gains 7.
        expect(state.players[0].life).toBe(27);
        // Opponent's life is untouched (all damage went to the wall).
        expect(state.players[1].life).toBe(20);
    });
});

describe("two lifelink attackers each gain independently (CR 702.15b, AC4)", () => {
    it("each attacker's controller gains for its own damage", () => {
        const a = creature("a", 3, 3, { staticAbilities: ["lifelink"] });
        const b = creature("b", 4, 4, { staticAbilities: ["lifelink"] });
        const state = combatState([a, b], [], { attackerIds: ["a", "b"] });

        applyAllCombatDamage(state, {});

        // Opponent took 3 + 4 = 7.
        expect(state.players[1].life).toBe(13);
        // Controller gained 3 + 4 = 7 (two independent gains).
        expect(state.players[0].life).toBe(27);
    });
});

describe("lifelink respects the effective ability set (CR 613 layer 6, AC5)", () => {
    it("lifelink GRANTED by a continuous effect (materialized into staticAbilities) gains life", () => {
        // The printed definition has no lifelink; a layer-6 keyword-grant has
        // materialized "lifelink" onto the instance's staticAbilities array.
        const granted = creature("granted", 5, 5, {
            staticAbilities: ["lifelink"],
        });
        const state = combatState([granted], [], {
            attackerIds: ["granted"],
        });

        applyAllCombatDamage(state, {});

        expect(state.players[1].life).toBe(15);
        expect(state.players[0].life).toBe(25);
    });

    it("lifelink REMOVED by an ability-loss effect (empty staticAbilities) grants no life", () => {
        // The printed definition would carry lifelink, but an ability-loss
        // (Humility/Titania's Song) has stripped the instance's array to empty.
        // Reading the effective set (not the printed def) means no life gain.
        const stripped = creature("stripped", 5, 5, {
            staticAbilities: [],
        });
        const state = combatState([stripped], [], {
            attackerIds: ["stripped"],
        });

        applyAllCombatDamage(state, {});

        expect(state.players[1].life).toBe(15);
        expect(state.players[0].life).toBe(20);
    });
});

describe("lifelink non-combat damage (CR 702.15b, AC3)", () => {
    it("a lifelink permanent dealing non-combat damage to a player gains life", () => {
        const source = creature("src", 2, 2, {
            staticAbilities: ["lifelink"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });

        dealDamageFromPermanentToPlayer(state, source, "p1", "p2", 3);

        expect(state.players[1].life).toBe(17);
        expect(state.players[0].life).toBe(23);
    });

    it("a non-lifelink permanent dealing non-combat damage gains no life", () => {
        const source = creature("src", 2, 2, { staticAbilities: [] });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });

        dealDamageFromPermanentToPlayer(state, source, "p1", "p2", 3);

        expect(state.players[1].life).toBe(17);
        expect(state.players[0].life).toBe(20);
    });
});

describe("life-gain triggers observe lifelink gains (CR 119.3, AC6)", () => {
    it("the lifelink gain funnels through gainLifeEmitting, emitting LIFE_GAINED", () => {
        // Every lifelink sink routes its gain through this single choke point,
        // which emits the LIFE_GAINED event a "whenever you gain life" trigger
        // listens on (the symmetric counterpart of LIFE_LOST).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });

        gainLifeEmitting(state, "p1", 7);

        expect(state.players[0].life).toBe(27);
        expect(state.pendingEvents).toContainEqual({
            type: "LIFE_GAINED",
            playerId: "p1",
            amount: 7,
        });
    });

    it("emits no LIFE_GAINED for a zero-amount gain", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });

        gainLifeEmitting(state, "p1", 0);

        expect(state.players[0].life).toBe(20);
        expect(state.pendingEvents ?? []).not.toContainEqual(
            expect.objectContaining({ type: "LIFE_GAINED" })
        );
    });
});

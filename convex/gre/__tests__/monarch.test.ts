// Monarch designation (CR 720, issue #1199). Covers the four CR clauses:
// 720.1/720.2 (at most one monarch, crowning reassigns and is idempotent),
// 720.3 (combat damage to the monarch steals it — a DIVERGENCE-flagged
// immediate hook in `applyOneCombatDamage`, phases.ts), 720.4 (the monarch
// draws at the beginning of THEIR end step — likewise an immediate hook),
// and the Palace Jailer "exile until an opponent becomes the monarch"
// primitive (`exileUntilMonarchChanges` / `monarchReturnWatch`).
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardType } from "../../cards/types";
import { becomeMonarch, exileUntilMonarchChanges, getPlayer } from "../state";
import { applyAllCombatDamage, advancePhase } from "../phases";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import { projectPublicState, projectFullState } from "../../gameProjections";

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

function libraryCard(id: string, ownerId: string): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Land"] as CardType[],
        subtypes: [],
        staticAbilities: [],
        controllerId: ownerId,
        ownerId,
        zone: "library",
        isTapped: false,
    };
}

describe("Monarch — crowning (CR 720.1 / 720.2, issue #1199)", () => {
    it("starts with no monarch", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        expect(state.monarchId).toBeUndefined();
    });

    it("becomeMonarch crowns a player", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        becomeMonarch(state, "p1");
        expect(state.monarchId).toBe("p1");
    });

    it("crowning someone new displaces the prior holder (only one monarch at a time)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        becomeMonarch(state, "p1");
        becomeMonarch(state, "p2");
        expect(state.monarchId).toBe("p2");
    });

    it("is idempotent — re-crowning the current monarch is a no-op", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        becomeMonarch(state, "p1");
        becomeMonarch(state, "p1");
        expect(state.monarchId).toBe("p1");
    });
});

describe("Monarch — combat-damage steal (CR 720.3, issue #1199)", () => {
    it("a creature dealing combat damage to the monarch steals the designation for its controller", () => {
        const attacker = creature("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
                damageConfirmed: false,
                attackerIds: ["atk"],
            } as GameState["combat"],
        });
        becomeMonarch(state, "p1");

        applyAllCombatDamage(state, {});

        expect(state.players[0].life).toBe(17);
        expect(state.monarchId).toBe("p2");
    });

    it("does nothing if the damaged player isn't the monarch", () => {
        const attacker = creature("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
                damageConfirmed: false,
                attackerIds: ["atk"],
            } as GameState["combat"],
        });
        // No monarch at all — nothing to steal.
        applyAllCombatDamage(state, {});
        expect(state.monarchId).toBeUndefined();
    });

    it("is a no-op when the attacker's controller is already the monarch", () => {
        const attacker = creature("atk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            combat: {
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
                damageConfirmed: false,
                attackerIds: ["atk"],
            } as GameState["combat"],
        });
        // p1 is damaged but p2 (the attacker's controller) is already the
        // monarch — CR 720.3 "unless that player is already the monarch".
        becomeMonarch(state, "p2");
        applyAllCombatDamage(state, {});
        expect(state.monarchId).toBe("p2");
    });
});

describe("Monarch — end-step draw (CR 720.4, issue #1199)", () => {
    it("the monarch draws a card at the beginning of THEIR end step", () => {
        const state = makeState({
            phase: "POSTCOMBAT_MAIN",
            turn: 2,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    library: [libraryCard("lib1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        becomeMonarch(state, "p1");

        advancePhase(state);

        expect(state.phase).toBe("END_STEP");
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(0);
    });

    it("does NOT draw on a non-monarch's end step", () => {
        const state = makeState({
            phase: "POSTCOMBAT_MAIN",
            turn: 2,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    library: [libraryCard("lib1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        // p2 is the monarch, but it's p1's end step.
        becomeMonarch(state, "p2");

        advancePhase(state);

        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(1);
    });

    it("no draw at all when there is no monarch", () => {
        const state = makeState({
            phase: "POSTCOMBAT_MAIN",
            turn: 2,
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    library: [libraryCard("lib1", "p1")],
                }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state);
        expect(state.players[0].hand).toHaveLength(0);
    });
});

describe("Monarch — Palace Jailer's exile-until-monarch-changes primitive (CR 720, issue #1199)", () => {
    it("exiles the target and arms a watch keyed to the exiler's controller", () => {
        const victim = creature("victim", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });

        exileUntilMonarchChanges(state, "victim", "jailer-src", "p1");

        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p2").exile).toHaveLength(1);
        expect(state.monarchReturnWatch).toEqual([
            { sourceId: "jailer-src", controllerId: "p1" },
        ]);
    });

    it("does NOT release when the exiler's own controller (re)becomes the monarch", () => {
        const victim = creature("victim", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        exileUntilMonarchChanges(state, "victim", "jailer-src", "p1");

        becomeMonarch(state, "p1");

        expect(getPlayer(state, "p2").exile).toHaveLength(1);
        expect(state.monarchReturnWatch).toHaveLength(1);
    });

    it("releases the exiled creature the moment an opponent of the exiler becomes the monarch", () => {
        const victim = creature("victim", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        exileUntilMonarchChanges(state, "victim", "jailer-src", "p1");

        becomeMonarch(state, "p2");

        expect(getPlayer(state, "p2").exile).toHaveLength(0);
        expect(getPlayer(state, "p2").battlefield).toHaveLength(1);
        expect(state.monarchReturnWatch).toBeUndefined();
    });
});

describe("Monarch — wire format (issue #1199)", () => {
    it("monarchId survives projectPublicState", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        becomeMonarch(state, "p1");
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.monarchId).toBe("p1");
    });

    it("monarchId survives projectFullState", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        becomeMonarch(state, "p1");
        const projected = projectFullState(state, 1);
        expect(projected.monarchId).toBe("p1");
    });
});

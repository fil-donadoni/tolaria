// M3C red — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { pyrogoyf } from "../red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import type {
    CardType,
    PermanentView,
    TargetSelection,
    TriggerStateView,
} from "../../../types";

// A dead card of a chosen card type sitting in a graveyard (the CDA reads the
// instance `.types`), mirroring the Barrowgoyf fixture (m3c/black.ts test).
function deadCard(
    id: string,
    owner: string,
    types: CardType[]
): CardInstanceState {
    return {
        id,
        card: { id: `fake-${id}` },
        types,
        subtypes: [],
        staticAbilities: [],
        power: 0,
        toughness: 0,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
        isTapped: false,
    };
}

// A vanilla creature on the battlefield with a fixed printed P/T — used both as
// a damage target and as "another Lhurgoyf you control" when subtypes carry it.
function creature(
    id: string,
    owner: string,
    power: number,
    toughness: number,
    subtypes: string[] = []
): CardInstanceState {
    return {
        id,
        card: { id: `fake-${id}` },
        types: ["Creature"],
        subtypes,
        staticAbilities: [],
        power,
        toughness,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
        isTapped: false,
    };
}

/** Pushes Pyrogoyf's enter trigger onto the stack with a synthetic
 *  PERMANENT_ENTERED event for `enteringId`, an announced `target`, and
 *  resolves it (mirrors the engine after `collectTriggers` +
 *  `raiseTriggerTargetSelection`). */
function fireEnterTrigger(
    state: GameState,
    source: CardInstanceState,
    enteringId: string,
    target: TargetSelection
): void {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "pyrogoyf-lhurgoyf-enters",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: enteringId,
            controllerId: source.controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: [target],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

describe("Pyrogoyf (CR 604.3 all-graveyards CDA P/T, CR 603.3d targeted enter-damage trigger)", () => {
    it("power = distinct card types among ALL players' graveyards, toughness = that + 1", () => {
        const goyf = makeInstance(pyrogoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [
                        deadCard("c1", "p1", ["Creature"]),
                        deadCard("c2", "p1", ["Creature"]), // dup type
                        deadCard("l1", "p1", ["Land"]),
                    ],
                }),
                makePlayer("p2", {
                    graveyard: [deadCard("i1", "p2", ["Instant"])],
                }),
            ],
        });
        const after = state.players[0].battlefield[0];
        // Creature, Land, Instant = 3 distinct types across both graveyards.
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
    });

    it("MANDATORY wire format: the all-graveyards CDA survives projectPublicState", () => {
        const goyf = makeInstance(pyrogoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [deadCard("c1", "p1", ["Creature"])],
                }),
                makePlayer("p2", {
                    graveyard: [deadCard("i1", "p2", ["Instant"])],
                }),
            ],
        });
        const before = state.players[0].battlefield[0];
        expect(getEffectivePower(state, before)).toBe(2);
        expect(getEffectiveToughness(state, before)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "goyf"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });

    it("its own ETB deals damage equal to its power to a target player", () => {
        const goyf = makeInstance(pyrogoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [
                        deadCard("c1", "p1", ["Creature"]),
                        deadCard("l1", "p1", ["Land"]),
                        deadCard("i1", "p1", ["Instant"]),
                    ],
                }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        // Power = 3 distinct types (Creature, Land, Instant).
        expect(getEffectivePower(state, goyf)).toBe(3);
        fireEnterTrigger(state, goyf, "goyf", { type: "player", id: "p2" });
        expect(state.players.find((p) => p.id === "p2")!.life).toBe(17);
    });

    it("its own ETB deals damage equal to its power to a target creature (lethal marks it)", () => {
        const goyf = makeInstance(pyrogoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = creature("bear", "p2", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [
                        deadCard("c1", "p1", ["Creature"]),
                        deadCard("l1", "p1", ["Land"]),
                    ],
                }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Power = 2 distinct types (Creature, Land) — lethal to a 2/2, which
        // dies to the CR 704.5g lethal-damage SBA after the trigger resolves.
        expect(getEffectivePower(state, goyf)).toBe(2);
        fireEnterTrigger(state, goyf, "goyf", { type: "permanent", id: "bear" });
        const p2 = state.players[1];
        expect(p2.battlefield.find((c) => c.id === "bear")).toBeUndefined();
        expect(p2.graveyard.map((c) => c.id)).toContain("bear");
    });

    it("resolves damage equal to the ENTERING creature's power for another Lhurgoyf you control (not Pyrogoyf's own power)", () => {
        const goyf = makeInstance(pyrogoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Another Lhurgoyf you control, a printed 4/4 — its power (4), not
        // Pyrogoyf's CDA (2 here), is what the trigger deals.
        const other = creature("other", "p1", 4, 4, ["Lhurgoyf"]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf, other],
                    graveyard: [
                        deadCard("c1", "p1", ["Creature"]),
                        deadCard("l1", "p1", ["Land"]),
                    ],
                }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        expect(getEffectivePower(state, goyf)).toBe(2);
        fireEnterTrigger(state, goyf, "other", { type: "player", id: "p2" });
        expect(state.players.find((p) => p.id === "p2")!.life).toBe(16);
    });
});

describe("Pyrogoyf trigger matches predicate (CR 603.2 — this or another Lhurgoyf creature you control)", () => {
    const ability = pyrogoyf.triggeredAbilities![0];
    const self: PermanentView = {
        id: "goyf",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"],
        subtypes: ["Lhurgoyf"],
        staticAbilities: [],
    } as unknown as PermanentView;

    function enterEvent(instanceId: string, controllerId: string) {
        return {
            type: "PERMANENT_ENTERED" as const,
            instanceId,
            controllerId,
            types: ["Creature"] as CardType[],
        };
    }

    function stateWith(rows: CardInstanceState[]): TriggerStateView {
        return {
            players: [{ id: "p1", life: 20, battlefield: rows, hand: { length: 0 } }],
        } as unknown as TriggerStateView;
    }

    it("matches Pyrogoyf's own ETB (this creature)", () => {
        expect(
            ability.matches(enterEvent("goyf", "p1"), self, stateWith([]))
        ).toBe(true);
    });

    it("matches another Lhurgoyf creature you control", () => {
        const other = creature("other", "p1", 4, 4, ["Lhurgoyf"]);
        expect(
            ability.matches(enterEvent("other", "p1"), self, stateWith([other]))
        ).toBe(true);
    });

    it("does NOT match a non-Lhurgoyf creature you control", () => {
        const bear = creature("bear", "p1", 2, 2, []);
        expect(
            ability.matches(enterEvent("bear", "p1"), self, stateWith([bear]))
        ).toBe(false);
    });

    it("does NOT match a Lhurgoyf an opponent controls", () => {
        const oppGoyf = creature("opp", "p2", 3, 3, ["Lhurgoyf"]);
        expect(
            ability.matches(enterEvent("opp", "p2"), self, stateWith([oppGoyf]))
        ).toBe(false);
    });
});

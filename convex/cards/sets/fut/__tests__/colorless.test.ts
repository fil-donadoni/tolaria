// FUT (Future Sight) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { horizonCanopy, swordOfTheMeek } from "../colorless";
import { savannahLions } from "../../lea/white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type CardInstanceState,
} from "../../../../gre/state";
import type { GameEvent } from "../../../types";
import { collectTriggers } from "../../../../gre/triggers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { registerTokenDefinition } from "../../..";

const ONE_ONE_ID = "test-futc-one-one";
registerTokenDefinition({
    id: ONE_ONE_ID,
    name: ONE_ONE_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    subtypes: ["Germ"],
    power: 1,
    toughness: 1,
});
const oneOne = (owner: string, cid: string) =>
    makeInstance(ONE_ONE_ID, { id: cid, controllerId: owner, ownerId: owner });

/** Push an activated ability onto the stack (cost assumed already paid) and
 *  resolve it — mirrors post-`activateAbility` state. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("Horizon Canopy (painland cantrip, CR 605.1a / 305)", () => {
    it("is a Land with a pay-life dual mana ability and a sacrifice cantrip", () => {
        expect(horizonCanopy.types).toEqual(["Land"]);
        expect(horizonCanopy.manaCost).toBeUndefined();
        const mana = horizonCanopy.activatedAbilities!.find(
            (a) => a.id === "horizon-canopy-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.cost).toMatchObject({ tap: true, life: 1 });
        expect(mana.manaChoices).toEqual([{ G: 1 }, { W: 1 }]);
        const draw = horizonCanopy.activatedAbilities!.find(
            (a) => a.id === "horizon-canopy-draw"
        )!;
        expect(draw.cost).toMatchObject({
            mana: { X: 1 },
            tap: true,
            sacrifice: true,
        });
    });

    it("the cantrip ability draws a card on resolution (CR 121.1)", () => {
        const land = makeInstance(horizonCanopy.id, {
            id: "canopy",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const lib = makeInstance(horizonCanopy.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land], library: [lib] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, land, "horizon-canopy-draw");
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
    });
});

// ---------------------------------------------------------------------------
// Sword of the Meek — CR 603.6e graveyard-zone recursive trigger (issue
// #1965). The canned smoke generator explicitly SKIPS both this card's
// abilities ("attach targets a creature the CONTROLLER controls — not
// modelable", "mayPay suspends for a Pay/Skip decision"), so per the per-Op
// regime this earns hand-written tests.
// ---------------------------------------------------------------------------

describe("Sword of the Meek (CR 701.3 Equipment +1/+2, CR 603.6e graveyard-zone recursive attach)", () => {
    it("is a {2} Artifact Equipment with a +1/+2 buff, Equip {2}, and a graveyard-zone trigger", () => {
        expect(swordOfTheMeek.manaCost).toEqual({ X: 2 });
        expect(swordOfTheMeek.types).toEqual(["Artifact"]);
        expect(swordOfTheMeek.subtypes).toEqual(["Equipment"]);
        expect(swordOfTheMeek.staticEffects).toEqual([
            expect.objectContaining({
                kind: "pt-buff",
                power: 1,
                toughness: 2,
            }),
        ]);
        const equip = swordOfTheMeek.activatedAbilities!.find(
            (a) => a.id === "sword-of-the-meek-equip"
        )!;
        expect(equip.cost).toEqual({ mana: { X: 2 } });
        expect(equip.sorcerySpeedOnly).toBe(true);

        const trig = swordOfTheMeek.triggeredAbilities!.find(
            (a) => a.id === "sword-of-the-meek-return"
        )!;
        expect(trig.event).toBe("PERMANENT_ENTERED");
        expect(trig.zone).toBe("graveyard");
    });

    it("Equipment +1/+2 buff applies to the equipped creature, and survives the wire projection", () => {
        // Unattached — no buff (baseline: Savannah Lions is printed 2/1).
        const unattachedSword = makeInstance(swordOfTheMeek.id, {
            id: "sword",
        });
        const looseLion = makeInstance(savannahLions.id, { id: "lion" });
        const unattachedState = makeState({
            players: [
                makePlayer("p1", { battlefield: [unattachedSword, looseLion] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(unattachedState, looseLion)).toBe(2);
        expect(getEffectiveToughness(unattachedState, looseLion)).toBe(1);

        // Attached — Sword's `attachedTo` names the equipped creature (CR
        // 301.5c — the pointer lives on the Equipment instance).
        const attachedSword = makeInstance(swordOfTheMeek.id, {
            id: "sword",
            attachedTo: "lion",
        });
        const lion = makeInstance(savannahLions.id, { id: "lion" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attachedSword, lion] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, lion)).toBe(3);
        expect(getEffectiveToughness(state, lion)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(getEffectivePower(projected, slimLion)).toBe(3);
        expect(getEffectiveToughness(projected, slimLion)).toBe(3);
    });

    function gyState(overrides: Partial<GameState> = {}): GameState {
        const sword = makeInstance(swordOfTheMeek.id, {
            id: "sword",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        return makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { graveyard: [sword] }),
                makePlayer("p2"),
            ],
            ...overrides,
        });
    }

    const enteredEvent = (
        instanceId: string,
        controllerId: string,
        types: readonly string[] = ["Creature"]
    ): GameEvent =>
        ({
            type: "PERMANENT_ENTERED",
            instanceId,
            controllerId,
            types,
        }) as GameEvent;

    it("triggers when a 1/1 creature its controller controls enters (CR 603.6e)", () => {
        const state = gyState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(swordOfTheMeek.id, {
                            id: "sword",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                    battlefield: [oneOne("p1", "germ")],
                }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [enteredEvent("germ", "p1")]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggeredAbilityId).toBe("sword-of-the-meek-return");
    });

    it("does NOT trigger for a creature that isn't 1/1", () => {
        const state = gyState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(swordOfTheMeek.id, {
                            id: "sword",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                    battlefield: [
                        makeInstance(savannahLions.id, {
                            id: "notoneone",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            enteredEvent("notoneone", "p1"),
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("does NOT trigger for a 1/1 creature the OPPONENT controls (CR 109.5 — 'you control')", () => {
        const state = gyState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(swordOfTheMeek.id, {
                            id: "sword",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2", { battlefield: [oneOne("p2", "oppgerm")] }),
            ],
        });
        const triggers = collectTriggers(state, [
            enteredEvent("oppgerm", "p2"),
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("accepted: returns to the battlefield and attaches to the entering 1/1 creature", () => {
        const state = gyState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(swordOfTheMeek.id, {
                            id: "sword",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                    battlefield: [oneOne("p1", "germ")],
                }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [enteredEvent("germ", "p1")]);
        state.stack.push(...triggers);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay

        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("may-pay");
        expect(pending.cost).toBeUndefined();

        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const sword = state.players[0].battlefield.find(
            (c) => c.id === "sword"
        );
        expect(sword).toBeDefined();
        expect(sword!.attachedTo).toBe("germ");
        expect(
            state.players[0].graveyard.find((c) => c.id === "sword")
        ).toBeUndefined();
        // The equipped 1/1 now reads 2/3 (base 1/1 + Sword's +1/+2).
        const germ = state.players[0].battlefield.find((c) => c.id === "germ")!;
        expect(getEffectivePower(state, germ)).toBe(2);
        expect(getEffectiveToughness(state, germ)).toBe(3);
    });

    it("declined: stays in the graveyard, no attach", () => {
        const state = gyState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(swordOfTheMeek.id, {
                            id: "sword",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                    battlefield: [oneOne("p1", "germ")],
                }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [enteredEvent("germ", "p1")]);
        state.stack.push(...triggers);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        expect(
            state.players[0].graveyard.find((c) => c.id === "sword")
        ).toBeDefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "sword")
        ).toBeUndefined();
    });
});

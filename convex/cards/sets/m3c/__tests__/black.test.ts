// M3C black — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { barrowgoyf } from "../black";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import type { CardType } from "../../../types";

// A dead card of a chosen card type sitting in a graveyard (the CDA reads the
// instance `.types`), mirroring Nethergoyf's fixture (mh3/black.ts).
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

// A library card sitting on top, milled by Barrowgoyf's combat-damage
// trigger. `name` distinguishes fixture ids in assertions.
function libCard(
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
        power: 1,
        toughness: 1,
        controllerId: owner,
        ownerId: owner,
        zone: "library",
        isTapped: false,
    };
}

/** Pushes Barrowgoyf's combat-damage trigger onto the stack with a synthetic
 *  DAMAGE_DEALT event and resolves it (mirrors the engine after
 *  `collectTriggers` places the trigger, ice/__tests__/helpers.ts's
 *  `resolveTrigger` pattern). */
function fireCombatDamage(
    state: GameState,
    source: CardInstanceState,
    targetPlayerId: string,
    amount: number
): void {
    const item: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "barrowgoyf-combat-damage",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "DAMAGE_DEALT",
            sourceInstanceId: source.id,
            sourceControllerId: source.controllerId,
            target: { type: "player", id: targetPlayerId },
            amount,
            isCombat: true,
        } as StackItem["triggerEvent"],
        targets: [],
    };
    state.stack.push(item);
    resolveTopOfStack(state);
}

describe("Barrowgoyf (CR 604.3 all-graveyards CDA P/T, CR 603.4/701.17 combat-damage mill)", () => {
    it("declares deathtouch and lifelink", () => {
        expect(barrowgoyf.staticAbilities).toEqual(["deathtouch", "lifelink"]);
    });

    it("power/toughness = distinct card types among ALL players' graveyards", () => {
        const goyf = makeInstance(barrowgoyf.id, {
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
                // Unlike Nethergoyf's "your graveyard", Barrowgoyf reads
                // EVERY graveyard.
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

    it("MANDATORY wire format: the all-graveyards count survives projectPublicState", () => {
        const goyf = makeInstance(barrowgoyf.id, {
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

    it("declining the mill leaves the library and graveyard untouched", () => {
        const goyf = makeInstance(barrowgoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    library: [
                        libCard("top1", "p1", ["Creature"]),
                        libCard("top2", "p1", ["Land"]),
                    ],
                }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireCombatDamage(state, goyf, "p2", 2);
        // Suspended on the "mill 2 cards?" may-pay.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.library).toHaveLength(2);
        expect(p1.graveyard).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("accepting the mill moves the top N cards to the graveyard, then offers a creature retrieval restricted to the milled cards", () => {
        const goyf = makeInstance(barrowgoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    library: [
                        libCard("top1", "p1", ["Creature"]),
                        libCard("top2", "p1", ["Land"]),
                        libCard("top3", "p1", ["Instant"]),
                    ],
                }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireCombatDamage(state, goyf, "p2", 3);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const p1After = state.players.find((p) => p.id === "p1")!;
        expect(p1After.library).toHaveLength(0);
        expect(p1After.graveyard.map((c) => c.id).sort()).toEqual([
            "top1",
            "top2",
            "top3",
        ]);

        // Suspended on the creature-retrieval choice, restricted to the ONE
        // milled creature card (never the whole graveyard).
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-graveyard-card");
        expect(head.candidateIds).toEqual(["top1"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["top1"],
        });

        const p1Final = state.players.find((p) => p.id === "p1")!;
        expect(p1Final.hand.map((c) => c.id)).toEqual(["top1"]);
        expect(p1Final.graveyard.map((c) => c.id).sort()).toEqual([
            "top2",
            "top3",
        ]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("no creature among the milled cards skips the retrieval choice entirely", () => {
        const goyf = makeInstance(barrowgoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    library: [
                        libCard("top1", "p1", ["Land"]),
                        libCard("top2", "p1", ["Instant"]),
                    ],
                }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireCombatDamage(state, goyf, "p2", 2);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const p1After = state.players.find((p) => p.id === "p1")!;
        expect(p1After.graveyard.map((c) => c.id).sort()).toEqual([
            "top1",
            "top2",
        ]);
        expect(p1After.hand).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});

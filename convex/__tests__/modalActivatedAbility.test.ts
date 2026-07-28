/**
 * Modal ACTIVATED abilities (CR 700.2 + CR 602.2b, issue #1341).
 *
 * The engine already had CR-correct announce-time modality for SPELLS
 * (`CardDefinition.modes`, `chosenModeId` riding pendingCast → pendingTarget →
 * stack item). Umezawa's Jitte needs the same for an ACTIVATED ability, where
 * CR 602.2b routes announcement through the very same 601.2b/601.2c order:
 * the mode is locked FIRST, and only the chosen mode's targets are declared
 * (CR 700.2d).
 *
 * These tests drive the REAL activation path (`activateAbilityOnState`, the
 * body of the `activateAbility` mutation) plus `finalizeTargetSelection` and
 * `resolveTopOfStack`, so they cover the whole GRE → game.ts seam a per-mode
 * requirement crosses — the "two pieces passing individually but failing
 * together" class the project's integration mandate exists for. The Jitte's
 * own card-level behaviour lives in `cards/sets/bok/__tests__/colorless.ts`.
 */

import { describe, expect, it } from "vitest";
import { activateAbilityOnState, finalizeTargetSelection } from "../game";
import { buildStateFromScenario } from "../gre/scenarioBuilder";
import { createInitialGameState, type PlayerInput } from "../gre/setup";
import { getCardByName } from "../cards";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../gre/layers";
import type { ScenarioSpec } from "../debugScenarioSpec";

function player(id: string): PlayerInput {
    const filler = getCardByName("Plains");
    return {
        id,
        name: id,
        bgColor: "#000000",
        deck: {
            id: `deck-${id}`,
            name: "test",
            format: "freeform",
            cards: Array.from({ length: 60 }, () => ({
                cardId: filler.id,
                cardName: filler.name,
            })),
        },
    };
}

function build(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(
        createInitialGameState([player("p1"), player("p2")], 0x51ade),
        spec
    );
}

function find(state: GameState, name: string): CardInstanceState {
    const def = getCardByName(name);
    const card = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => (c.card as { id?: string }).id === def.id);
    if (!card) throw new Error(`${name} not on the battlefield`);
    return card;
}

const JITTE_MODES = "umezawas-jitte-modes";

/** Jitte equipped to a Grizzly Bears, already holding `charges` counters. */
function equippedJitte(charges = 2): {
    state: GameState;
    jitte: CardInstanceState;
    bear: CardInstanceState;
} {
    const state = build({
        cards: [
            {
                name: "Grizzly Bears",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
            {
                name: "Umezawa's Jitte",
                owner: "me",
                zone: "battlefield",
                attachedTo: "Grizzly Bears",
            },
            {
                name: "Hill Giant",
                owner: "opp",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 3,
    });
    const jitte = find(state, "Umezawa's Jitte");
    jitte.counters = { ...(jitte.counters ?? {}), charge: charges };
    return { state, jitte, bear: find(state, "Grizzly Bears") };
}

describe("modal activated ability — announcement (CR 700.2 / 602.2b)", () => {
    it("rejects an activation that names no mode", () => {
        const { state, jitte } = equippedJitte();
        expect(() =>
            activateAbilityOnState(state, {
                playerId: state.players[0].id,
                cardInstanceId: jitte.id,
                abilityId: JITTE_MODES,
            })
        ).toThrow(/must choose a mode/i);
        expect(state.stack).toHaveLength(0);
        // Nothing was paid on the rejected announcement (CR 601.2h).
        expect(jitte.counters?.charge).toBe(2);
    });

    it("rejects an unknown mode id", () => {
        const { state, jitte } = equippedJitte();
        expect(() =>
            activateAbilityOnState(state, {
                playerId: state.players[0].id,
                cardInstanceId: jitte.id,
                abilityId: JITTE_MODES,
                chosenModeId: "not-a-mode",
            })
        ).toThrow(/unknown mode id/i);
        expect(state.stack).toHaveLength(0);
    });

    it("rejects a mode on a NON-modal ability", () => {
        const { state, jitte } = equippedJitte();
        expect(() =>
            activateAbilityOnState(state, {
                playerId: state.players[0].id,
                cardInstanceId: jitte.id,
                abilityId: "umezawas-jitte-equip",
                chosenModeId: "pump-equipped",
            })
        ).toThrow(/not modal/i);
    });
});

describe("modal activated ability — a NON-targeting mode (CR 700.2d)", () => {
    it("goes straight to the stack carrying its mode, and pays the counter cost", () => {
        const { state, jitte } = equippedJitte();
        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: jitte.id,
            abilityId: JITTE_MODES,
            chosenModeId: "gain-life",
        });

        // No target prompt — the chosen mode declares none, even though a
        // SIBLING mode does (the whole point of per-mode requirements).
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe(JITTE_MODES);
        expect(state.stack[0].chosenModeId).toBe("gain-life");
        // CR 122.6 — the counter cost is paid as the ability is activated.
        expect(
            state.players[0].battlefield.find((c) => c.id === jitte.id)!
                .counters?.charge
        ).toBe(1);

        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);
    });

    it("dispatches the `$host` mode against the equipped creature, not a target", () => {
        const { state, jitte, bear } = equippedJitte();
        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: jitte.id,
            abilityId: JITTE_MODES,
            chosenModeId: "pump-equipped",
        });
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack[0].targets ?? []).toHaveLength(0);

        resolveTopOfStack(state);
        const host = state.players[0].battlefield.find(
            (c) => c.id === bear.id
        )!;
        expect(getEffectivePower(state, host)).toBe(4); // 2 + 2
        expect(getEffectiveToughness(state, host)).toBe(4);
        // The opponent's creature is untouched — `$host` is not a board sweep.
        const giant = state.players[1].battlefield[0];
        expect(getEffectivePower(state, giant)).toBe(3);
    });

    it("`$host` on an UNATTACHED source is a no-op (CR 608.2b), not a crash", () => {
        const { state, jitte } = equippedJitte();
        // Detach before activating — the ability is still legal (its cost is
        // just a counter), its effect simply does nothing.
        state.players[0].battlefield.find(
            (c) => c.id === jitte.id
        )!.attachedTo = undefined;
        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: jitte.id,
            abilityId: JITTE_MODES,
            chosenModeId: "pump-equipped",
        });
        expect(() => resolveTopOfStack(state)).not.toThrow();
        const bear = find(state, "Grizzly Bears");
        expect(getEffectivePower(state, bear)).toBe(2);
    });
});

describe("modal activated ability — a TARGETING mode (CR 601.2c / 700.2d)", () => {
    it("opens pendingTarget with only THAT mode's requirement and resolves on it", () => {
        const { state, jitte } = equippedJitte();
        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: jitte.id,
            abilityId: JITTE_MODES,
            chosenModeId: "shrink-target",
        });

        // CR 601.2c — targets are chosen after the mode, before the ability
        // reaches the stack.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingTarget?.kind).toBe("ability");
        expect(state.pendingTarget?.abilityId).toBe(JITTE_MODES);
        expect(state.pendingTarget?.targetType).toBe("Creature");
        // The mode rides the prompt so it survives onto the stack item.
        expect(state.pendingTarget?.chosenModeId).toBe("shrink-target");

        const giant = state.players[1].battlefield[0];
        state.pendingTarget!.selected = [{ type: "permanent", id: giant.id }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.players[0].id
        );
        state.pendingTarget = undefined;

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].chosenModeId).toBe("shrink-target");
        resolveTopOfStack(state);

        const shrunk = state.players[1].battlefield.find(
            (c) => c.id === giant.id
        )!;
        expect(getEffectivePower(state, shrunk)).toBe(2); // 3 - 1
        expect(getEffectiveToughness(state, shrunk)).toBe(2);
        // The equipped creature was NOT the subject of this mode.
        expect(getEffectivePower(state, find(state, "Grizzly Bears"))).toBe(2);
    });
});

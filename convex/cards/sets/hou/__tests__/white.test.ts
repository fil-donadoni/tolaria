// HOU — white card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import type { GameState, StackItem } from "../../../../gre/state";
import { crestedSunmare } from "../white";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    applySourceStaticEffects,
    gainLifeEmitting,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";

const SUNMARE_ID = crestedSunmare.id;

const endStep = (playerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "END_STEP" as const,
        activePlayerId: playerId,
    }) as StackItem["triggerEvent"];

/** p1's board: Crested Sunmare plus whatever else is passed. */
function setup(extra: Parameters<typeof makePlayer>[1] = {}) {
    const sunmare = makeInstance(SUNMARE_ID, {
        id: "sunmare",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase: "END_STEP",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", {
                ...extra,
                battlefield: [sunmare, ...(extra.battlefield ?? [])],
            }),
            makePlayer("p2"),
        ],
    });
    return { state, sunmare };
}

function pushTrigger(state: GameState, sourceId: string, activeId: string) {
    const source = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === sourceId)!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "crested-sunmare-horse",
        triggerSourceId: source.id,
        triggerEvent: endStep(activeId),
        targets: [],
    });
    resolveTopOfStack(state);
}

/** The Sunmare end-step triggers `collectTriggers` would put on the stack for
 *  the given active player — the CR 603.4 TRIGGER-TIME half of the
 *  intervening-if (the factory mirrors it into `matches`). */
function sunmareTriggers(state: GameState, activeId: string): StackItem[] {
    return collectTriggers(state, [endStep(activeId) as never]).filter(
        (t) => t.triggeredAbilityId === "crested-sunmare-horse"
    );
}

const horses = (state: GameState, playerIndex: number) =>
    state.players[playerIndex].battlefield.filter(
        (c) => c.id !== "sunmare" && c.subtypes?.includes("Horse")
    );

describe("Crested Sunmare — 'Other Horses you control have indestructible' (CR 611 layer 6)", () => {
    it("grants indestructible to another Horse you control, but not to itself", () => {
        const otherHorse = makeInstance(SUNMARE_ID, {
            id: "other-horse",
            controllerId: "p1",
            ownerId: "p1",
        });
        const { state, sunmare } = setup({ battlefield: [otherHorse] });
        applySourceStaticEffects(state, sunmare);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "other-horse"
        )!;
        expect(live.staticAbilities).toContain("indestructible");
        const selfLive = state.players[0].battlefield.find(
            (c) => c.id === "sunmare"
        )!;
        expect(selfLive.staticAbilities ?? []).not.toContain("indestructible");

        // …and the grant survives the wire projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "other-horse"
        )!;
        expect(slim.staticAbilities).toContain("indestructible");
    });

    it("does not grant it to a non-Horse, nor to an opponent's Horse", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppHorse = makeInstance(SUNMARE_ID, {
            id: "opp-horse",
            controllerId: "p2",
            ownerId: "p2",
        });
        const { state, sunmare } = setup({ battlefield: [bears] });
        state.players[1].battlefield.push(oppHorse);
        applySourceStaticEffects(state, sunmare);
        expect(bears.staticAbilities ?? []).not.toContain("indestructible");
        expect(oppHorse.staticAbilities ?? []).not.toContain("indestructible");
    });
});

describe("Crested Sunmare — 'if you gained life this turn' intervening-if (CR 603.4 / 603.4d)", () => {
    it("does NOT trigger at all when no life was gained this turn (trigger-time check)", () => {
        const { state } = setup();
        const triggers = sunmareTriggers(state, "p1");
        expect(triggers).toHaveLength(0);
    });

    it("DOES trigger once life has been gained this turn", () => {
        const { state } = setup();
        gainLifeEmitting(state, "p1", 1);
        const triggers = sunmareTriggers(state, "p1");
        expect(triggers).toHaveLength(1);
    });

    it("gaining 0 life does not arm the trigger (CR 119.3 — a zero gain is not a life gain)", () => {
        const { state } = setup();
        gainLifeEmitting(state, "p1", 0);
        const triggers = sunmareTriggers(state, "p1");
        expect(triggers).toHaveLength(0);
    });

    it("creates a 5/5 white Horse token on resolution when life was gained", () => {
        const { state } = setup();
        gainLifeEmitting(state, "p1", 3);
        pushTrigger(state, "sunmare", "p1");
        const made = horses(state, 0);
        expect(made).toHaveLength(1);
        expect(made[0].power).toBe(5);
        expect(made[0].toughness).toBe(5);
        expect(made[0].isToken).toBe(true);
        expect(made[0].controllerId).toBe("p1");
    });

    it("fizzles at resolution if the condition stopped holding (CR 603.4d re-check)", () => {
        const { state } = setup();
        gainLifeEmitting(state, "p1", 3);
        // The trigger is on the stack; a turn boundary (or any effect clearing
        // the tally) makes the intervening-if false again before it resolves.
        state.lifeGainedThisTurn = undefined;
        pushTrigger(state, "sunmare", "p1");
        expect(horses(state, 0)).toHaveLength(0);
    });

    it("fires on the OPPONENT's end step too (scope: each), still gated on YOUR life gain", () => {
        const { state } = setup();
        gainLifeEmitting(state, "p1", 2);
        state.activePlayerId = "p2";
        const triggers = sunmareTriggers(state, "p2");
        expect(triggers).toHaveLength(1);
        pushTrigger(state, "sunmare", "p2");
        expect(horses(state, 0)).toHaveLength(1);
    });

    it("the opponent's life gain does not arm YOUR trigger", () => {
        const { state } = setup();
        gainLifeEmitting(state, "p2", 5);
        const triggers = sunmareTriggers(state, "p1");
        expect(triggers).toHaveLength(0);
    });
});

describe("Crested Sunmare — wire format", () => {
    it("the tally and the created token both survive projectPublicState", () => {
        const { state } = setup();
        gainLifeEmitting(state, "p1", 3);
        pushTrigger(state, "sunmare", "p1");
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.lifeGainedThisTurn).toEqual({ p1: 3 });
        const slimHorses = projected.players[0].battlefield.filter(
            (c) => c.id !== "sunmare" && c.subtypes?.includes("Horse")
        );
        expect(slimHorses).toHaveLength(1);
        expect(slimHorses[0].power).toBe(5);
        expect(slimHorses[0].toughness).toBe(5);
    });
});

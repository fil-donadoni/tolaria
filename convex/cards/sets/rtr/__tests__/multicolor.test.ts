// RTR — multicolor card behavior tests (ADR 0043 colour split).
//
// Deathrite Shaman is explicitly SKIPPED by the auto-generated canned-scenario
// smoke sweep (`convex/gre/effects/scenarioGenerator.ts`, wired catalogue-wide
// in `convex/cards/__tests__/effectScriptSmoke.test.ts`) — "Op moveZone changes
// zones on an object/zone the canned generator does not model". Per
// `.claude/rules/gre-development.md` § DSL-first authoring, an explicit
// generator skip is the signal to add a hand-written test for that card after
// all; the "DSL card reusing exercised Ops needs no test" exemption does not
// apply here. Thopter Foundry (also in this file's module) is NOT covered
// here — it ran clean through the sweep.

import { describe, it, expect } from "vitest";
import { deathriteShaman } from "../multicolor";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

const DEATHRITE = deathriteShaman.id;

/** Pushes an activated ability onto the stack (cost assumed already paid),
 *  then resolves it. Mirrors the shim used across the other set test files
 *  (e.g. `drk/__tests__/helpers.ts`, `clb/__tests__/multicolor.test.ts`). */
function activate(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: GameState["stack"][number]["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

/** Submits an option-pick answer through the same seam the generic
 *  `submitResolutionChoice` mutation drives (mirrors
 *  `interpreter.test.ts`'s `submitOptionPick`). */
function submitOptionPick(state: GameState, optionId: string): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: [optionId],
    });
}

function setupDeathrite(): {
    state: GameState;
    deathrite: CardInstanceState;
} {
    const deathrite = makeInstance(DEATHRITE, {
        id: "deathrite",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { life: 20, battlefield: [deathrite] }),
            makePlayer("p2", { life: 20 }),
        ],
    });
    return { state, deathrite: state.players[0].battlefield[0] };
}

describe("Deathrite Shaman (CR 605.1a — targeted activated abilities, not mana abilities, per WotC 2016-06-08 ruling)", () => {
    it("definitional: {B/G} hybrid, three graveyard-hate abilities, all useStack: true", () => {
        expect(deathriteShaman.manaCost).toEqual({ hybrid: [["B", "G"]] });
        expect(deathriteShaman.activatedAbilities).toHaveLength(3);
        for (const ability of deathriteShaman.activatedAbilities!) {
            expect(ability.useStack).toBe(true);
        }
    });

    describe("{T}: exile target land card from a graveyard, add one mana of any color (CR 605.1a / 701.18)", () => {
        it("exiles the land and adds the chosen color to the caster's mana pool", () => {
            const { state, deathrite } = setupDeathrite();
            const land = makeInstance(getCardByName("Forest").id, {
                id: "gy-land",
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            });
            state.players[1].graveyard.push(land);

            activate(state, deathrite, "deathrite-shaman-land-mana", [
                { type: "graveyard-card", id: "gy-land", playerId: "p2" },
            ]);

            // The land is exiled up front; the ability then suspends on the
            // runtime color choice (optionChoice, CR 601.2b).
            expect(state.players[1].graveyard).toHaveLength(0);
            expect(state.players[1].exile.some((c) => c.id === "gy-land")).toBe(
                true
            );
            expect(state.pendingChoices?.[0]).toBeDefined();
            expect(state.players[0].manaPool.G).toBe(0);

            submitOptionPick(state, "G"); // colorChoiceModes ids are the color codes
            expect(state.players[0].manaPool.G).toBe(1);
        });
    });

    describe("{B},{T}: exile target instant or sorcery card from a graveyard, each opponent loses 2 life (CR 605.1a / 701.18)", () => {
        it("exiles the card and drains each opponent for 2", () => {
            const { state, deathrite } = setupDeathrite();
            const bolt = makeInstance(getCardByName("Lightning Bolt").id, {
                id: "gy-instant",
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            });
            state.players[1].graveyard.push(bolt);

            activate(state, deathrite, "deathrite-shaman-graveyard-hate", [
                { type: "graveyard-card", id: "gy-instant", playerId: "p2" },
            ]);

            expect(state.players[1].graveyard).toHaveLength(0);
            expect(
                state.players[1].exile.some((c) => c.id === "gy-instant")
            ).toBe(true);
            expect(state.players[1].life).toBe(18);
            expect(state.players[0].life).toBe(20); // controller's own life untouched
        });
    });

    describe("{G},{T}: exile target creature card from a graveyard, you gain 2 life (CR 605.1a / 701.18)", () => {
        it("exiles the card and gains the controller 2 life", () => {
            const { state, deathrite } = setupDeathrite();
            const bear = makeInstance(getCardByName("Grizzly Bears").id, {
                id: "gy-creature",
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            });
            state.players[1].graveyard.push(bear);

            activate(state, deathrite, "deathrite-shaman-lifegain", [
                { type: "graveyard-card", id: "gy-creature", playerId: "p2" },
            ]);

            expect(state.players[1].graveyard).toHaveLength(0);
            expect(
                state.players[1].exile.some((c) => c.id === "gy-creature")
            ).toBe(true);
            expect(state.players[0].life).toBe(22);
            expect(state.players[1].life).toBe(20); // opponent's life untouched
        });
    });

    describe("illegal target at resolution (CR 608.2b) — the ability is countered and does nothing", () => {
        it("no exile, no mana, no life change when the graveyard target has left the graveyard before resolution", () => {
            const { state, deathrite } = setupDeathrite();
            const bear = makeInstance(getCardByName("Grizzly Bears").id, {
                id: "gy-creature",
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            });
            state.players[1].graveyard.push(bear);
            state.stack.push({
                ...deathrite,
                zone: "stack",
                castById: deathrite.controllerId,
                abilityId: "deathrite-shaman-lifegain",
                targets: [
                    {
                        type: "graveyard-card",
                        id: "gy-creature",
                        playerId: "p2",
                    },
                ],
            });

            // The target leaves the graveyard (e.g. exiled by an unrelated
            // effect in response) before the ability resolves — the sole
            // target is now illegal and the ability must fizzle entirely
            // (CR 608.2b: not merely "skip the target").
            state.players[1].graveyard = [];

            resolveTopOfStack(state);

            expect(state.stack).toHaveLength(0); // countered, ceases to exist
            expect(state.players[0].life).toBe(20); // no lifegain
            expect(state.players[1].life).toBe(20); // no life change at all
            expect(state.players[1].exile).toHaveLength(0); // nothing exiled
        });
    });
});

/**
 * `activateAbilityOnState` — the extracted, pure activation path (issue #1491,
 * CR 602).
 *
 * WHY THIS FILE EXISTS. The blade suite's `activate` setup step (ADR 0070 §4)
 * has to reach a position whose pending decision was produced by a REAL
 * activation. The activation path lived inside the `activateAbility` Convex
 * mutation, so it was unreachable without a `ctx` — and the ADR explicitly
 * rejects the alternative (a setup-side approximation), because a copy of
 * engine logic does not diverge loudly, it diverges silently.
 *
 * So the mutation's whole body was lifted into `activateAbilityOnState` and
 * the mutation now calls it, keeping only its I/O (fetch the row, clone the
 * state, persist). Two obligations follow:
 *
 *   1. the extracted function still walks every one of the three exits the
 *      mutation used to persist from — targeted ability (`pendingTarget`),
 *      deferred payment (`pendingActivation`), committed to the stack. That
 *      is what this file asserts;
 *   2. NO SECOND COPY survives on the mutation side — asserted structurally
 *      against the source of `convex/game.ts` in
 *      `scripts/__tests__/activation-no-copy.test.ts` (it reads a file, which
 *      the Convex runtime lint forbids inside `convex/`).
 *
 * The project has no Convex mutation test harness (see
 * `convex/__tests__/debugLoadBladeScenario.test.ts` for the same convention),
 * which is exactly why the extraction is what makes the path testable at all.
 */

import { describe, expect, it } from "vitest";
import { activateAbilityOnState } from "../game";
import { buildStateFromScenario } from "../gre/scenarioBuilder";
import { createInitialGameState, type PlayerInput } from "../gre/setup";
import { getCardByName } from "../cards";
import type { GameState, CardInstanceState } from "../gre/state";
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

describe("activateAbilityOnState — committed path (CR 602.1)", () => {
    it("pays {T} / life / sacrifice and pushes the ability on the stack", () => {
        const state = build({
            cards: [
                { name: "Polluted Delta", owner: "me", zone: "battlefield" },
                { name: "Island", owner: "me", zone: "library" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
        const delta = find(state, "Polluted Delta");

        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: delta.id,
            abilityId: "polluted-delta-fetch",
        });

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe("polluted-delta-fetch");
        // CR 118.4 — the life leg is really paid.
        expect(state.players[0].life).toBe(19);
        // CR 701.16 — and so is the sacrifice.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
        // CR 117.3c — priority passes to the opponent, who may respond.
        expect(state.priorityPlayerId).toBe(state.players[1].id);
    });

    it("rejects an activation the activator has no priority for", () => {
        const state = build({
            cards: [
                { name: "Polluted Delta", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
        const delta = find(state, "Polluted Delta");
        state.priorityPlayerId = state.players[1].id;
        expect(() =>
            activateAbilityOnState(state, {
                playerId: state.players[0].id,
                cardInstanceId: delta.id,
                abilityId: "polluted-delta-fetch",
            })
        ).toThrow();
        expect(state.stack).toHaveLength(0);
    });
});

describe("activateAbilityOnState — the two deferred exits still work", () => {
    it("a TARGETED ability enters pendingTarget (CR 602.2b) instead of the stack", () => {
        const state = build({
            cards: [
                {
                    name: "Prodigal Sorcerer",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
        const tim = find(state, "Prodigal Sorcerer");
        const ability =
            getCardByName("Prodigal Sorcerer").activatedAbilities![0];

        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: tim.id,
            abilityId: ability.id,
        });

        expect(state.pendingTarget?.cardInstanceId).toBe(tim.id);
        expect(state.pendingTarget?.kind).toBe("ability");
        expect(state.stack).toHaveLength(0);
        // Costs are DEFERRED on this path — the source is still untapped.
        expect(tim.isTapped).toBe(false);
    });

    it("an UNCOVERED mana cost enters pendingActivation instead of the stack", () => {
        const state = build({
            cards: [
                {
                    name: "Jayemdae Tome",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
        });
        const tome = find(state, "Jayemdae Tome");
        const ability = getCardByName("Jayemdae Tome").activatedAbilities![0];

        activateAbilityOnState(state, {
            playerId: state.players[0].id,
            cardInstanceId: tome.id,
            abilityId: ability.id,
        });

        expect(state.pendingActivation?.cardInstanceId).toBe(tome.id);
        expect(state.stack).toHaveLength(0);
        expect(tome.isTapped).toBe(false);
    });
});

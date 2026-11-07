// eoe (Edge of Eternities) — multicolor behavior tests (ADR 0043 colour split).
//
// Pinnacle Emissary (issue #8652): the Drone's restriction is a token static
// key, so the proof runs from the token the trigger really created, through a
// cold-registry decode of its content-derived id, to the block check itself
// (CR 509.1b). "Warp {U/R}" is covered in `gre/__tests__/warp.test.ts`.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { validateBlockerEligibility } from "../../../../gre/combat";
import { getDefinition, preloadDefinitions } from "../../../index";
import { pinnacleEmissary } from "../multicolor.cards";
import type { CardType, SpellCastEvent, TokenSpec } from "../../../types";
import { tokenDefinitionId, tryGetDefinition } from "../../..";

preloadDefinitions([pinnacleEmissary()]);

const TRIGGER_ID = "pinnacle-emissary-artifact-cast-drone";

function board() {
    const emissary = makeInstance(pinnacleEmissary().id, {
        id: "emissary",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [emissary] }),
            makePlayer("p2"),
        ],
    });
}

function castEvent(casterId: string, spellTypes: CardType[]): SpellCastEvent {
    return {
        type: "SPELL_CAST",
        casterId,
        spellInstanceId: "cast-spell",
        spellCardId: "cast-spell-card",
        spellTypes,
        spellSubtypes: [],
        spellColors: [],
    };
}

describe("Pinnacle Emissary (CR 603.2, CR 509.1b)", () => {
    const matching = (state: ReturnType<typeof board>, event: SpellCastEvent) =>
        collectTriggers(state, [event]).filter(
            (t) => t.triggeredAbilityId === TRIGGER_ID
        );

    it("triggers on YOUR artifact spell only", () => {
        const state = board();
        expect(matching(state, castEvent("p1", ["Artifact"]))).toHaveLength(1);
        expect(matching(state, castEvent("p1", ["Creature"]))).toHaveLength(0);
        expect(matching(state, castEvent("p2", ["Artifact"]))).toHaveLength(0);
    });

    it("creates a colorless flying 1/1 Drone artifact creature", () => {
        const state = board();
        state.stack.push(...matching(state, castEvent("p1", ["Artifact"])));
        resolveTopOfStack(state);
        const drone = state.players[0].battlefield.find(
            (c) => c.id !== "emissary"
        )!;
        const def = getDefinition((drone.card as { id: string }).id);
        expect(def.name).toBe("Drone");
        expect(def.types).toEqual(["Artifact", "Creature"]);
        expect(def.subtypes).toEqual(["Drone"]);
        expect(def.staticAbilities).toEqual(["flying"]);
        expect([def.power, def.toughness]).toEqual([1, 1]);
    });

    it("the Drone blocks fliers only, also decoded off a cold registry", () => {
        const spec = (
            pinnacleEmissary().triggeredAbilities![0]
                .effects![0] as unknown as {
                token: TokenSpec;
            }
        ).token;
        const id = tokenDefinitionId(spec);
        expect(tryGetDefinition(id)?.staticEffects?.[0]).toMatchObject({
            kind: "block-restriction",
            side: "blocker",
            onlyAgainst: { keyword: "flying" },
        });
        const blocker = makeInstance(id, {
            id: "drone",
            controllerId: "p2",
            ownerId: "p2",
        });
        const attacker = (staticAbilities: string[]) =>
            makeInstance(pinnacleEmissary().id, {
                id: "attacker",
                controllerId: "p1",
                ownerId: "p1",
                staticAbilities,
            });
        expect(
            validateBlockerEligibility(attacker(["flying"]), blocker, [blocker])
                .eligible
        ).toBe(true);
        expect(
            validateBlockerEligibility(attacker([]), blocker, [blocker])
                .eligible
        ).toBe(false);
    });
});

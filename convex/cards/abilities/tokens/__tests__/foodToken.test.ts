// Food token (CR 707.2, issue #778) — "Artifact — Food" with "{2}, {T},
// Sacrifice this token: Gain 3 life." No catalogue producer ships yet (engine
// infra) — proven directly via the `createToken` Op path, mirroring
// `bloodToken.test.ts` / the Treasure e2e activation test.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../types";
import { FOOD_TOKEN_SPEC } from "../foodToken";
import {
    getPlayer,
    resolveTopOfStack,
    normalizeManaCost,
    type PendingActivation,
} from "../../../../gre/state";
import { getDefinition, registerTokenDefinition } from "../../../index";
import {
    buildPendingActivation,
    tryAutoCommitPendingActivation,
} from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { makePlayer, makeState, pushSpell } from "../../../__tests__/setup";

const ABILITY_ID = "sacrifice-gain-life";

function registerFoodSpell(id: string): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Sorcery"],
        effects: [
            {
                op: "createToken",
                token: FOOD_TOKEN_SPEC,
                controller: "controller",
            } as EffectOp,
        ],
    });
    return id;
}

function activateFood(
    state: ReturnType<typeof makeState>,
    playerId: string,
    tokenInstanceId: string
): PendingActivation {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === tokenInstanceId)!;
    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities!.find((a) => a.id === ABILITY_ID)!;
    const manaCost = ability.cost.mana
        ? normalizeManaCost(ability.cost.mana)
        : undefined;
    const pending = buildPendingActivation({
        playerId,
        cardInstanceId: card.id,
        abilityId: ability.id,
        ability,
        manaCost,
    });
    state.pendingActivation = pending;
    tryAutoCommitPendingActivation(state, playerId);
    return pending;
}

describe("Food token (CR 707.2, issue #778)", () => {
    it("createToken produces an Artifact — Food with the sac-gain-life ability", () => {
        const id = registerFoodSpell("test-food-create");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken);
        expect(token).toBeDefined();
        expect(token!.types).toEqual(["Artifact"]);
        expect(token!.subtypes).toContain("Food");
        const def = getDefinition((token!.card as { id: string }).id);
        expect(def.activatedAbilities).toHaveLength(1);
        const ability = def.activatedAbilities![0];
        expect(ability.id).toBe(ABILITY_ID);
        expect(ability.oracleText).toBe(
            "{2}, {T}, Sacrifice this token: Gain 3 life."
        );
        expect(ability.cost).toEqual({
            mana: { generic: 2 },
            tap: true,
            sacrifice: true,
        });
    });

    it("activating the ability pays {2} + tap, sacrifices the token, and gains 3 life", () => {
        const id = registerFoodSpell("test-food-activate");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        expect(state.players[0].life).toBe(20);

        activateFood(state, "p1", token.id);

        // CR 602.1 — mana + tap + sacrifice all resolved at cost payment.
        expect(
            state.players[0].battlefield.some((c) => c.id === token.id)
        ).toBe(false); // sacrificed
        expect(state.stack).toHaveLength(1);

        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23); // CR 119.3a
    });

    it("wire format: the life gain and Food ability survive projectPublicState", () => {
        const id = registerFoodSpell("test-food-wire");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;

        activateFood(state, "p1", token.id);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(23);
        expect(
            projected.players[0].battlefield.some((c) => c.id === token.id)
        ).toBe(false);
    });
});

// Token-carried triggered abilities (CR 707.2, issue #2364) — GRE +
// wire-format coverage for `EffectTokenSpec.triggeredAbilities` through the
// real `createToken` Op path, mirroring the Blood token's own
// `activatedAbilities` e2e test (`bloodToken.test.ts`) one ability-kind
// later. Uses the "Pest template" from the issue's own verification section
// ("When this token dies, you gain 1 life.") as a TEST-LOCAL fixture only —
// Pest Infestation itself ships in a LATER PR (it carries further,
// independent blockers per the issue), so no shared production spec is
// added here.

import { describe, it, expect } from "vitest";
import type { EffectOp, EffectTokenSpec } from "../../../types";
import {
    getPlayer,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import { getDefinition, registerTokenDefinition } from "../../../index";
import { projectPublicState } from "../../../../gameProjections";
import { makePlayer, makeState, pushSpell } from "../../../__tests__/setup";

const PEST_ABILITY_ID = "pest-dies-gain-1-life";

/** Test-local `EffectTokenSpec` — the Pest template ("When this token dies,
 *  you gain 1 life."), issue #2364's own worked example. */
const PEST_TOKEN_SPEC: EffectTokenSpec = {
    name: "Pest",
    types: ["Creature"],
    subtypes: ["Pest"],
    power: 1,
    toughness: 1,
    colors: ["B", "G"],
    triggeredAbilities: [
        {
            id: PEST_ABILITY_ID,
            oracleText: "When this token dies, you gain 1 life.",
            event: "CREATURE_DIED",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        },
    ],
};

function registerPestSpell(id: string): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { B: 1 },
        types: ["Sorcery"],
        effects: [
            {
                op: "createToken",
                token: PEST_TOKEN_SPEC,
                controller: "controller",
            } as EffectOp,
        ],
    });
    return id;
}

describe("Token-carried triggered abilities (CR 707.2, issue #2364)", () => {
    it("createToken produces a Pest carrying its own dies-trigger ability", () => {
        const id = registerPestSpell("test-pest-create");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken);
        expect(token).toBeDefined();
        expect(token!.types).toEqual(["Creature"]);
        expect(token!.subtypes).toContain("Pest");
        const def = getDefinition((token!.card as { id: string }).id);
        expect(def.triggeredAbilities).toHaveLength(1);
        const ability = def.triggeredAbilities![0];
        expect(ability.id).toBe(PEST_ABILITY_ID);
        expect(ability.oracleText).toBe(
            "When this token dies, you gain 1 life."
        );
        expect(ability.event).toBe("CREATURE_DIED");
    });

    it("the token's own trigger fires on its death and gains 1 life (real, working closure — not the cold-decode stub)", () => {
        const id = registerPestSpell("test-pest-dies");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        const lifeBefore = getPlayer(state, "p1").life;

        removePermanentTo(state, token.id, "graveyard", "destroy");
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(PEST_ABILITY_ID);
        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 1);
    });

    it("wire format: the token's triggered ability survives projectPublicState", () => {
        const id = registerPestSpell("test-pest-wire");
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken)!;
        const projected = projectPublicState(state, 1, "p1");
        const slimToken = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        expect(slimToken.subtypes).toContain("Pest");
        // `card.card` strips to `{ id }` on the wire — the ability round-trips
        // through the registry keyed by that id, same as `activatedAbilities`.
        const def = getDefinition((slimToken.card as { id: string }).id);
        expect(def.triggeredAbilities?.[0]?.id).toBe(PEST_ABILITY_ID);
        expect(def.triggeredAbilities?.[0]?.event).toBe("CREATURE_DIED");
    });
});

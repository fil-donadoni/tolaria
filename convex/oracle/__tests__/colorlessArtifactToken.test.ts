// Colorless artifact creature token, full path (CR 105.2c, CR 205.2a, CR 111.1,
// issue #4249): Oracle text → compiler → Effect Script → the GRE resolves it →
// `projectPublicState`, the reducer the client actually reads.
//
// The golden fixtures in `createToken.test.ts` prove what the compiler WRITES;
// this proves the engine and the wire keep it — the token is on the
// battlefield as an artifact creature (both card types survive the projection,
// so the client's type line reads "Artifact Creature — Thopter") and it carries
// no colour, its keyword rides along, and the count is honoured.

import { describe, expect, it } from "vitest";
import { getDefinition, registerTokenDefinition } from "../../cards";
import { makePlayer, makeState, pushSpell } from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { oracleCard } from "./fixtures";

const ORACLE =
    "Create two 1/1 colorless Thopter artifact creature tokens with flying.";

/** Compile the sorcery and register its Effect Script like a real card. */
function registeredSpell(): string {
    const outcome = compileCard(
        oracleCard({
            name: "Test Thopter Sorcery",
            manaCost: "{3}",
            oracleText: ORACLE,
            typeLine: "Sorcery",
            power: undefined,
            toughness: undefined,
        })
    );
    if (outcome.state !== "ready")
        throw new Error(`not ready: ${JSON.stringify(outcome)}`);
    const id = "test-colorless-artifact-token";
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { X: 3 },
        types: ["Sorcery"],
        effects: outcome.definition.effects,
    });
    return id;
}

describe("colorless artifact creature token — full path (CR 105.2c, CR 205.2a)", () => {
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    pushSpell(state, registeredSpell(), "p1", []);
    resolveTopOfStack(state);

    it("the GRE puts two artifact creature tokens on the battlefield", () => {
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(2);
        for (const token of tokens) {
            expect(token.types).toEqual(["Artifact", "Creature"]);
            expect(token.subtypes).toEqual(["Thopter"]);
            expect(token.power).toBe(1);
            expect(token.toughness).toBe(1);
            expect(token.staticAbilities).toContain("flying");
        }
    });

    it("the projection the client reads keeps both types and the keyword", () => {
        const projected = projectPublicState(state, 1, "p1");
        const tokens = projected.players[0]!.battlefield.filter(
            (c) => c.isToken
        );
        expect(tokens).toHaveLength(2);
        for (const token of tokens) {
            expect(token.types).toEqual(["Artifact", "Creature"]);
            expect(token.subtypes).toEqual(["Thopter"]);
            expect(token.staticAbilities).toContain("flying");
            // CR 105.2c — the wire carries the token's identity as its
            // content-derived id, and the definition the client decodes from
            // it is an artifact creature with NO colour (an empty mana cost).
            const definition = getDefinition(token.card.id);
            expect(definition?.types).toEqual(["Artifact", "Creature"]);
            expect(definition?.manaCost).toEqual({});
        }
    });
});

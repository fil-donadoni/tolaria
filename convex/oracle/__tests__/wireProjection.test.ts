// Wire-projection round trip for compiled definitions.
//
// `gates.ts` proves offline that a compiled definition is pure JSON — necessary,
// but it does not prove the fields SURVIVE the projection the client actually
// receives, and `.claude/rules/gre-development.md` is explicit that a SURFACE
// assertion has to traverse the real reducer. `projectPublicState` needs a
// `GameState` holding a real `CardInstanceState`, which needs the registry —
// hence this test rather than a check inside the gate (compiled rows do not
// reach the registry until #2702).
//
// The instance below is built FROM THE COMPILED DEFINITION, not from the
// registered one, so what is projected is genuinely the compiler's output.

import { describe, expect, it } from "vitest";
import { getAllCards } from "../../cards/catalogue";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { compileCard } from "../compile";
import { goldOracleCard } from "../gold";
import type { CompiledDefinition } from "../types";

interface Compiled {
    readonly name: string;
    readonly cardId: string;
    readonly definition: CompiledDefinition;
}

const COMPILED: Compiled[] = getAllCards()
    .filter((definition) => definition.oracleText !== undefined)
    .flatMap((definition) => {
        const outcome = compileCard(goldOracleCard(definition));
        return outcome.state === "ready"
            ? [
                  {
                      name: definition.name,
                      cardId: definition.id,
                      definition: outcome.definition,
                  },
              ]
            : [];
    });

describe("compiled definitions survive projectPublicState", () => {
    it("there is something to project (the sweep cannot pass vacuously)", () => {
        expect(COMPILED.length).toBeGreaterThan(50);
    });

    it("every compiled permanent keeps its types, P/T and keywords on the wire", () => {
        const drift: string[] = [];
        for (const { name, cardId, definition } of COMPILED) {
            if (
                !definition.types.some(
                    (t) => t === "Creature" || t === "Artifact" || t === "Land"
                )
            ) {
                continue;
            }
            const instance = makeInstance(cardId, {
                controllerId: "p1",
                zone: "battlefield",
                // Straight from the COMPILED definition — that is the point.
                types: [...definition.types],
                subtypes: [...(definition.subtypes ?? [])],
                power: definition.power,
                toughness: definition.toughness,
                staticAbilities: [...(definition.staticAbilities ?? [])],
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [instance] }),
                    makePlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const seen = projected.players[0]?.battlefield.find(
                (c) => c.id === instance.id
            );
            if (seen === undefined) {
                drift.push(`${name}: not present after projection`);
                continue;
            }
            if (
                JSON.stringify(seen.types) !== JSON.stringify(definition.types)
            ) {
                drift.push(`${name}: types ${JSON.stringify(seen.types)}`);
            }
            if (
                JSON.stringify(seen.staticAbilities) !==
                JSON.stringify(definition.staticAbilities ?? [])
            ) {
                drift.push(
                    `${name}: staticAbilities ${JSON.stringify(seen.staticAbilities)}`
                );
            }
            if (
                seen.power !== definition.power ||
                seen.toughness !== definition.toughness
            ) {
                drift.push(`${name}: P/T ${seen.power}/${seen.toughness}`);
            }
        }
        expect(drift).toEqual([]);
    });

    it("a compiled keyword reaches the wire on a concrete card", () => {
        const sprites = COMPILED.find((c) => c.name === "Scryb Sprites");
        expect(sprites).toBeDefined();
        const instance = makeInstance(sprites!.cardId, {
            controllerId: "p1",
            zone: "battlefield",
            staticAbilities: [...(sprites!.definition.staticAbilities ?? [])],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [instance] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p2");
        const seen = projected.players[0]?.battlefield.find(
            (c) => c.id === instance.id
        );
        expect(seen?.staticAbilities).toEqual(["flying"]);
    });
});

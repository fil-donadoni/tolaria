// "Prevent all damage that would be dealt to you." — the static clause frame
// (CR 615): Solitary Confinement, Glacial Chasm.
//
//  1. GOLDEN — a real Oracle row (Solitary Confinement) compiled whole.
//  2. REFUSALS — neighbours stay unparsed.
//  3. EXPANSION — `expandDefinition` rebuilds the flag into one prevention
//     entry and removes it.
//  4. BEHAVIOUR — through the real `runDamageReplacement` funnel: damage to
//     the controller is prevented, damage to the opponent is not.

import { describe, expect, it } from "vitest";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { runDamageReplacement } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const CLAUSE = "Prevent all damage that would be dealt to you.";

const SOLITARY_CONFINEMENT = oracleCard({
    name: "Solitary Confinement",
    manaCost: "{2}{W}",
    typeLine: "Enchantment",
    oracleText: `Skip your draw step.\nYou have shroud. (You can't be the target of spells or abilities.)\n${CLAUSE}`,
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

describe("controller damage prevention — golden (CR 615)", () => {
    it("Solitary Confinement: the flag beside the draw skip and shroud", () => {
        const def = compiled(SOLITARY_CONFINEMENT);
        expect(def.preventsDamageToController).toBe(true);
        expect(sortKeys(def)).toEqual(
            sortKeys({
                name: "Solitary Confinement",
                types: ["Enchantment"],
                manaCost: { X: 2, W: 1 },
                oracleText: SOLITARY_CONFINEMENT.oracleText,
                drawStepReplacement: true,
                staticEffects: def.staticEffects,
                preventsDamageToController: true,
            })
        );
    });
});

describe("controller damage prevention — refusals (fail-closed neighbours)", () => {
    const refused: readonly [string, string][] = [
        [
            "a duration",
            "Prevent all damage that would be dealt to you this turn.",
        ],
        [
            "a source filter",
            "Prevent all damage that would be dealt to you by sources you don't control.",
        ],
        [
            "extra recipients",
            "Prevent all damage that would be dealt to you and permanents you control.",
        ],
        [
            "partial prevention",
            "Prevent 1 of the damage that would be dealt to you.",
        ],
    ];

    it("control: the accepted sentence compiles ready", () => {
        expect(
            compileCard(oracleCard({ name: "Test Card", oracleText: CLAUSE }))
                .state
        ).toBe("ready");
    });

    for (const [why, text] of refused)
        it(`refuses ${why}`, () => {
            const outcome = compileCard(
                oracleCard({ name: "Test Card", oracleText: text })
            );
            expect(outcome.state).toBe("unparsed");
        });
});

describe("controller damage prevention — expansion", () => {
    it("rebuilds the flag into one prevention entry and removes it", () => {
        const expanded = expandDefinition({
            ...compiled(SOLITARY_CONFINEMENT),
            id: "test-solitary-confinement",
            rarity: "rare",
        });
        expect(expanded.preventsDamageToController).toBeUndefined();
        expect(
            expanded.replacementEffects!.map((r) => [r.id, r.damageEffectKind])
        ).toEqual([["solitary-confinement-damage-prevention", "prevention"]]);
    });
});

describe("controller damage prevention — behaviour (CR 615)", () => {
    function hit(targetId: string): number {
        const def: CardDefinition = {
            ...compiled(SOLITARY_CONFINEMENT),
            id: "test-solitary-confinement-behaviour",
            rarity: "rare",
        };
        return withTemporaryDefinition(def, () => {
            const source = makeInstance(def.id, {
                id: "wall",
                controllerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [source] }),
                    makePlayer("p2"),
                ],
            });
            const out = runDamageReplacement(
                state,
                "bolt",
                "p2",
                { type: "player", id: targetId },
                3,
                false,
                false
            );
            return out?.amount ?? 0;
        });
    }

    it("prevents damage to the controller", () => {
        expect(hit("p1")).toBe(0);
    });

    it("leaves damage to the opponent alone", () => {
        expect(hit("p2")).toBe(3);
    });
});

// "if this permanent is an enchantment" — the intervening-if of the Opal and
// Hidden cycles (CR 603.4).
//
//  1. GRAMMAR — `conditionRule` reads the source named by its current type.
//  2. CONSUMPTION — a real corpus line gets past the condition and its effect
//     clause ("becomes a N/N … creature", `becomeCreature.test.ts`).
//  3. REFUSALS — neighbours the rule must NOT read.
//  4. ENGINE — the compiled gate opens on an enchantment and shuts on a
//     permanent that already became a creature.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    CompiledTriggeredAbility,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../compile";
import { conditionRule } from "../grammar/shared/condition";
import { oracleCard, parseContext } from "./oracle.fixture";

const read = (span: string) => conditionRule.run(span, parseContext());

describe("self-has-type condition (CR 603.4)", () => {
    it("reads 'if this permanent is an enchantment' as the source's current type", () => {
        const parsed = read("if this permanent is an enchantment");
        expect(parsed.ok && parsed.value).toEqual({
            kind: "self-has-type",
            type: "Enchantment",
        });
    });

    it("Hidden Gibbons: the line compiles through the effect clause", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Hidden Gibbons",
                manaCost: "{1}{G}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "When an opponent casts an instant spell, if this permanent is an enchantment, it becomes a 4/4 Ape creature.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).not.toBe("unparsed");
    });

    it("refuses the neighbours: another type, another noun, a negation", () => {
        for (const span of [
            "if this permanent is a creature",
            "if this permanent is an artifact",
            "if that permanent is an enchantment",
            "if this permanent is not an enchantment",
            "if this permanent is an enchantment creature",
        ])
            expect(read(span).ok, span).toBe(false);
    });
});

describe("the compiled gate reads the live card types (CR 603.4)", () => {
    const descriptor: CompiledTriggeredAbility = {
        id: "probe-self-has-type",
        oracleText: "probe",
        head: { kind: "spell-cast", scope: "opponent" },
        condition: { kind: "self-has-type", type: "Enchantment" },
        effects: [],
    } as never;

    function gateOn(types: PermanentView["types"]): boolean {
        const source = makeInstance(getCardByName("Pacifism")!.id, {
            id: "src",
        });
        const live = { ...source, types } as unknown as PermanentView;
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        const ability = resolveCompiledTrigger(descriptor);
        return ability.interveningIf!(
            { type: "SPELL_CAST" } as never,
            live,
            state as unknown as TriggerStateView
        );
    }

    it("opens on an enchantment, shuts once it is a creature", () => {
        expect(gateOn(["Enchantment"])).toBe(true);
        expect(gateOn(["Creature"])).toBe(false);
    });
});

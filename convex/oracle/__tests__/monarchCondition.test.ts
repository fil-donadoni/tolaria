// "if you're the monarch" — the intervening-if of the monarch cycle (CR 725.1,
// CR 603.4; issue #7218).
//
//  1. GRAMMAR — `conditionRule` reads the designation held by "you".
//  2. GOLDEN — Throne Warden compiled whole.
//  3. REFUSALS — neighbours the rule must NOT read.
//  4. ENGINE — the compiled gate opens only while the ability's controller is
//     the monarch, reading the live `GameState.monarchId`, and is re-checked
//     as the ability resolves.

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
import type { OracleCard } from "../types";
import { parseContext } from "./oracle.fixture";

const read = (span: string) => conditionRule.run(span, parseContext());

const THRONE_WARDEN: OracleCard = {
    oracleId: "b50c1dd3-0495-427f-b5a9-9ac44a4554d1",
    name: "Throne Warden",
    manaCost: "{1}{W}",
    typeLine: "Creature — Human Soldier",
    oracleText:
        "At the beginning of your end step, if you're the monarch, put a +1/+1 counter on this creature.",
    power: "2",
    toughness: "2",
    layout: "normal",
};

describe("you-are-monarch condition (CR 725.1, CR 603.4)", () => {
    it("reads 'if you're the monarch' as the controller's designation", () => {
        const parsed = read("if you're the monarch");
        expect(parsed.ok && parsed.value).toEqual({ kind: "you-are-monarch" });
    });

    it("refuses the neighbours: a negation, another player, a tense", () => {
        for (const span of [
            "if you're not the monarch",
            "if you aren't the monarch",
            "if an opponent is the monarch",
            "if you were the monarch",
            "if you're the monarch and you control a creature",
        ])
            expect(read(span).ok, span).toBe(false);
    });
});

describe("golden fixture (CR 725.1, CR 603.4)", () => {
    it("Throne Warden — an end-step counter gated on the monarch", () => {
        const outcome = compileCard(THRONE_WARDEN);
        expect(outcome.state).toBe("ready");
        expect(outcome.state !== "unparsed" && outcome.definition).toEqual({
            name: "Throne Warden",
            types: ["Creature"],
            subtypes: ["Human", "Soldier"],
            manaCost: { X: 1, W: 1 },
            power: 2,
            toughness: 2,
            oracleText: THRONE_WARDEN.oracleText,
            compiledTriggeredAbilities: [
                {
                    id: "throne-warden-trigger",
                    oracleText: THRONE_WARDEN.oracleText,
                    head: { kind: "phase", phase: "END_STEP", scope: "your" },
                    condition: { kind: "you-are-monarch" },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        });
    });
});

describe("the compiled gate reads the monarch designation (CR 725.1)", () => {
    const descriptor: CompiledTriggeredAbility = {
        id: "probe-you-are-monarch",
        oracleText: "probe",
        head: { kind: "phase", phase: "END_STEP", scope: "your" },
        condition: { kind: "you-are-monarch" },
        effects: [],
    } as never;

    function gateWith(monarchId: string | undefined): boolean {
        const source = makeInstance(getCardByName("Pacifism")!.id, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        if (monarchId !== undefined) state.monarchId = monarchId;
        const ability = resolveCompiledTrigger(descriptor);
        return ability.interveningIf!(
            { type: "PHASE_BEGIN" } as never,
            source as unknown as PermanentView,
            state as unknown as TriggerStateView
        );
    }

    it("opens for the controller, shuts for an opponent or no monarch", () => {
        expect(gateWith("p1")).toBe(true);
        expect(gateWith("p2")).toBe(false);
        // CR 725.1 — no monarch until an effect makes one.
        expect(gateWith(undefined)).toBe(false);
    });
});

// "if it's on the battlefield" — the intervening-if of the Animate Dead cycle
// (CR 603.4).
//
//  1. GRAMMAR — `conditionRule` reads the source named by its zone.
//  2. REFUSALS — neighbours the rule must NOT read.
//  3. ENGINE — the compiled gate opens while the source is on the battlefield
//     and shuts once it left (checked again as the ability resolves).

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
import { conditionRule } from "../grammar/shared/condition";
import { parseContext } from "./oracle.fixture";

const read = (span: string) => conditionRule.run(span, parseContext());

describe("self-on-battlefield condition (CR 603.4)", () => {
    it("reads 'if it's on the battlefield' as the source's zone", () => {
        const parsed = read("if it's on the battlefield");
        expect(parsed.ok && parsed.value).toEqual({
            kind: "self-on-battlefield",
        });
    });

    it("refuses the neighbours: another subject, a negation, another zone", () => {
        for (const span of [
            "if it's not on the battlefield",
            "if that creature's on the battlefield",
            "if it's in your graveyard",
            "if it's on the battlefield tapped",
        ])
            expect(read(span).ok, span).toBe(false);
    });
});

describe("the compiled gate reads the source's zone (CR 603.4)", () => {
    const descriptor: CompiledTriggeredAbility = {
        id: "probe-self-on-battlefield",
        oracleText: "probe",
        head: { kind: "entered", scope: "self" },
        condition: { kind: "self-on-battlefield" },
        effects: [],
    } as never;

    function gateWith(onBattlefield: boolean): boolean {
        const source = makeInstance(getCardByName("Pacifism")!.id, {
            id: "src",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: onBattlefield ? [source] : [],
                }),
                makePlayer("p2"),
            ],
        });
        const ability = resolveCompiledTrigger(descriptor);
        return ability.interveningIf!(
            { type: "PERMANENT_ENTERED" } as never,
            source as unknown as PermanentView,
            state as unknown as TriggerStateView
        );
    }

    it("opens while the source is on the battlefield, shuts once it left", () => {
        expect(gateWith(true)).toBe(true);
        expect(gateWith(false)).toBe(false);
    });
});

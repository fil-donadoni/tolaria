// "Max speed —" heading a triggered ability or a static ability (CR 702.178a): a
// keyword, where every other word in that position is an ability word with no
// rules meaning.
//
//  1. GRAMMAR — the head survives as the ability's gate.
//  2. REFUSALS — the shapes the one gate slot cannot hold.
//  3. ENGINE — the gate reads the controller's speed when the ability would
//     trigger, and an ability already on the stack is not re-read. The static
//     gate's engine read is `convex/gre/__tests__/speed.test.ts`.

import { describe, expect, it } from "vitest";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    CompiledTriggeredAbility,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";

function creature(oracleText: string): OracleCard {
    return {
        oracleId: "527cc22f-b471-4a84-93a8-be56193a9723",
        name: "Risen Necroregent",
        manaCost: "{4}{B}",
        typeLine: "Creature — Zombie Cat Knight",
        oracleText,
        power: "5",
        toughness: "4",
        layout: "normal",
    };
}

const REMINDER =
    "Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)";

function compiledTrigger(text: string) {
    const outcome = compileCard(creature(`${REMINDER}\n${text}`));
    return outcome.state === "ready"
        ? outcome.definition.compiledTriggeredAbilities?.[0]
        : undefined;
}

describe('"Max speed —" compiles to a gate (CR 702.178a)', () => {
    it("keeps the head as the trigger's condition", () => {
        expect(
            compiledTrigger(
                "Max speed — At the beginning of your end step, create a 2/2 black Zombie creature token."
            )?.condition
        ).toEqual({ kind: "you-have-max-speed" });
    });

    it("leaves an ability word heading the same trigger ungated", () => {
        expect(
            compiledTrigger(
                "Flavor Word — At the beginning of your end step, create a 2/2 black Zombie creature token."
            )?.condition
        ).toBeUndefined();
    });

    it("refuses a printed intervening-if behind the head", () => {
        const outcome = compileCard(
            creature(
                `${REMINDER}\nMax speed — At the beginning of your end step, if you're the monarch, create a 2/2 black Zombie creature token.`
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("the compiled gate reads the controller's speed (CR 702.179e)", () => {
    const descriptor = {
        id: "probe-max-speed",
        oracleText: "probe",
        head: { kind: "phase", phase: "END_STEP", scope: "your" },
        condition: { kind: "you-have-max-speed" },
        effects: [],
    } as unknown as CompiledTriggeredAbility;
    const source = {
        id: "src",
        controllerId: "p1",
    } as unknown as PermanentView;
    const endStep = {
        type: "PHASE_BEGIN",
        phase: "END_STEP",
        activePlayerId: "p1",
    } as never;

    function gateWith(p1Speed: number | undefined, p2Speed?: number): boolean {
        const state = makeState({
            players: [
                makePlayer(
                    "p1",
                    p1Speed === undefined ? {} : { speed: p1Speed }
                ),
                makePlayer(
                    "p2",
                    p2Speed === undefined ? {} : { speed: p2Speed }
                ),
            ],
        });
        return resolveCompiledTrigger(descriptor).matches!(
            endStep,
            source,
            state as unknown as TriggerStateView
        );
    }

    it("opens only at the controller's own max speed", () => {
        expect(gateWith(4)).toBe(true);
        expect(gateWith(3)).toBe(false);
        expect(gateWith(undefined)).toBe(false);
        expect(gateWith(1, 4)).toBe(false);
    });

    it("fails closed with no state view", () => {
        expect(
            resolveCompiledTrigger(descriptor).matches!(
                endStep,
                source,
                undefined
            )
        ).toBe(false);
    });

    // CR 702.178a — the object has the ability or it does not; once triggered,
    // the ability exists on the stack on its own.
    it("is not an intervening-if", () => {
        expect(
            resolveCompiledTrigger(descriptor).interveningIf
        ).toBeUndefined();
    });
});

describe('"Max speed —" heading a static ability (CR 702.178a)', () => {
    const MAX_SPEED = { kind: "you-have-max-speed" } as const;

    function oracle(
        name: string,
        oracleId: string,
        manaCost: string,
        typeLine: string,
        lines: readonly string[],
        pt: readonly [string, string]
    ): OracleCard {
        return {
            oracleId,
            name,
            manaCost,
            typeLine,
            oracleText: lines.join("\n"),
            power: pt[0],
            toughness: pt[1],
            layout: "normal",
        };
    }

    function compiled(card: OracleCard) {
        const outcome = compileCard(card);
        if (outcome.state !== "ready")
            throw new Error(`${card.name} is ${outcome.state}`);
        return outcome.definition;
    }

    it("Walking Sarcophagus: the buff alone", () => {
        const card = oracle(
            "Walking Sarcophagus",
            "791b8ac8-8db8-44b4-8c85-fcc9017c17ef",
            "{2}",
            "Artifact Creature — Zombie Cat",
            [REMINDER, "Max speed — This creature gets +1/+2."],
            ["2", "1"]
        );
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Walking Sarcophagus",
                types: ["Artifact", "Creature"],
                subtypes: ["Zombie", "Cat"],
                manaCost: { X: 2 },
                power: 2,
                toughness: 1,
                oracleText: card.oracleText,
                staticAbilities: ["start your engines!"],
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        appliesTo: "self",
                        power: 1,
                        toughness: 2,
                        condition: MAX_SPEED,
                    },
                ],
            })
        );
    });

    it("Streaking Oilgorger: a keyword alone", () => {
        const card = oracle(
            "Streaking Oilgorger",
            "c163a95e-9414-4b8c-b5a2-1e7674530404",
            "{4}{B}",
            "Creature — Vampire",
            [
                "Flying, haste",
                REMINDER,
                "Max speed — This creature has lifelink.",
            ],
            ["3", "3"]
        );
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Streaking Oilgorger",
                types: ["Creature"],
                subtypes: ["Vampire"],
                manaCost: { X: 4, B: 1 },
                power: 3,
                toughness: 3,
                oracleText: card.oracleText,
                staticAbilities: ["flying", "haste", "start your engines!"],
                compiledStaticEffects: [
                    {
                        kind: "keyword-grant",
                        appliesTo: "self",
                        keyword: "lifelink",
                        condition: MAX_SPEED,
                    },
                ],
            })
        );
    });

    it("Swiftwing Assailant: the buff and a keyword, each gated", () => {
        const card = oracle(
            "Swiftwing Assailant",
            "46b36d25-25bd-48c5-9a53-75230bb27dee",
            "{3}{W}",
            "Creature — Bird Warrior",
            [
                "Flying",
                REMINDER,
                "Max speed — This creature gets +0/+1 and has vigilance.",
            ],
            ["3", "3"]
        );
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Swiftwing Assailant",
                types: ["Creature"],
                subtypes: ["Bird", "Warrior"],
                manaCost: { X: 3, W: 1 },
                power: 3,
                toughness: 3,
                oracleText: card.oracleText,
                staticAbilities: ["flying", "start your engines!"],
                compiledStaticEffects: [
                    {
                        kind: "pt-buff",
                        appliesTo: "self",
                        power: 0,
                        toughness: 1,
                        condition: MAX_SPEED,
                    },
                    {
                        kind: "keyword-grant",
                        appliesTo: "self",
                        keyword: "vigilance",
                        condition: MAX_SPEED,
                    },
                ],
            })
        );
    });

    it.each([
        [
            "a grant that also names other creatures",
            "Max speed — This creature has deathtouch and other creatures you control have first strike.",
        ],
        [
            "a static that is not the permanent's own buff or keyword",
            "Max speed — Spells you cast cost {1} less to cast.",
        ],
    ])("refuses %s", (_form, line) => {
        expect(compileCard(creature(`${REMINDER}\n${line}`)).state).toBe(
            "unparsed"
        );
    });
});

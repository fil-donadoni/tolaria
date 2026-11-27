// "Tap [up to one] target <permanent> and put <N> stun counter(s) on it"
// (CR 701.26a tap, CR 122.1d stun counter, CR 608.2c "it" names the tapped
// target): one sentence, two instructions on ONE announced object. Goldens
// over real corpus cards, refusals of the neighbours the rule must not read,
// and the compiled definition run through the real interpreter.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const STUN_REMINDER =
    "(If a permanent with a stun counter would become untapped, remove one from it instead.)";

const FROSTFIST_STRIDER = oracleCard({
    oracleId: "4e4a21a8-9332-4aeb-8519-949feb211294",
    name: "Frostfist Strider",
    manaCost: "{3}{U}{U}",
    typeLine: "Creature — Elemental Giant",
    oracleText: `Ward {2} (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)\nWhen this creature enters, tap target creature an opponent controls and put a stun counter on it. ${STUN_REMINDER}`,
    power: "4",
    toughness: "4",
});

const UTROM_SCIENTISTS = oracleCard({
    oracleId: "89793c8c-98a3-4621-ad3d-cfc5949c65da",
    name: "Utrom Scientists",
    manaCost: "{2}{U}",
    typeLine: "Artifact Creature — Utrom Robot Scientist",
    oracleText: `When this creature enters, tap up to one target creature and put a stun counter on it. ${STUN_REMINDER}`,
    power: "2",
    toughness: "2",
});

const TRANQUILIZE = oracleCard({
    oracleId: "1133633a-b717-42cb-b477-4e18584d876f",
    name: "Tranquilize",
    manaCost: "{1}{U}",
    typeLine: "Sorcery",
    oracleText: `Tap target creature an opponent controls and put three stun counters on it. ${STUN_REMINDER}`,
    power: undefined,
    toughness: undefined,
});

function definitionOf(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const TAP_THEN_STUN = (count: number) => [
    { op: "tapUntap", action: "tap", target: { target: 0 } },
    {
        op: "counters",
        action: "add",
        counter: "stun",
        target: { target: 0 },
        count,
    },
];

describe("tap and stun clause (CR 701.26a, CR 122.1d, CR 608.2c)", () => {
    it("golden — Frostfist Strider: an entry trigger on one opponent's creature", () => {
        expect(sortKeys(definitionOf(FROSTFIST_STRIDER))).toEqual(
            sortKeys({
                name: "Frostfist Strider",
                manaCost: { X: 3, U: 2 },
                oracleText: FROSTFIST_STRIDER.oracleText,
                types: ["Creature"],
                subtypes: ["Elemental", "Giant"],
                power: 4,
                toughness: 4,
                staticAbilities: ["ward {2}"],
                compiledTriggeredAbilities: [
                    {
                        id: "frostfist-strider-trigger",
                        oracleText:
                            "When this creature enters, tap target creature an opponent controls and put a stun counter on it.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            controller: "opponent",
                        },
                        effects: TAP_THEN_STUN(1),
                    },
                ],
            })
        );
    });

    it('golden — Utrom Scientists: "up to one target", the pronoun names the chosen object or nothing', () => {
        const definition = definitionOf(UTROM_SCIENTISTS);
        expect(sortKeys(definition.compiledTriggeredAbilities)).toEqual(
            sortKeys([
                {
                    id: "utrom-scientists-trigger",
                    oracleText:
                        "When this creature enters, tap up to one target creature and put a stun counter on it.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: "Creature",
                        count: { min: 0, max: 1 },
                    },
                    effects: TAP_THEN_STUN(1),
                },
            ])
        );
    });

    it("golden — Tranquilize: the spell form, three stun counters", () => {
        expect(sortKeys(definitionOf(TRANQUILIZE))).toEqual(
            sortKeys({
                name: "Tranquilize",
                manaCost: { X: 1, U: 1 },
                oracleText: TRANQUILIZE.oracleText,
                types: ["Sorcery"],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    controller: "opponent",
                },
                effects: TAP_THEN_STUN(3),
            })
        );
    });

    it.each([
        [
            "a counter other than stun",
            "Tap target creature an opponent controls and put a +1/+1 counter on it.",
        ],
        [
            "two announced targets for one pronoun",
            "Tap up to two target creatures and put a stun counter on it.",
        ],
        [
            // A real corpus line: the earlier sentence announced a target, so
            // "it" no longer has one antecedent to name.
            "a target announced before the pair",
            "Put two +1/+1 counters on up to one target creature you control. Tap up to one target creature an opponent controls and put a stun counter on it.",
        ],
        [
            "an untap instead of a tap",
            "Untap target creature and put a stun counter on it.",
        ],
    ])("refuses %s", (_what, text) => {
        expect(
            compileCard(
                oracleCard({
                    name: "Probe",
                    manaCost: "{1}{U}",
                    typeLine: "Sorcery",
                    oracleText: text,
                    power: undefined,
                    toughness: undefined,
                })
            ).state
        ).toBe("unparsed");
    });

    // CR 608.2c — split into its own sentence, "it" still names the ONE
    // target the sentence before announced (`announcedPronounSite`, issue
    // #10351): the same two Ops on the same slot, no conjunction needed.
    it("reads the pronoun split into its own sentence as the announced target", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe",
                manaCost: "{1}{U}",
                typeLine: "Sorcery",
                oracleText:
                    "Tap target creature an opponent controls. Put a stun counter on it.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.effects).toEqual([
            { op: "tapUntap", action: "tap", target: { target: 0 } },
            {
                op: "counters",
                action: "add",
                counter: "stun",
                count: 1,
                target: { target: 0 },
            },
        ]);
    });

    it("runs through the interpreter: taps the target and stuns it, and the client sees both", () => {
        const id = "test-tap-and-stun";
        const definition = {
            ...definitionOf(TRANQUILIZE),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        withTemporaryDefinition(definition, () => {
            const bears = getCardByName("Grizzly Bears").id;
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", {
                        battlefield: [
                            makeInstance(bears, {
                                id: "bear",
                                controllerId: "p2",
                                ownerId: "p2",
                            }),
                        ],
                    }),
                ],
            });
            pushSpell(state, id, "p1", [{ type: "permanent", id: "bear" }]);
            resolveTopOfStack(state);
            const bear = state.players[1]!.battlefield[0]!;
            expect(bear.isTapped).toBe(true);
            expect(bear.counters?.stun).toBe(3);
            const projected = projectPublicState(state, 1, "p1");
            const seen = projected.players
                .find((p) => p.id === "p2")!
                .battlefield.find((c) => c.id === "bear")!;
            expect(seen.isTapped).toBe(true);
            expect(seen.counters?.stun).toBe(3);
        });
    });
});

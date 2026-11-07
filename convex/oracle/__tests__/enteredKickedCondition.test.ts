// "When this creature enters, if it was kicked" with no kicker named (CR
// 702.33d, CR 702.33e, CR 603.4): on a card printing one single kicker, paying
// that cost is all "kicked" can mean, so the gate reads that kicker's own
// payment record, the shape every hand-written card of the form declares.
//
// Three layers: a GOLDEN (a real corpus row compiled whole), REFUSALS (the
// neighbours with a kicked state the lone record cannot answer stay `unparsed`,
// ADR 0105 § 2) and the rebuilt GATE, which is what the engine actually reads.

import { describe, expect, it } from "vitest";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    CompiledTriggeredAbility,
    PermanentView,
} from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const VERDURAN_EMISSARY: OracleCard = {
    name: "Verduran Emissary",
    manaCost: "{2}{G}",
    typeLine: "Creature — Human Wizard",
    oracleText:
        "Kicker {1}{R} (You may pay an additional {1}{R} as you cast this spell.)\nWhen this creature enters, if it was kicked, destroy target artifact. It can't be regenerated.",
    power: "2",
    toughness: "3",
    oracleId: "915bd598-c3dd-4982-bdcc-5904a6f17436",
    layout: "normal",
};

const VERDURAN_EXPECTED: CompiledDefinition = {
    name: "Verduran Emissary",
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    manaCost: { X: 2, G: 1 },
    power: 2,
    toughness: 3,
    oracleText: VERDURAN_EMISSARY.oracleText,
    compiledTriggeredAbilities: [
        {
            id: "verduran-emissary-trigger",
            oracleText:
                "When this creature enters, if it was kicked, destroy target artifact. It can't be regenerated.",
            head: { kind: "entered", scope: "self" },
            condition: { kind: "kicker-paid", kickerId: "kicker" },
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { additionalCostPaid: "kicker" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "destroy",
                            target: { target: 0 },
                            cantBeRegenerated: true,
                        },
                    ],
                },
            ],
        },
    ],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {1}{R}",
            mana: { X: 1, R: 1 },
        },
    ],
};

function probe(kickerLine: string): ReturnType<typeof compileCard> {
    return compileCard(
        oracleCard({
            name: "Probe Emissary",
            manaCost: "{2}{G}",
            typeLine: "Creature — Human Wizard",
            oracleText: `${kickerLine}\nWhen this creature enters, if it was kicked, destroy target artifact.`,
            power: "2",
            toughness: "3",
        })
    );
}

describe('"enters, if it was kicked" — golden (CR 702.33d, CR 702.33e, CR 603.4)', () => {
    it("Verduran Emissary compiles whole, gated on its lone kicker", () => {
        const outcome = compileCard(VERDURAN_EMISSARY);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(VERDURAN_EXPECTED)
        );
    });
});

describe('"enters, if it was kicked" — the fixture rows clear their forms (ADR 0105 § 7.1)', () => {
    it.each([
        "Krosan Druid",
        "Excavation Elephant",
        "Scorch Rider",
        "Bog Badger",
        "Blood-Sport Champion",
    ])("%s reaches ready", (name) => {
        const row = GOLDEN_FIXTURES.find((f) => f.card.name === name);
        expect(row?.rule).toBe("kicked trigger condition");
        expect(compileCard(row!.card).state).toBe("ready");
    });
});

describe('"enters, if it was kicked" — refusals (fail-closed)', () => {
    const LONE_KICKER_ONLY = "gates a permanent only behind one single kicker";

    function refusal(kickerLine: string): string {
        const outcome = probe(kickerLine);
        expect(outcome.state).toBe("unparsed");
        return outcome.state === "unparsed"
            ? outcome.gaps.map((g) => g.reason).join("; ")
            : "";
    }

    it("reads the probe on a lone kicker, so each refusal below is the neighbour's", () => {
        expect(probe("Kicker {1}{R}").state).not.toBe("unparsed");
    });

    it("refuses two kicker costs: no one record answers (CR 702.33d)", () => {
        expect(refusal("Kicker {R} and/or {W}")).toContain(LONE_KICKER_ONLY);
    });

    it("refuses Multikicker, which no card prints with this gate (CR 702.33c)", () => {
        expect(refusal("Multikicker {1}{G}")).toContain(LONE_KICKER_ONLY);
    });

    it("refuses a lone collect evidence cost: only a kicker makes a spell kicked (CR 702.33d)", () => {
        expect(
            refusal(
                "As an additional cost to cast this spell, you may collect evidence 6."
            )
        ).toContain(LONE_KICKER_ONLY);
    });
});

describe('"enters, if it was kicked" — the rebuilt gate (CR 603.4)', () => {
    const [descriptor] = VERDURAN_EXPECTED.compiledTriggeredAbilities!;
    const { gate } = resolveCompiledTrigger(
        descriptor as CompiledTriggeredAbility
    );

    it("is decided from the permanent's own payment record", () => {
        expect(gate && "onSelf" in gate).toBe(true);
        if (!gate || !("onSelf" in gate)) return;
        expect(
            gate.onSelf({
                kickerPayments: { kicker: 1 },
            } as unknown as PermanentView)
        ).toBe(true);
        expect(gate.onSelf({} as unknown as PermanentView)).toBe(false);
    });
});

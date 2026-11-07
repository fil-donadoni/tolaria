// CR 701.59 — the grammar of collect evidence's two compiled surfaces (issue
// #7723): the activation cost and the optional additional cost with its linked
// "if evidence was collected" sentence. Goldens are real corpus cards; every
// neighbour the rules must not read is pinned as a refusal.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function compile(
    oracleText: string,
    typeLine = "Creature — Merfolk Detective"
) {
    return compileCard(
        oracleCard({ name: "Probe", manaCost: "{2}{U}", oracleText, typeLine })
    );
}

function definition(oracleText: string, typeLine?: string) {
    const out = compile(oracleText, typeLine);
    if (out.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(out)}`);
    return out.definition;
}

describe("Collect evidence N as an activation cost (CR 701.59a)", () => {
    it("lowers to the threshold mode of the graveyard exile leg, on your own graveyard", () => {
        const def = definition(
            "{T}, Collect evidence 3: Tap target creature you don't control."
        );
        expect(def.activatedAbilities?.[0]?.cost).toEqual({
            tap: true,
            exileFromGraveyard: {
                count: 1,
                owner: "you",
                minTotalManaValue: 3,
            },
        });
    });

    it("refuses the X form, which has no encoding on an ability", () => {
        expect(compile("Collect evidence X: Tap target creature.").state).toBe(
            "unparsed"
        );
    });

    it("refuses it on a mana ability, whose stackless path has no payment site", () => {
        expect(
            compile("{T}, Collect evidence 3: Add {G}.", "Artifact").state
        ).toBe("unparsed");
    });
});

describe('"another target" on an activated ability', () => {
    it("excludes the ability's own source", () => {
        const def = definition(
            "{T}: Untap another target permanent you control."
        );
        expect(def.activatedAbilities?.[0]?.targetRequirement).toMatchObject({
            controller: "you",
            excludeSource: true,
        });
    });

    it("stays refused behind a trigger head naming another object the word could mean", () => {
        expect(
            compile(
                "Whenever a creature enters, untap another target creature you control."
            ).state
        ).toBe("unparsed");
    });
});

describe("Optional collect evidence (CR 701.59c)", () => {
    const LINE =
        "As an additional cost to cast this spell, you may collect evidence 6.";

    it("declares a never-kicked cost entry and links its sentence (CR 607)", () => {
        const def = definition(
            `${LINE}\nWhen this creature enters, tap target creature. If evidence was collected, put a stun counter on it.`
        );
        expect(def.kickers).toEqual([
            {
                id: "collect-evidence",
                description: "Collect evidence 6",
                keyword: "collect-evidence",
                collectEvidence: 6,
            },
        ]);
        const trigger = def.compiledTriggeredAbilities?.[0];
        expect(trigger?.effects?.[1]).toEqual({
            op: "if",
            predicate: {
                left: { additionalCostPaid: "collect-evidence" },
                op: "ge",
                right: 1,
            },
            then: [
                {
                    op: "counters",
                    action: "add",
                    counter: "stun",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        });
    });

    it("reads the intervening-if form as the same record", () => {
        const def = definition(
            `${LINE}\nWhen this creature enters, if evidence was collected, draw a card.`
        );
        expect(def.compiledTriggeredAbilities?.[0]?.effects?.[0]).toMatchObject(
            {
                op: "if",
                predicate: { left: { additionalCostPaid: "collect-evidence" } },
            }
        );
    });

    it("refuses a gate on a card that prints no such cost: it could never open", () => {
        expect(
            compile(
                "When this creature enters, if evidence was collected, draw a card."
            ).state
        ).toBe("unparsed");
    });

    it("refuses a gate behind a head that does not fire on this permanent entering", () => {
        expect(
            compile(
                `${LINE}\nWhenever this creature attacks, tap target creature. If evidence was collected, put a stun counter on it.`
            ).state
        ).toBe("unparsed");
    });

    it("refuses a sentence sharing the cost's line (Bite Down on Crime's reduction)", () => {
        expect(
            compile(
                `${LINE} This spell costs {2} less to cast if evidence was collected.`
            ).state
        ).toBe("unparsed");
    });

    it("refuses the mandatory form (Urgent Necropsy's)", () => {
        expect(
            compile(
                "As an additional cost to cast this spell, collect evidence 3."
            ).state
        ).toBe("unparsed");
    });

    it('keeps "it" refused after two announced targets: the referent is not one object', () => {
        expect(
            compile(
                `${LINE}\nWhen this creature enters, tap target creature. Untap target land. If evidence was collected, put a stun counter on it.`
            ).state
        ).toBe("unparsed");
    });
});

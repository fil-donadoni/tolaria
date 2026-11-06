// A modal triggered ability (CR 700.2b / 603.3c) and a restricted-mana rider
// (CR 106.6) — the two forms The Mightstone and Weakstone prints.
//
//  1. GOLDEN — each form compiled whole and compared with the hand-written
//     card that prints it (Guard C's comparator, `roundTripCard`).
//  2. REFUSALS — the printed neighbours the rules must not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { runGates } from "../gates";
import { sortKeys } from "../gates";
import { compiledTwin, roundTripCard } from "../gold";
import { theMightstoneAndWeakstone } from "../../cards/sets/bro/colorless.cards";
import { deceiverExarch } from "../../cards/sets/nph/blue.cards";
import { oracleCard } from "./oracle.fixture";

function artifact(oracleText: string) {
    return oracleCard({
        name: "Test Stone",
        manaCost: "{5}",
        typeLine: "Artifact",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function creature(oracleText: string) {
    return oracleCard({ name: "Test Exarch", oracleText });
}

const MODES =
    "\n• Draw two cards.\n• Target creature gets -5/-5 until end of turn.";

describe("modal triggered ability (CR 700.2b / 603.3c) — goldens", () => {
    // `roundTripCard` calls a card with a closure in its body "incomparable"
    // and compares nothing nested under it, so the modes are compared here
    // directly: the compiled trigger, expanded, against the hand-written one.
    it.each([theMightstoneAndWeakstone(), deceiverExarch()])(
        "$name: the compiled modes equal the hand-written modes",
        (card) => {
            const twin = compiledTwin(card);
            if (!twin.ok) throw new Error(twin.detail);
            // A mode id is a dispatch key the author picks; the compiler mints
            // an ordinal one, so identity is compared on everything else.
            const withoutIds = (t: { modes?: readonly { id: string }[] }) =>
                t.modes?.map((mode) => ({ ...mode, id: "" }));
            const written = card.triggeredAbilities!.map(withoutIds);
            const compiled =
                twin.definition.triggeredAbilities!.map(withoutIds);
            expect(written[0]).toBeDefined();
            expect(sortKeys(compiled)).toEqual(sortKeys(written));
            expect(roundTripCard(card).verdict.ok).toBe(true);
        }
    );

    it("lowers to TriggeredAbility.modes with no ability-level body", () => {
        const outcome = compileCard(
            creature(
                "When this creature enters, choose one —\n• Draw two cards.\n• Target creature gets -5/-5 until end of turn."
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const trigger = outcome.definition.compiledTriggeredAbilities![0]!;
        expect(trigger.effects).toEqual([]);
        expect(trigger.modes).toHaveLength(2);
        expect(trigger.modes![1]!.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });
});

describe("modal triggered ability — the compile gate reads the modes", () => {
    it("a broken mode body quarantines the card (CR 700.2b)", () => {
        const outcome = compileCard(
            creature(
                "When this creature enters, choose one —\n• Draw two cards.\n• Target creature gets -5/-5 until end of turn."
            )
        );
        if (outcome.state !== "ready") throw new Error("not ready");
        const definition = structuredClone(outcome.definition);
        const modes = definition.compiledTriggeredAbilities![0]!.modes!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (modes[0] as any).effects = [
            { op: "draw", player: { ref: "$nonexistent" }, count: 1 },
        ];
        const result = runGates({
            oracleId: "x",
            plannedMechanics: [],
            ungrantableKeywords: [],
            definition,
        });
        expect(result.reasons.map((r) => r.kind)).toContain(
            "validate-effect-script"
        );
    });
});

describe("modal triggered ability — refusals", () => {
    const refused = (text: string) =>
        expect(compileCard(creature(text)).state).not.toBe("ready");

    it("a cardinality other than one stays refused", () => {
        refused(`When this creature enters, choose two —${MODES}`);
        refused(`When this creature enters, choose one or both —${MODES}`);
    });

    it("a single bullet is not a choice", () => {
        refused("When this creature enters, choose one —\n• Draw two cards.");
    });

    it("a head other than enters-this-permanent is not read", () => {
        refused(`Whenever this creature attacks, choose one —${MODES}`);
        refused(`Whenever another creature enters, choose one —${MODES}`);
    });

    it("the same mode printed twice is refused", () => {
        refused(
            "When this creature enters, choose one —\n• Draw two cards.\n• Draw two cards."
        );
    });
});

describe("restricted-mana rider (CR 106.6)", () => {
    it("lowers to manaRestriction: not-nonartifact-spell", () => {
        const outcome = compileCard(
            artifact(
                "{T}: Add {C}{C}. This mana can't be spent to cast nonartifact spells."
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.activatedAbilities![0]).toMatchObject({
            manaProduced: { C: 2 },
            manaRestriction: "not-nonartifact-spell",
        });
    });

    it("a plain fixed production carries no restriction", () => {
        const outcome = compileCard(artifact("{T}: Add {C}{C}."));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(
            outcome.definition.activatedAbilities![0]!.manaRestriction
        ).toBeUndefined();
    });

    it("a neighbouring restriction sentence is refused", () => {
        for (const rider of [
            "This mana can't be spent to cast artifact spells.",
            "This mana can't be spent to cast nonland spells.",
            "Spend this mana only to cast artifact spells.",
        ])
            expect(
                compileCard(artifact(`{T}: Add {C}{C}. ${rider}`)).state
            ).not.toBe("ready");
    });

    it("a cost without a tap leg is refused (the restriction is applied on the tap route)", () => {
        expect(
            compileCard(
                artifact(
                    "{2}: Add {C}{C}. This mana can't be spent to cast nonartifact spells."
                )
            ).state
        ).not.toBe("ready");
    });
});

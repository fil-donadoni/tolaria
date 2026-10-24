// "from a single graveyard" — a target group whose picks share one graveyard
// (CR 404.1, CR 601.2c), lowered to `TargetRequirement.sameController` read on
// the graveyard's owner, under the CR 601.2c "up to three" head.
//
//  1. GOLDENS — a real corpus row compared with `sortKeys` equality against
//     the WHOLE Compiled Definition.
//  2. REFUSALS — the neighbours the rule must NOT read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const EXILE_CLAUSE = "Exile up to three target cards from a single graveyard.";

const exileThree = {
    effects: [0, 1, 2].map((slot) => ({
        op: "moveZone",
        target: { target: slot },
        to: "exile",
    })),
    targetRequirement: {
        type: "card",
        count: { min: 0, max: 3 },
        zone: "graveyard",
        controller: "any",
        sameController: true,
    },
};

const spell = (name: string, manaCost: string, text: string) =>
    compileCard(
        oracleCard({ name, manaCost, typeLine: "Sorcery", oracleText: text })
    );

describe("single graveyard — goldens", () => {
    it("Decompose: three cards from one graveyard (CR 404.1, CR 601.2c)", () => {
        const outcome = spell("Decompose", "{1}{B}", EXILE_CLAUSE);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Decompose",
                types: ["Sorcery"],
                manaCost: { X: 1, B: 1 },
                oracleText: EXILE_CLAUSE,
                ...exileThree,
            })
        );
    });

    it("Ebony Charm: the same clause as one mode of a modal spell", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Ebony Charm",
                manaCost: "{B}",
                typeLine: "Instant",
                oracleText: `Choose one —\n• Target opponent loses 1 life and you gain 1 life.\n• ${EXILE_CLAUSE}\n• Target creature gains fear until end of turn. (It can't be blocked except by artifact creatures and/or black creatures.)`,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const mode = outcome.definition.modes?.[1];
        expect(sortKeys(mode)).toEqual(
            sortKeys({
                id: "ebony-charm-mode-2",
                label: "Exile up to three target cards from a single graveyard",
                oracleText: EXILE_CLAUSE,
                ...exileThree,
            })
        );
    });
});

describe("single graveyard — refused neighbours (fail-closed)", () => {
    it.each([
        // CR 601.2c — a single card is no group to constrain.
        "Exile target card from a single graveyard.",
        // CR 601.2c — only the printed heads: two and three, not four.
        "Exile up to four target cards from a single graveyard.",
        // CR 404.1 — "your" and "single" name different graveyard readings.
        "Exile up to three target cards from a single graveyard you control.",
    ])("refuses %s", (line) => {
        expect(spell("Probe", "{B}", line).state).toBe("unparsed");
    });

    it("keeps 'a graveyard' (each pick may come from any) free of the constraint", () => {
        const outcome = spell(
            "Probe",
            "{B}",
            "Exile up to three target cards from a graveyard."
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.targetRequirement).not.toHaveProperty(
            "sameController"
        );
    });
});

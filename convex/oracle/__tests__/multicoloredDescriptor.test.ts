// "multicolored" in the descriptor reader (CR 105.2b, Grammar Cluster issue
// #5287): a colour COUNT, so it lowers to `colorCountAtLeast: 2` at the sites
// that read live colours and is REFUSED, never dropped, everywhere else.
//
// The edict golden (Renounce the Guilds) lives in `playerEdict.test.ts` and
// `grammar/fixtures.ts`; this file pins the reader and the refusal side.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import {
    descriptorRule,
    permanentFilterFromDescriptor,
    targetRequirementFromDescriptor,
} from "../grammar/shared/targetFilter";
import { oracleCard, parseContext } from "./oracle.fixture";

function read(span: string) {
    const outcome = descriptorRule.run(span, parseContext());
    if (!outcome.ok) throw new Error(`${span}: ${outcome.reason}`);
    return outcome.value;
}

describe("multicolored — the reader (CR 105.2b)", () => {
    it("is a colour-count flag beside the noun, not a colour", () => {
        const descriptor = read("multicolored creature");
        expect(descriptor.multicolored).toBe(true);
        expect(descriptor.colors).toBeUndefined();
        expect(descriptor.types).toEqual(["Creature"]);
    });

    it("lowers to colorCountAtLeast: 2 only where live colours are read", () => {
        const descriptor = read("multicolored permanent");
        // The cost site has no colour reader on its payment path: refused.
        expect(permanentFilterFromDescriptor(descriptor).ok).toBe(false);
        const condition = permanentFilterFromDescriptor(descriptor, {
            colors: true,
        });
        expect(condition.ok && condition.value.colorCountAtLeast).toBe(2);
    });

    it("refuses a colour count beside a colour word, and the word twice", () => {
        for (const span of [
            "multicolored white creature",
            "white multicolored creature",
            "multicolored multicolored creature",
        ])
            expect(descriptorRule.run(span, parseContext()).ok).toBe(false);
    });

    it("a target requirement refuses it: no colour-count field to announce", () => {
        const outcome = targetRequirementFromDescriptor(
            read("multicolored creature")
        );
        expect(outcome.ok).toBe(false);
    });

    it("a card targeting a multicolored creature stays refused, not widened", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Multicolor Probe",
                manaCost: "{1}{R}",
                typeLine: "Instant",
                oracleText: "Destroy target multicolored creature.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

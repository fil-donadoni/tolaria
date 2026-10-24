// Artifact types as bare nouns in the descriptor reader (CR 205.3g, Grammar
// Cluster issue #5282): "Sacrifice a Treasure", "you control no Clues". A bare
// subtype records only the subtype; the consumer that needs a card type
// (`TargetRequirement.type`) infers Artifact, a `PermanentFilter` does not.

import { describe, expect, it } from "vitest";
import {
    descriptorRule,
    permanentFilterFromDescriptor,
    targetRequirementFromDescriptor,
} from "../grammar/shared/targetFilter";
import { parseContext } from "./oracle.fixture";

function read(span: string) {
    const outcome = descriptorRule.run(span, parseContext());
    if (!outcome.ok) throw new Error(`${span}: ${outcome.reason}`);
    return outcome.value;
}

describe("artifact subtype nouns (CR 205.3g)", () => {
    it.each([
        ["Treasure", "Treasure", false],
        ["Treasures", "Treasure", true],
        ["Food", "Food", false],
        ["Clues", "Clue", true],
    ])("reads %s as the subtype %s", (span, subtype, plural) => {
        const descriptor = read(span);
        expect(descriptor.subtypes).toEqual([subtype]);
        expect(descriptor.plural === true).toBe(plural);
        expect(descriptor.types).toBeUndefined();
    });

    it("a cost filter records only the subtype, like a land subtype", () => {
        const filter = permanentFilterFromDescriptor(read("Treasure"));
        expect(filter.ok && filter.value.subtypes).toEqual(["Treasure"]);
        expect(filter.ok && filter.value.types).toBeUndefined();
    });

    it("a target requirement infers Artifact from the subtype", () => {
        const requirement = targetRequirementFromDescriptor(read("Clue"));
        expect(requirement.ok && requirement.value.type).toEqual("Artifact");
    });

    it("refuses a noun that is no artifact type", () => {
        expect(descriptorRule.run("Treasury", parseContext()).ok).toBe(false);
        expect(descriptorRule.run("Spellbook", parseContext()).ok).toBe(false);
    });
});

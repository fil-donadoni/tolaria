// A noun or-list mixing a card type and a subtype (issue #8230): "target
// creature or Vehicle" used to lower to `{ type: "Creature", subtypeFilter:
// ["Vehicle"] }`, an intersection nothing satisfies. CR 301.7: an uncrewed
// Vehicle is an artifact, no creature.
import { describe, expect, it } from "vitest";
import { enchantRule } from "../grammar/slots/keywordLine";
import {
    descriptorRule,
    targetDescriptorRule,
    targetFilterRule,
} from "../grammar/shared/targetFilter";
import { parseContext } from "./oracle.fixture";

const UNION = {
    type: ["Creature", "Artifact"],
    count: 1,
    typeOrSubtypeFilter: { types: ["Creature"], subtypes: ["Vehicle"] },
};

describe("a mixed or-list at the head of a target", () => {
    it("lowers to a union, the type widened to the subtype's card type", () => {
        const read = targetFilterRule.run(
            "target creature or Vehicle",
            parseContext()
        );
        expect(read.ok && read.value).toEqual(UNION);
    });

    it("keeps every other filter on the requirement beside the union", () => {
        const read = targetFilterRule.run(
            "target creature or Vehicle an opponent controls",
            parseContext()
        );
        expect(read.ok && read.value).toEqual({
            ...UNION,
            controller: "opponent",
        });
    });

    it("reads a longer list and a land type the same way", () => {
        const read = targetFilterRule.run(
            "target artifact, creature, or Forest",
            parseContext()
        );
        expect(read.ok && read.value).toEqual({
            type: ["Artifact", "Creature", "Land"],
            count: 1,
            typeOrSubtypeFilter: {
                types: ["Artifact", "Creature"],
                subtypes: ["Forest"],
            },
        });
    });

    it("an Enchant line reads it as the Aura's target requirement", () => {
        const read = enchantRule.run(
            "Enchant creature or Vehicle",
            parseContext()
        );
        expect(read.ok && read.value).toEqual({
            kind: "enchant",
            requirement: UNION,
        });
    });

    it("refuses a subtype adjective before the list", () => {
        expect(
            targetDescriptorRule.run(
                "Goblin creature or Vehicle",
                parseContext()
            ).ok
        ).toBe(false);
    });

    it("refuses a subtype whose card type the grammar cannot name", () => {
        const read = targetFilterRule.run(
            "target creature or Aura",
            parseContext()
        );
        expect(read.ok).toBe(false);
    });

    it("leaves an all-subtype and an all-type list as they were", () => {
        const subtypes = targetFilterRule.run(
            "target Forest or Plains",
            parseContext()
        );
        expect(subtypes.ok && subtypes.value).toEqual({
            type: "Land",
            count: 1,
            subtypeFilter: ["Forest", "Plains"],
        });
        const types = targetFilterRule.run(
            "target artifact or creature",
            parseContext()
        );
        expect(types.ok && types.value).toEqual({
            type: ["Artifact", "Creature"],
            count: 1,
        });
    });
});

describe("a mixed or-list anywhere else", () => {
    it("is refused: no other shape can say the union", () => {
        const read = descriptorRule.run("creature or Vehicle", parseContext());
        expect(read.ok).toBe(false);
        expect(!read.ok && read.reason).toContain(
            "mixes card types and subtypes"
        );
    });
});

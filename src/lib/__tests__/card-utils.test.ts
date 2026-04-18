import { describe, it, expect } from "vitest";
import {
    wantsPermanentTarget,
    matchesTargetRequirement,
    getStackAbilities,
    getAbilityOracleText,
} from "../card-utils";
import type { CardInstance, ManaPool } from "~/types/game";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardInstance(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: overrides.id ?? "card-1",
        card: overrides.card ?? {
            id: "test-id",
            name: "Test Card",
            types: ["Creature"],
        },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
        subtypes: [],
        ...overrides,
    };
}

const emptyPool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

// ---------------------------------------------------------------------------
// wantsPermanentTarget
// ---------------------------------------------------------------------------

describe("wantsPermanentTarget", () => {
    it("returns true for 'Creature'", () => {
        expect(wantsPermanentTarget("Creature")).toBe(true);
    });

    it("returns true for 'any'", () => {
        expect(wantsPermanentTarget("any")).toBe(true);
    });

    it("returns true for ['Artifact', 'Enchantment']", () => {
        expect(wantsPermanentTarget(["Artifact", "Enchantment"])).toBe(true);
    });

    it("returns false for 'player'", () => {
        expect(wantsPermanentTarget("player")).toBe(false);
    });

    it("returns false for undefined", () => {
        expect(wantsPermanentTarget(undefined)).toBe(false);
    });

    it("returns true for ['player', 'Creature'] (mixed)", () => {
        expect(wantsPermanentTarget(["player", "Creature"])).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// matchesTargetRequirement
// ---------------------------------------------------------------------------

describe("matchesTargetRequirement", () => {
    it("creature matches 'Creature'", () => {
        const card = makeCardInstance({ types: ["Creature"] });
        expect(matchesTargetRequirement(card, "Creature")).toBe(true);
    });

    it("creature does not match 'Artifact'", () => {
        const card = makeCardInstance({ types: ["Creature"] });
        expect(matchesTargetRequirement(card, "Artifact")).toBe(false);
    });

    it("artifact matches ['Artifact', 'Enchantment']", () => {
        const card = makeCardInstance({ types: ["Artifact"] });
        expect(
            matchesTargetRequirement(card, ["Artifact", "Enchantment"])
        ).toBe(true);
    });

    it("enchantment matches ['Artifact', 'Enchantment']", () => {
        const card = makeCardInstance({ types: ["Enchantment"] });
        expect(
            matchesTargetRequirement(card, ["Artifact", "Enchantment"])
        ).toBe(true);
    });

    it("creature does not match ['Artifact', 'Enchantment']", () => {
        const card = makeCardInstance({ types: ["Creature"] });
        expect(
            matchesTargetRequirement(card, ["Artifact", "Enchantment"])
        ).toBe(false);
    });

    it("artifact creature matches both 'Artifact' and 'Creature'", () => {
        const card = makeCardInstance({ types: ["Artifact", "Creature"] });
        expect(matchesTargetRequirement(card, "Artifact")).toBe(true);
        expect(matchesTargetRequirement(card, "Creature")).toBe(true);
        expect(
            matchesTargetRequirement(card, ["Artifact", "Enchantment"])
        ).toBe(true);
    });

    it("any permanent matches 'any'", () => {
        const creature = makeCardInstance({ types: ["Creature"] });
        const land = makeCardInstance({ types: ["Land"] });
        expect(matchesTargetRequirement(creature, "any")).toBe(true);
        expect(matchesTargetRequirement(land, "any")).toBe(true);
    });

    it("land matches 'Land' but not 'Creature'", () => {
        const land = makeCardInstance({ types: ["Land"] });
        expect(matchesTargetRequirement(land, "Land")).toBe(true);
        expect(matchesTargetRequirement(land, "Creature")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getStackAbilities
// ---------------------------------------------------------------------------

describe("getStackAbilities", () => {
    it("returns stack abilities for Nevinyrral's Disk when costs payable", () => {
        const card = makeCardInstance({
            card: {
                id: "12926dc8-8e6f-4a47-a12b-4d674189615a",
                name: "Nevinyrral's Disk",
                types: ["Artifact"],
            },
            types: ["Artifact"],
            isTapped: false,
        });
        const pool = { ...emptyPool, W: 1 }; // 1 generic mana available

        const abilities = getStackAbilities(card, pool);

        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe("nevinyrral-destroy");
        expect(abilities[0].oracleText).toContain("Destroy all");
    });

    it("returns empty when Disk is tapped (tap cost unpayable)", () => {
        const card = makeCardInstance({
            card: {
                id: "12926dc8-8e6f-4a47-a12b-4d674189615a",
                name: "Nevinyrral's Disk",
                types: ["Artifact"],
            },
            types: ["Artifact"],
            isTapped: true,
        });
        const pool = { ...emptyPool, W: 1 };

        expect(getStackAbilities(card, pool)).toHaveLength(0);
    });

    it("returns empty when not enough mana for Disk", () => {
        const card = makeCardInstance({
            card: {
                id: "12926dc8-8e6f-4a47-a12b-4d674189615a",
                name: "Nevinyrral's Disk",
                types: ["Artifact"],
            },
            types: ["Artifact"],
            isTapped: false,
        });

        expect(getStackAbilities(card, emptyPool)).toHaveLength(0);
    });

    it("returns empty for mana-only abilities (Mox)", () => {
        const card = makeCardInstance({
            card: {
                id: "b0e1427c-05cd-465b-be59-97ed6e39f7ba",
                name: "Mox Emerald",
                types: ["Artifact"],
            },
            types: ["Artifact"],
            isTapped: false,
        });

        expect(getStackAbilities(card, emptyPool)).toHaveLength(0);
    });

    it("returns empty for creatures without activated abilities", () => {
        const card = makeCardInstance({
            card: {
                id: "ce2d603a-3231-4a8c-bf39-1617586ea870",
                name: "Grizzly Bears",
                types: ["Creature"],
            },
            types: ["Creature"],
        });

        expect(getStackAbilities(card, emptyPool)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// getAbilityOracleText
// ---------------------------------------------------------------------------

describe("getAbilityOracleText", () => {
    it("returns oracle text for Disk ability", () => {
        const text = getAbilityOracleText(
            "12926dc8-8e6f-4a47-a12b-4d674189615a",
            "nevinyrral-destroy"
        );
        expect(text).toContain(
            "Destroy all artifacts, creatures, and enchantments"
        );
    });

    it("returns null for unknown ability id", () => {
        const text = getAbilityOracleText(
            "12926dc8-8e6f-4a47-a12b-4d674189615a",
            "nonexistent"
        );
        expect(text).toBeNull();
    });

    it("returns oracle text for Mox mana ability", () => {
        const text = getAbilityOracleText(
            "b0e1427c-05cd-465b-be59-97ed6e39f7ba",
            "mox-emerald-mana"
        );
        expect(text).toBe("{T}: Add {G}.");
    });
});

import { describe, expect, it } from "vitest";
import { aggregateOracleText } from "../oracleAggregator";
import type { CardDefinition } from "../types";

describe("aggregateOracleText", () => {
    const stub = (overrides: Partial<CardDefinition>): CardDefinition => ({
        id: "stub",
        name: "Stub",
        types: ["Creature"],
        ...overrides,
    });

    it("returns empty strings for a vanilla card with no abilities", () => {
        const result = aggregateOracleText(stub({}));
        expect(result.searchable).toBe("");
        expect(result.display).toBe("");
    });

    it("includes static keyword abilities", () => {
        const result = aggregateOracleText(
            stub({ staticAbilities: ["flying", "first strike"] })
        );
        expect(result.searchable).toContain("flying");
        expect(result.searchable).toContain("first strike");
        expect(result.display).toBe("flying\nfirst strike");
    });

    it("includes activated ability oracle text", () => {
        const result = aggregateOracleText(
            stub({
                activatedAbilities: [
                    {
                        id: "test",
                        oracleText: "{2}: Target creature gets +1/+0.",
                        cost: { mana: { X: 2 } },
                        useStack: true,
                    },
                ],
            })
        );
        expect(result.searchable).toContain("target creature gets +1/+0");
    });

    it("includes triggered ability oracle text", () => {
        const result = aggregateOracleText(
            stub({
                triggeredAbilities: [
                    {
                        id: "death-trigger",
                        oracleText: "When this creature dies, draw a card.",
                        event: "CREATURE_DIED",
                        matches: () => false,
                        resolve: () => {},
                    },
                ],
            })
        );
        expect(result.searchable).toContain("draw a card");
    });

    it("synthesizes basic-land mana ability", () => {
        const result = aggregateOracleText(
            stub({
                id: "plains",
                name: "Plains",
                types: ["Land"],
                subtypes: ["Plains"],
            })
        );
        expect(result.display).toContain("{T}: Add {W}.");
        expect(result.searchable).toContain("{t}: add {w}.");
    });

    it("does not synthesize land mana for dual lands (multi-subtype)", () => {
        const result = aggregateOracleText(
            stub({
                id: "badlands",
                name: "Badlands",
                types: ["Land"],
                subtypes: ["Swamp", "Mountain"],
            })
        );
        expect(result.display).toBe("");
    });

    it("lowercases the searchable blob", () => {
        const result = aggregateOracleText(
            stub({
                staticAbilities: ["FLYING"],
                activatedAbilities: [
                    {
                        id: "x",
                        oracleText: "Draw THREE cards.",
                        cost: {},
                        useStack: true,
                    },
                ],
            })
        );
        expect(result.searchable).toBe("flying\ndraw three cards.");
    });
});

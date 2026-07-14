// Pool-scoped deckbuilding: Basic land resolution (PRD #1107 story 18, ADR
// 0054/0055, issue #1111). Uses real LEA registry ids (mirrors
// `src/lib/__tests__/deckTypes.test.ts`'s pattern) so this exercises the real
// card registry, not a stub.
import { describe, it, expect } from "vitest";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import { isBasicLandCardId, resolveBasicLandCardIds } from "../basicLands";

const BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

function poolCard(cardId: string, cardName = cardId): LimitedPoolCard {
    return { scryfallId: cardId, cardId, cardName };
}

describe("isBasicLandCardId", () => {
    it("is true for a Basic land, false for a nonbasic card", () => {
        expect(isBasicLandCardId(MOUNTAIN)).toBe(true);
        expect(isBasicLandCardId(BOLT_LEA)).toBe(false);
    });

    it("is false for an unresolvable id", () => {
        expect(isBasicLandCardId("not-a-real-card")).toBe(false);
    });
});

describe("resolveBasicLandCardIds (issue #1111: unlimited basics sourced from the drafted set)", () => {
    it("resolves only the subtypes actually opened in the Pool", () => {
        const pool = [
            poolCard(BOLT_LEA, "Lightning Bolt"),
            poolCard(MOUNTAIN, "Mountain"),
            poolCard(FOREST, "Forest"),
        ];
        const result = resolveBasicLandCardIds(pool);
        expect(result.Mountain).toBe(MOUNTAIN);
        expect(result.Forest).toBe(FOREST);
        // Never opened in this Pool — not offered.
        expect(result.Plains).toBeNull();
        expect(result.Island).toBeNull();
        expect(result.Swamp).toBeNull();
    });

    it("is empty (every subtype null) for a Pool with no basics at all", () => {
        const result = resolveBasicLandCardIds([poolCard(BOLT_LEA)]);
        expect(Object.values(result).every((v) => v === null)).toBe(true);
    });

    it("picks the FIRST matching copy — repeats of the same subtype don't change the resolved id", () => {
        const pool = [
            poolCard(MOUNTAIN, "Mountain"),
            poolCard(MOUNTAIN, "Mountain"),
        ];
        const result = resolveBasicLandCardIds(pool);
        expect(result.Mountain).toBe(MOUNTAIN);
    });
});

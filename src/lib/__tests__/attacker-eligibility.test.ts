import { describe, it, expect, vi } from "vitest";
import type { CardInstance, Player } from "~/types/game";

// The predicate reads a card's staticEffects through getDefinition and the
// board through globalAttackProhibitionReason — both card-layer. Stub both so
// the test drives the pure eligibility logic, not the catalogue.
const DEFS: Record<string, { staticEffects?: unknown[] }> = {
    plain: { staticEffects: [] },
};
vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => DEFS[id] ?? { staticEffects: [] },
}));
let prohibition: string | undefined = undefined;
vi.mock("@convex/cards/attackRestrictions", () => ({
    globalAttackProhibitionReason: () => prohibition,
}));

import {
    isEligibleAttacker,
    eligibleAttackerIds,
} from "../attacker-eligibility";

function creature(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "c1",
        card: { id: "plain" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        ...overrides,
    } as CardInstance;
}

function player(id: string, battlefield: CardInstance[]): Player {
    return { id, name: id, battlefield } as Player;
}

describe("isEligibleAttacker (CR 508.1a)", () => {
    const opp = player("opp", []);
    const all = [player("me", []), opp];

    it("admits a ready untapped creature", () => {
        expect(isEligibleAttacker(creature(), opp.battlefield, all)).toBe(true);
    });

    it("rejects a tapped creature", () => {
        expect(
            isEligibleAttacker(
                creature({ isTapped: true }),
                opp.battlefield,
                all
            )
        ).toBe(false);
    });

    it("rejects a summoning-sick creature without haste", () => {
        expect(
            isEligibleAttacker(
                creature({ isSummoningSick: true }),
                opp.battlefield,
                all
            )
        ).toBe(false);
    });

    it("admits a summoning-sick creature WITH haste", () => {
        expect(
            isEligibleAttacker(
                creature({
                    isSummoningSick: true,
                    staticAbilities: ["haste"],
                }),
                opp.battlefield,
                all
            )
        ).toBe(true);
    });

    it("rejects a creature with defender", () => {
        expect(
            isEligibleAttacker(
                creature({ staticAbilities: ["defender"] }),
                opp.battlefield,
                all
            )
        ).toBe(false);
    });

    it("rejects a non-creature", () => {
        expect(
            isEligibleAttacker(
                creature({ types: ["Artifact"] }),
                opp.battlefield,
                all
            )
        ).toBe(false);
    });

    it("rejects when a board-scanned global prohibition applies", () => {
        prohibition = "Moat";
        try {
            expect(isEligibleAttacker(creature(), opp.battlefield, all)).toBe(
                false
            );
        } finally {
            prohibition = undefined;
        }
    });
});

describe("eligibleAttackerIds", () => {
    it("returns only the ids of eligible creatures", () => {
        const ready = creature({ id: "ready" });
        const tapped = creature({ id: "tapped", isTapped: true });
        const nonCreature = creature({ id: "art", types: ["Artifact"] });
        const me = player("me", [ready, tapped, nonCreature]);
        const opp = player("opp", []);
        expect(eligibleAttackerIds(me, opp, [me, opp])).toEqual(["ready"]);
    });
});

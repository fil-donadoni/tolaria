import { describe, it, expect, vi } from "vitest";
import type { CardInstance, Player } from "~/types/game";

// The predicate reads a card's staticEffects through getDefinition and the
// board through globalAttackProhibitionReason — both card-layer. Stub both so
// the test drives the pure eligibility logic, not the catalogue.
const DEFS: Record<string, { staticEffects?: unknown[] }> = {
    plain: { staticEffects: [] },
    "hobble-stub": {
        staticEffects: [
            {
                kind: "attack-restriction",
                id: "hobble-cant-attack",
                predicate: () => false,
                oracleText: "Enchanted creature can't attack.",
            },
        ],
    },
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

    it("rejects a creature enchanted by an Aura carrying an attack-restriction (Hobble, issue #1948 review BLOCKER 2)", () => {
        // The client mirror previously scanned only the card's OWN
        // staticEffects[], never an attached Aura's — Hobbled creatures were
        // never grayed out in the UI even though the server correctly
        // rejected the attack. Regression for that gap: an Aura permanent
        // whose `attachedTo` names the target must contribute its own
        // attack-restriction to the target's eligibility check.
        const target = creature({ id: "target" });
        const aura = creature({
            id: "aura",
            card: { id: "hobble-stub" },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            attachedTo: "target",
        });
        const me = player("me", [target, aura]);
        expect(isEligibleAttacker(target, opp.battlefield, [me, opp])).toBe(
            false
        );
    });

    it("does NOT restrict a creature with no Aura attached (no false-positive from the aura scan)", () => {
        const target = creature({ id: "target2" });
        const me = player("me", [target]);
        expect(isEligibleAttacker(target, opp.battlefield, [me, opp])).toBe(
            true
        );
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

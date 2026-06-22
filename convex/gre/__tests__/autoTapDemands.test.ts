// Unit tests for the hand-spell Demand builder and its timing filter
// (PRD #472, ADR 0034). Issue #474 ships the spine; issue #475 adds the
// timing-aware filter: a sorcery-speed hand spell counts as a preservable
// Demand only at sorcery timing (CR 307.1 / 601.3a), while instant-speed
// spells (Instants and Flash cards, CR 702.8) count in any priority window.

import { describe, it, expect } from "vitest";
import { buildHandSpellDemands } from "../autoTapDemands";
import { makeInstance } from "../../cards/__tests__/setup";

// Card instance ids → definitions (verified in the set files).
const COUNTERSPELL = "0df55e3f-14de-46ef-b6b1-616618724d9e"; // {U}{U} Instant
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // {W} Creature
const TIME_WALK = "e0139f60-d48e-46fb-9f5a-1e3d7558c834"; // {1}{U} Sorcery
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // basic Land

function inHand(cardId: string, id: string) {
    return makeInstance(cardId, { id, controllerId: "p1", zone: "hand" });
}

const ids = (demands: { id: string }[]) => demands.map((d) => d.id).sort();

describe("buildHandSpellDemands — timing filter (issue #475, CR 307 / 601.3a)", () => {
    it("at sorcery timing, sorcery-speed and instant-speed spells both count", () => {
        const hand = [
            inHand(COUNTERSPELL, "cs"),
            inHand(SAVANNAH_LIONS, "lions"),
            inHand(TIME_WALK, "walk"),
        ];
        // Cast the Counterspell; the other two are candidate Demands.
        const demands = buildHandSpellDemands(
            hand,
            "cs",
            /* sorceryTiming */ true
        );
        expect(ids(demands)).toEqual(["lions", "walk"]);
    });

    it("at instant timing, sorcery-speed spells (creatures/sorceries) are filtered out", () => {
        const hand = [
            inHand(COUNTERSPELL, "cs"),
            inHand(SAVANNAH_LIONS, "lions"),
            inHand(TIME_WALK, "walk"),
        ];
        // Cast some instant off-turn (sorceryTiming=false): only the
        // instant-speed Counterspell remains a Demand; the creature and the
        // sorcery are not legally castable now, so no mana is held for them.
        const demands = buildHandSpellDemands(hand, "other", false);
        expect(ids(demands)).toEqual(["cs"]);
    });

    it("the instant being cast is still excluded from its own Demand set", () => {
        const hand = [inHand(COUNTERSPELL, "cs"), inHand(COUNTERSPELL, "cs2")];
        const demands = buildHandSpellDemands(hand, "cs", false);
        // The second Counterspell is still an instant-speed Demand.
        expect(ids(demands)).toEqual(["cs2"]);
    });

    it("a Flash card counts as a Demand at instant timing (CR 702.8)", () => {
        // Synthesize a Flash creature: a Savannah Lions instance with the flash
        // keyword granted. hasInstantSpeed keys off types/staticAbilities, so a
        // creature-with-flash is treated as instant-speed.
        const flashLion = makeInstance(SAVANNAH_LIONS, {
            id: "flion",
            controllerId: "p1",
            zone: "hand",
            staticAbilities: ["flash"],
        });
        const demands = buildHandSpellDemands([flashLion], "other", false);
        expect(ids(demands)).toEqual(["flion"]);
    });

    it("lands never count, at either timing", () => {
        const hand = [inHand(FOREST, "forest"), inHand(COUNTERSPELL, "cs")];
        expect(ids(buildHandSpellDemands(hand, "x", true))).toEqual(["cs"]);
        expect(ids(buildHandSpellDemands(hand, "x", false))).toEqual(["cs"]);
    });
});

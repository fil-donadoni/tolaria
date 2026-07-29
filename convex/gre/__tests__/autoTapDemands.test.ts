// Unit tests for the hand-spell Demand builder and its timing filter
// (PRD #472, ADR 0034). Issue #474 ships the spine; issue #475 adds the
// timing-aware filter: a sorcery-speed hand spell counts as a preservable
// Demand only at sorcery timing (CR 307.1 / 601.3a), while instant-speed
// spells (Instants and Flash cards, CR 702.8) count in any priority window.

import { describe, it, expect } from "vitest";
import {
    buildBoardAbilityDemands,
    buildHandSpellDemands,
} from "../autoTapDemands";
import { makeInstance } from "../../cards/__tests__/setup";
import type { Phase } from "../types";

// Card instance ids → definitions (verified in the set files).
const COUNTERSPELL = "0df55e3f-14de-46ef-b6b1-616618724d9e"; // {U}{U} Instant
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // {W} Creature
const TIME_WALK = "e0139f60-d48e-46fb-9f5a-1e3d7558c834"; // {1}{U} Sorcery
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // basic Land
const FIREBALL = "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece"; // {X}{R} Sorcery
const POWER_SINK = "1b342dd3-09b9-4108-bf12-a65d4cef4eb9"; // {X}{U} Instant
// Shivan Dragon — "{R}: This creature gets +1/+0" (firebreathing, instant-speed).
const SHIVAN_DRAGON = "fefbf149-f988-4f8b-9f53-56f5878116a6";
// Jade Statue — "{2}: becomes a 3/6 ... Activate only during combat".
const JADE_STATUE = "8d82d94b-ceef-4533-a4f2-b6442a61b839";

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

describe("buildHandSpellDemands — X-spell inflation at X=1 (issue #477, CR 107.3 / 601.2b)", () => {
    const costOf = (cardId: string) => {
        const demands = buildHandSpellDemands(
            [inHand(cardId, "x")],
            "other",
            /* sorceryTiming */ true
        );
        return demands[0]?.cost;
    };

    it("a {X}{R} sorcery is preserved as {R}+1 generic (assumed X=1), not just {R}", () => {
        // Fireball ({X}{R}): without inflation X=0 → {R:1}; the spell would be
        // under-preserved and could be stranded. At X=1 it is {R:1, X:1}.
        expect(costOf(FIREBALL)).toEqual({ R: 1, X: 1 });
    });

    it("a {X}{U} instant is preserved as {U}+1 generic at X=1", () => {
        // Power Sink ({X}{U}) — instant, counts at any timing; demanded at X=1.
        const demands = buildHandSpellDemands(
            [inHand(POWER_SINK, "x")],
            "other",
            /* sorceryTiming */ false
        );
        expect(demands[0]?.cost).toEqual({ U: 1, X: 1 });
    });

    it("a fixed (non-variable) cost is untouched by the X=1 assumption", () => {
        // Time Walk's {1}{U} has a plain numeric generic, not a variable {X};
        // the chosenX=1 fold must NOT add a phantom extra generic to it.
        expect(costOf(TIME_WALK)).toEqual({ U: 1, X: 1 });
    });
});

function onBoard(cardId: string, id: string) {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        zone: "battlefield",
    });
}

const MAIN: Phase = "PRECOMBAT_MAIN";
const COMBAT: Phase = "DECLARE_ATTACKERS";
const myTurn = { phase: MAIN, isControllersTurn: true };

describe("buildBoardAbilityDemands — on-board activated abilities (issue #476, CR 602.1)", () => {
    it("a firebreathing ability ({R}: +1/+0) becomes a {R} Demand", () => {
        const demands = buildBoardAbilityDemands(
            [onBoard(SHIVAN_DRAGON, "shiv")],
            myTurn
        );
        expect(ids(demands)).toEqual(["shiv#shivan-dragon-pump"]);
        expect(demands[0].cost).toEqual({ R: 1 });
    });

    it("a repeatable ability is counted ONCE, not per activation (PRD story 12)", () => {
        // One firebreathing creature must yield exactly one Demand regardless of
        // how many times it could be re-activated.
        const demands = buildBoardAbilityDemands(
            [onBoard(SHIVAN_DRAGON, "shiv")],
            myTurn
        );
        expect(demands).toHaveLength(1);
    });

    it("two distinct firebreathing creatures are two distinct Demands", () => {
        const demands = buildBoardAbilityDemands(
            [onBoard(SHIVAN_DRAGON, "shivA"), onBoard(SHIVAN_DRAGON, "shivB")],
            myTurn
        );
        expect(ids(demands)).toEqual([
            "shivA#shivan-dragon-pump",
            "shivB#shivan-dragon-pump",
        ]);
    });

    it("instant-speed abilities count in any window (off-turn included)", () => {
        // Shivan's pump has no timing restriction → instant-speed (CR 602.5b).
        const offTurn = { phase: MAIN, isControllersTurn: false };
        const demands = buildBoardAbilityDemands(
            [onBoard(SHIVAN_DRAGON, "shiv")],
            offTurn
        );
        expect(ids(demands)).toEqual(["shiv#shivan-dragon-pump"]);
    });

    it("a phase-restricted ability counts only in its phase (Jade Statue, combat-only)", () => {
        const statue = [onBoard(JADE_STATUE, "jade")];
        // Main phase, own turn: NOT activatable now → not a Demand.
        expect(buildBoardAbilityDemands(statue, myTurn)).toHaveLength(0);
        // During combat: activatable → a {2} Demand.
        const inCombat = buildBoardAbilityDemands(statue, {
            phase: COMBAT,
            isControllersTurn: true,
        });
        expect(ids(inCombat)).toEqual(["jade#jade-statue-animate"]);
        expect(inCombat[0].cost).toEqual({ X: 2 }); // generic {2}
    });

    it("suppressed permanents (CR 613.1f) expose no ability Demands", () => {
        const suppressed = makeInstance(SHIVAN_DRAGON, {
            id: "shiv",
            controllerId: "p1",
            zone: "battlefield",
            abilitiesSuppressedBy: [{ sourceId: "humility", seq: 1 }],
        });
        expect(buildBoardAbilityDemands([suppressed], myTurn)).toHaveLength(0);
    });

    it("a permanent with no mana-costed activated ability yields nothing", () => {
        // Savannah Lions is a vanilla creature — no activated abilities.
        expect(
            buildBoardAbilityDemands([onBoard(SAVANNAH_LIONS, "lions")], myTurn)
        ).toHaveLength(0);
    });
});

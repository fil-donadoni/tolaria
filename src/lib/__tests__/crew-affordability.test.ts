// Frontend wiring for Crew N (CR 702.122a) — issue #777.
//
// The crew affordability hint in `getStackAbilities` weighs the viewer's own
// untapped creatures against the Vehicle's `totalPower` cost, reading `power`
// and `crewPowerBonus` (CR 702.122b) off the entries `buildTriggerStateView`
// produces. Every assertion here drives the SURFACE through the REAL reducer —
// a hand-built view would mask a dropped field, which is the exact bug class
// the frontend-wiring regime exists to catch.

import { describe, it, expect, beforeAll } from "vitest";
import { registerTokenDefinition } from "@convex/cards";
import { makeVehicle } from "@convex/cards/abilities/vehicle";
import type { CardDefinition } from "@convex/cards/types";
import { smugglersCopter } from "@convex/cards/sets/kld";
import { grizzlyBears } from "@convex/cards/sets/lea";
import type { CardInstance } from "../../types/game";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";

const VIEWER = "p1";
const CREW_3_VEHICLE_ID = "test-crew-3-vehicle";
const PILOT_ID = "test-crew-pilot";
const PLAIN_ONE_DROP_ID = "test-crew-plain-1-1";

const crewThreeVehicle = makeVehicle({
    id: CREW_3_VEHICLE_ID,
    name: "Test Crew Three Vehicle",
    rarity: "rare",
    manaCost: { X: 3 },
    oracleText: "Crew 3",
    power: 4,
    toughness: 4,
    crew: 3,
});

/** CR 702.122b — a 1/1 that "crews Vehicles as though its power were 2
 *  greater" (the Shorikai Pilot shape). */
const pilot: CardDefinition = {
    id: PILOT_ID,
    name: "Test Pilot",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    subtypes: ["Pilot"],
    power: 1,
    toughness: 1,
    crewPowerBonus: 2,
};

/** The same body with NO rider — the control for the bonus assertions. */
const plainOneDrop: CardDefinition = {
    id: PLAIN_ONE_DROP_ID,
    name: "Test Plain One Drop",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
};

beforeAll(() => {
    // Synthetic definitions live in the `registry` only — `getAllCards()` reads
    // the static `allCards` list, so no catalogue-wide sweep sees them.
    registerTokenDefinition(crewThreeVehicle);
    registerTokenDefinition(pilot);
    registerTokenDefinition(plainOneDrop);
});

function perm(
    id: string,
    def: CardDefinition,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: def.id },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: def.types,
        subtypes: def.subtypes ?? [],
        staticAbilities: def.staticAbilities ?? [],
        power: def.power,
        toughness: def.toughness,
        ...overrides,
    };
}

/** Builds the view through the REAL reducer (never a hand-rolled object). */
function viewOf(battlefield: CardInstance[]) {
    return buildTriggerStateView(
        [
            { id: VIEWER, life: 20, hand: [], battlefield, graveyard: [] },
            { id: "p2", life: 20, hand: [], battlefield: [], graveyard: [] },
        ],
        VIEWER
    );
}

function offeredAbilityIds(
    source: CardInstance,
    battlefield: CardInstance[]
): string[] {
    return getStackAbilities(
        source,
        "PRECOMBAT_MAIN",
        true,
        viewOf(battlefield),
        20
    ).map((a) => a.id);
}

describe("Crew N affordability hint (CR 702.122a, via buildTriggerStateView)", () => {
    it("offers Crew 1 when an untapped creature with enough power is out", () => {
        const copter = perm("copter", smugglersCopter);
        const bear = perm("bear", grizzlyBears);
        expect(offeredAbilityIds(copter, [copter, bear])).toContain(
            "smugglers-copter-crew"
        );
    });

    it("hides Crew 1 on an empty board (no creature can pay)", () => {
        const copter = perm("copter", smugglersCopter);
        expect(offeredAbilityIds(copter, [copter])).not.toContain(
            "smugglers-copter-crew"
        );
    });

    it("hides Crew 1 when the only creature is already tapped", () => {
        const copter = perm("copter", smugglersCopter);
        const bear = perm("bear", grizzlyBears, { isTapped: true });
        expect(offeredAbilityIds(copter, [copter, bear])).not.toContain(
            "smugglers-copter-crew"
        );
    });

    it("does NOT count the Vehicle itself as a crewing creature (CR 702.122a 'other')", () => {
        // A crewed Copter IS a creature; it still can't crew itself.
        const copter = perm("copter", smugglersCopter, {
            types: ["Artifact", "Creature"],
        });
        expect(offeredAbilityIds(copter, [copter])).not.toContain(
            "smugglers-copter-crew"
        );
    });

    it("does not count an opponent's creature (controllerRelation: 'you')", () => {
        const copter = perm("copter", smugglersCopter);
        const theirBear = perm("their-bear", grizzlyBears, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const view = buildTriggerStateView(
            [
                {
                    id: VIEWER,
                    life: 20,
                    hand: [],
                    battlefield: [copter],
                    graveyard: [],
                },
                {
                    id: "p2",
                    life: 20,
                    hand: [],
                    battlefield: [theirBear],
                    graveyard: [],
                },
            ],
            VIEWER
        );
        const ids = getStackAbilities(
            copter,
            "PRECOMBAT_MAIN",
            true,
            view,
            20
        ).map((a) => a.id);
        expect(ids).not.toContain("smugglers-copter-crew");
    });
});

describe("crewPowerBonus survives the reducer (CR 702.122b)", () => {
    it("buildTriggerStateView carries the bonus onto the view entry", () => {
        const view = viewOf([
            perm("pilot", pilot),
            perm("plain", plainOneDrop),
        ]);
        const pilotView = view.players[0].battlefield.find(
            (c) => c.id === "pilot"
        )!;
        const plainView = view.players[0].battlefield.find(
            (c) => c.id === "plain"
        )!;
        expect(pilotView.crewPowerBonus).toBe(2);
        expect(plainView.crewPowerBonus).toBeUndefined();
    });

    it("a 1/1 Pilot with the rider makes Crew 3 affordable; a plain 1/1 does not", () => {
        const vehicle = perm("vehicle", crewThreeVehicle);
        const crewId = "test-crew-three-vehicle-crew";
        expect(
            offeredAbilityIds(vehicle, [vehicle, perm("pilot", pilot)])
        ).toContain(crewId);
        expect(
            offeredAbilityIds(vehicle, [vehicle, perm("plain", plainOneDrop)])
        ).not.toContain(crewId);
    });
});

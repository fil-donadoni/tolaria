// A target or enchant clause that is a union of card types and subtypes (issue
// #8230): "creature or Vehicle". CR 301.7 — an uncrewed Vehicle is an artifact
// and no creature. CR 702.5a — enchant restricts both what an Aura spell can
// target and what an Aura can enchant, so the two read one predicate.
import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    enchantedPermanentIsVehicle,
    makeVehicle,
} from "../../cards/abilities/vehicle";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears, solRing } from "../../cards/sets/lea/index.cards";
import type { TargetRequirement } from "../../cards/types";
import {
    getLegalTargets,
    NO_TARGETING_SOURCE,
    pendingTargetFiltersFromRequirement,
} from "../rules";
import { checkStateBasedActions } from "../sba";
import {
    beginApplyingStaticEffects,
    hostMatchesEnchantRestriction,
    type CardInstanceState,
    type GameState,
} from "../state";
import {
    checkPermanentTargetFilters,
    permanentFilterValuesFromCarrier,
} from "../targetFilters";

const CREATURE_OR_VEHICLE: TargetRequirement = {
    type: ["Creature", "Artifact"],
    count: 1,
    typeOrSubtypeFilter: { types: ["Creature"], subtypes: ["Vehicle"] },
};

const VEHICLE_ID = "test-union-vehicle";
const AURA_ID = "test-union-aura";
const PLAIN_AURA_ID = "test-union-plain-aura";

registerTokenDefinition(
    makeVehicle({
        id: VEHICLE_ID,
        name: "Test Union Vehicle",
        rarity: "common",
        manaCost: { X: 1 },
        oracleText: "Crew 1",
        power: 4,
        toughness: 3,
        crew: 1,
    })
);
registerTokenDefinition({
    id: AURA_ID,
    name: "Test Union Aura",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: CREATURE_OR_VEHICLE,
    ...enchantedPermanentIsVehicle({ name: "Test Union Aura", crew: 5 }),
});

// No static of its own: `AURA_ID` would make any host a Vehicle, legal or not.
registerTokenDefinition({
    id: PLAIN_AURA_ID,
    name: "Test Union Plain Aura",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: CREATURE_OR_VEHICLE,
});

function owned(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" });
}

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    owned(grizzlyBears().id, "bear"),
                    owned(VEHICLE_ID, "vehicle"),
                    owned(solRing().id, "ring"),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function enchanted(hostCardId: string): {
    state: GameState;
    aura: CardInstanceState;
} {
    const host = owned(hostCardId, "host");
    const aura = { ...owned(AURA_ID, "aura"), attachedTo: "host" };
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [host, aura] }),
            makePlayer("p2"),
        ],
    });
    beginApplyingStaticEffects(state, aura);
    checkStateBasedActions(state);
    return { state, aura };
}

const onBattlefield = (state: GameState, id: string): boolean =>
    state.players.flatMap((p) => p.battlefield).some((c) => c.id === id);

describe("target creature or Vehicle (issue #8230)", () => {
    it("CR 301.7 — offers the creature and the uncrewed Vehicle, never the plain artifact", () => {
        const legal = getLegalTargets(
            board(),
            CREATURE_OR_VEHICLE,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal.map((t) => t.id).sort()).toEqual(["bear", "vehicle"]);
    });

    it("the accepted set is the offered set, through the PendingTarget carrier", () => {
        const state = board();
        const carried = pendingTargetFiltersFromRequirement(
            CREATURE_OR_VEHICLE,
            undefined
        );
        expect(carried.typeOrSubtypeFilter).toEqual(
            CREATURE_OR_VEHICLE.typeOrSubtypeFilter
        );
        const values = permanentFilterValuesFromCarrier(carried);
        const accepted = state.players[0]!.battlefield.filter(
            (card) =>
                checkPermanentTargetFilters(
                    {
                        state,
                        sourceColors: [],
                        sourceTypes: [],
                        sourceSubtypes: [],
                        chooserId: "p1",
                        activePlayerId: state.activePlayerId,
                    },
                    card,
                    values
                ) === null
        );
        expect(accepted.map((c) => c.id).sort()).toEqual(["bear", "vehicle"]);
    });
});

describe("Enchant creature or Vehicle (issue #8230)", () => {
    it("CR 702.5a — a host that the Aura itself turns into a Vehicle stays legal", () => {
        const { state, aura } = enchanted(grizzlyBears().id);
        const host = state.players[0]!.battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(host.types).toEqual(["Artifact"]);
        expect(hostMatchesEnchantRestriction(host, aura)).toBe(true);
        expect(onBattlefield(state, "aura")).toBe(true);
    });

    it("CR 702.5a — a printed Vehicle is a legal host", () => {
        const state = board();
        const aura = owned(AURA_ID, "aura");
        const vehicle = state.players[0]!.battlefield.find(
            (c) => c.id === "vehicle"
        )!;
        expect(hostMatchesEnchantRestriction(vehicle, aura)).toBe(true);
    });

    it("CR 303.4c — on a plain artifact the union fails and the Aura is put into the graveyard", () => {
        const host = owned(solRing().id, "host");
        const aura = { ...owned(PLAIN_AURA_ID, "aura"), attachedTo: "host" };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        expect(hostMatchesEnchantRestriction(host, aura)).toBe(false);
        checkStateBasedActions(state);
        expect(onBattlefield(state, "aura")).toBe(false);
    });
});

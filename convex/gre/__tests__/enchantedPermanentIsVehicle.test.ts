// CR 301.7 / 702.122a / 205.1a / 613.1d / 506.4 (issue #7212) — "Enchanted
// permanent is a Vehicle artifact with crew N and it loses all other card
// types." The Aura is a definition local to this file: Swift Reconfiguration
// itself ships in its own hand-tail issue, issue #7252.
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
import { grizzlyBears } from "../../cards/sets/lea/index.cards";
import { validateAbilityEffectScript } from "../effects/validate";
import {
    activateAbilityOnState,
    selectActivationCostOnState,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { refreshExpectedInput } from "../expectedInput";
import { finalizeCleanup } from "../phases";
import { checkStateBasedActions } from "../sba";
import {
    animatePermanentAsCreature,
    beginApplyingStaticEffects,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const AURA_ID = "test-vehicle-aura";
const CREW_ID = "test-vehicle-aura-crew";
const FIVE_POWER_ID = "test-five-power";
const LAND_CREATURE_ID = "test-land-creature";
const EQUIPMENT_CREATURE_ID = "test-equipment-creature";
const PRINTED_VEHICLE_ID = "test-printed-vehicle";

registerTokenDefinition({
    id: AURA_ID,
    name: "Test Vehicle Aura",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: ["Creature", "Artifact"], count: 1 },
    ...enchantedPermanentIsVehicle({ name: "Test Vehicle Aura", crew: 5 }),
});
registerTokenDefinition({
    id: FIVE_POWER_ID,
    name: "Test Five Power",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 5,
    toughness: 5,
});
registerTokenDefinition({
    id: LAND_CREATURE_ID,
    name: "Test Land Creature",
    rarity: "common",
    manaCost: {},
    types: ["Land", "Creature"],
    subtypes: ["Forest", "Dryad"],
    power: 1,
    toughness: 1,
});
registerTokenDefinition({
    id: EQUIPMENT_CREATURE_ID,
    name: "Test Equipment Creature",
    rarity: "common",
    manaCost: {},
    types: ["Artifact", "Creature"],
    subtypes: ["Equipment", "Cat"],
    power: 2,
    toughness: 2,
});
registerTokenDefinition(
    makeVehicle({
        id: PRINTED_VEHICLE_ID,
        name: "Test Printed Vehicle",
        rarity: "common",
        manaCost: { X: 1 },
        oracleText: "Crew 1",
        power: 4,
        toughness: 3,
        crew: 1,
    })
);

function board(hostCardId: string): {
    state: GameState;
    host: CardInstanceState;
    aura: CardInstanceState;
} {
    const owned = (cardId: string, id: string) =>
        makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" });
    const host = owned(hostCardId, "host");
    const aura = { ...owned(AURA_ID, "aura"), attachedTo: "host" };
    const pilot = owned(FIVE_POWER_ID, "pilot");
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [host, aura, pilot] }),
            makePlayer("p2"),
        ],
    });
    beginApplyingStaticEffects(state, aura);
    checkStateBasedActions(state);
    return { state, host, aura };
}

function crew(state: GameState, abilityId = CREW_ID): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "host",
        abilityId,
    });
    selectActivationCostOnState(state, {
        playerId: "p1",
        cardInstanceId: "pilot",
    });
    resolveTopOfStack(state);
    state.priorityPlayerId = "p1";
    state.passCount = 0;
    refreshExpectedInput(state);
}

describe("Enchanted permanent is a Vehicle artifact with crew N (issue #7212)", () => {
    it("CR 205.1a / 613.1d — a creature host is only a Vehicle artifact, and the Aura leaving restores it", () => {
        const { state, host, aura } = board(grizzlyBears().id);
        expect(host.types).toEqual(["Artifact"]);
        expect(host.subtypes).toEqual(["Vehicle"]);

        removePermanentTo(state, aura.id, "graveyard");
        checkStateBasedActions(state);
        expect(host.types).toEqual(["Creature"]);
        expect(host.subtypes).toEqual(["Bear"]);
        expect(host.staticAbilities).not.toContain("crew 5");
        expect(getEffectiveActivatedAbilities(host)).toEqual([]);
    });

    it("CR 205.1a — a land creature stops being a land too, its land types with it", () => {
        const { host } = board(LAND_CREATURE_ID);
        expect(host.types).toEqual(["Artifact"]);
        expect(host.subtypes).toEqual(["Vehicle"]);
    });

    it("CR 702.122a — a Vehicle keeps its own crew beside crew N", () => {
        const { host } = board(PRINTED_VEHICLE_ID);
        expect(host.staticAbilities).toEqual(
            expect.arrayContaining(["crew 1", "crew 5"])
        );
        expect(
            getEffectiveActivatedAbilities(host).map((a) => a.ability.id)
        ).toEqual(
            expect.arrayContaining(["test-printed-vehicle-crew", CREW_ID])
        );
    });

    it("CR 301.7b — crewed, the host is an artifact creature with its printed P/T until end of turn", () => {
        const { state, host } = board(grizzlyBears().id);
        crew(state);
        expect(host.types).toEqual(["Artifact", "Creature"]);
        expect(host.power).toBe(2);
        expect(host.toughness).toBe(2);

        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(host.types).toEqual(["Artifact"]);
    });

    it("CR 205.1a — crewed, a creature host has its creature types back, for as long as it is a creature", () => {
        const { state, host } = board(grizzlyBears().id);
        crew(state);
        expect(host.subtypes).toEqual(["Bear", "Vehicle"]);

        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(host.subtypes).toEqual(["Vehicle"]);
    });

    it("CR 205.1a — crewed, a land creature has its creature types back and not its land types", () => {
        const { state, host } = board(LAND_CREATURE_ID);
        crew(state);
        expect(host.types).toEqual(["Artifact", "Creature"]);
        expect(host.subtypes).toEqual(["Dryad", "Vehicle"]);
    });

    it("CR 205.1a — the set replaces the artifact types: an Equipment stops being one, crewed or not", () => {
        const { state, host } = board(EQUIPMENT_CREATURE_ID);
        expect(host.subtypes).toEqual(["Vehicle"]);
        crew(state);
        expect(host.subtypes).toEqual(["Cat", "Vehicle"]);
    });

    it("CR 613.7 — the Aura arriving on a crewed Vehicle removes the creature type, and crewing again restores it", () => {
        const { state, host, aura } = board(PRINTED_VEHICLE_ID);
        removePermanentTo(state, aura.id, "graveyard");
        crew(state, "test-printed-vehicle-crew");
        expect(host.types).toContain("Creature");

        const second = {
            ...makeInstance(AURA_ID, {
                id: "aura-2",
                controllerId: "p1",
                ownerId: "p1",
            }),
            attachedTo: "host",
        };
        state.players[0].battlefield.push(second);
        beginApplyingStaticEffects(state, second);
        checkStateBasedActions(state);
        expect(host.types).toEqual(["Artifact"]);

        const pilot = state.players[0].battlefield.find(
            (c) => c.id === "pilot"
        )!;
        pilot.isTapped = false;
        crew(state);
        expect(host.types).toEqual(["Artifact", "Creature"]);
        expect(host.power).toBe(4);
    });

    it("CR 611.2a — crewing an indefinitely animated host lasts until end of turn, as the crew ability states", () => {
        const { state, host, aura } = board(PRINTED_VEHICLE_ID);
        removePermanentTo(state, aura.id, "graveyard");
        animatePermanentAsCreature(state, host, {}, "p1");
        const second = {
            ...makeInstance(AURA_ID, {
                id: "aura-2",
                controllerId: "p1",
                ownerId: "p1",
            }),
            attachedTo: "host",
        };
        state.players[0].battlefield.push(second);
        beginApplyingStaticEffects(state, second);
        checkStateBasedActions(state);
        expect(host.types).toEqual(["Artifact"]);

        crew(state);
        expect(host.types).toEqual(["Artifact", "Creature"]);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(host.types).toEqual(["Artifact"]);
    });

    it("CR 506.4 — an attacking creature that stops being a creature is removed from combat", () => {
        const { state, host, aura } = board(grizzlyBears().id);
        removePermanentTo(state, aura.id, "graveyard");
        checkStateBasedActions(state);
        host.isAttacking = true;
        state.combat = {
            attackerIds: ["host", "pilot"],
            blockerAssignments: {},
        } as unknown as GameState["combat"];

        const second = {
            ...makeInstance(AURA_ID, {
                id: "aura-2",
                controllerId: "p1",
                ownerId: "p1",
            }),
            attachedTo: "host",
        };
        state.players[0].battlefield.push(second);
        beginApplyingStaticEffects(state, second);
        checkStateBasedActions(state);

        expect(state.combat!.attackerIds).toEqual(["pilot"]);
        expect(host.isAttacking).toBeUndefined();
    });

    it("wire format — the client sees the type line, the keyword and the granted crew", () => {
        const { state } = board(grizzlyBears().id);
        const view = projectPublicState(state, 1, "p1");
        const host = view.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "host")!;
        expect(host.types).toEqual(["Artifact"]);
        expect(host.subtypes).toEqual(["Vehicle"]);
        expect(host.staticAbilities).toContain("crew 5");
        expect(host.grantedActivatedAbilities?.[0]?.abilityId).toBe(CREW_ID);
    });

    it("wire format — the client sees a crewed host's creature types return", () => {
        const { state } = board(grizzlyBears().id);
        crew(state);
        const view = projectPublicState(state, 1, "p1");
        const host = view.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "host")!;
        expect(host.types).toEqual(["Artifact", "Creature"]);
        expect(host.subtypes).toEqual(["Bear", "Vehicle"]);
    });
});

describe("animate — base P/T optional (CR 301.7b, issue #7212)", () => {
    it("validates both or neither, never one", () => {
        const target = { ref: "$source" };
        const errorsOf = (op: Record<string, unknown>) =>
            validateAbilityEffectScript({ id: "a", effects: [op] }, "test");
        expect(errorsOf({ op: "animate", target })).toEqual([]);
        expect(
            errorsOf({ op: "animate", target, power: 1, toughness: 1 })
        ).toEqual([]);
        expect(errorsOf({ op: "animate", target, power: 1 })).not.toEqual([]);
    });
});

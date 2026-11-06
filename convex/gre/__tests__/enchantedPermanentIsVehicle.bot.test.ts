// CR 702.122a / 613.7 (issue #7212) — Bot reachability of a crew ability an Aura
// grants: `enumerateMoves` offers it, and its self-animate guard stands down
// once a later type change has taken the animation's creature type away.
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
import {
    activateAbilityOnState,
    selectActivationCostOnState,
} from "../../game";
import { refreshExpectedInput } from "../expectedInput";
import { enumerateMoves } from "../moves";
import { checkStateBasedActions } from "../sba";
import {
    beginApplyingStaticEffects,
    resolveTopOfStack,
    type GameState,
} from "../state";

const AURA_ID = "test-bot-vehicle-aura";
const GRANTED_CREW = "test-bot-vehicle-aura-crew";
const PRINTED_CREW = "test-bot-printed-vehicle-crew";
const PILOT_ID = "test-bot-pilot";
const VEHICLE_ID = "test-bot-printed-vehicle";

registerTokenDefinition({
    id: AURA_ID,
    name: "Test Bot Vehicle Aura",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Artifact", count: 1 },
    ...enchantedPermanentIsVehicle({ name: "Test Bot Vehicle Aura", crew: 5 }),
});
registerTokenDefinition({
    id: PILOT_ID,
    name: "Test Bot Pilot",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 5,
    toughness: 5,
});
registerTokenDefinition(
    makeVehicle({
        id: VEHICLE_ID,
        name: "Test Bot Printed Vehicle",
        rarity: "common",
        manaCost: { X: 1 },
        oracleText: "Crew 1",
        power: 4,
        toughness: 3,
        crew: 1,
    })
);

const owned = (cardId: string, id: string) =>
    makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" });

function attachAura(state: GameState): void {
    const aura = { ...owned(AURA_ID, "aura"), attachedTo: "host" };
    state.players[0].battlefield.push(aura);
    beginApplyingStaticEffects(state, aura);
    checkStateBasedActions(state);
}

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    owned(VEHICLE_ID, "host"),
                    owned(PILOT_ID, "pilot"),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function crewedBoard(): GameState {
    const state = board();
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "host",
        abilityId: PRINTED_CREW,
    });
    selectActivationCostOnState(state, {
        playerId: "p1",
        cardInstanceId: "pilot",
    });
    resolveTopOfStack(state);
    state.priorityPlayerId = "p1";
    state.passCount = 0;
    state.players[0].battlefield.find((c) => c.id === "pilot")!.isTapped =
        false;
    refreshExpectedInput(state);
    return state;
}

const offers = (state: GameState, abilityId: string): boolean =>
    enumerateMoves(state, "p1").some(
        (m) => (m as { abilityId?: string }).abilityId === abilityId
    );

describe("crew granted by an Aura — Bot reachability (issue #7212)", () => {
    it("CR 702.122a — enumerateMoves offers the granted crew", () => {
        const state = board();
        attachAura(state);
        expect(offers(state, GRANTED_CREW)).toBe(true);
    });

    it("CR 611.1 — not offered on a Vehicle that is already crewed", () => {
        expect(offers(crewedBoard(), PRINTED_CREW)).toBe(false);
    });

    it("CR 613.7 — offered again once a later effect removed the creature type", () => {
        const state = crewedBoard();
        attachAura(state);
        expect(offers(state, GRANTED_CREW)).toBe(true);
    });
});

// Station (CR 702.184) and station cards (CR 721) — issue #10528.
//
// Full path: the station keyword ability announced and paid through the REAL
// game.ts entry points (`activateAbilityOnState`, `selectActivationCostOnState`),
// resolved by `resolveTopOfStack`, and the charge-gated striations read back
// through the layer system and the wire projection (`projectPublicState`).
//
// The synthetic station cards live in `cards/__tests__/station.helper.ts`.

import { describe, it, expect } from "vitest";
import type { GameState } from "../state";
import { removePermanentTo, resolveTopOfStack } from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { isCreature } from "../constants";
import {
    activateAbilityOnState,
    selectActivationCostOnState,
} from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { refreshExpectedInput } from "../expectedInput";
import { tryGetDefinition } from "../../cards";
import {
    CHARGE_COUNTER,
    STATION_ABILITY_ID,
    stationThresholdsViolation,
} from "../../cards/abilities/station";
import { activationPreconditionViolation } from "../activationPrecondition";
import {
    BEAR_ID,
    OX_ID,
    PLANET_ID,
    SPACECRAFT_ID,
} from "../../cards/__tests__/station.helper";

function stationBoard(
    stationCardId: string,
    opts: { charge?: number; creatures?: { id: string; cardId: string }[] } = {}
): GameState {
    const station = makeInstance(stationCardId, {
        id: "ship",
        controllerId: "p1",
        ownerId: "p1",
        // CR 613.7a — began applying as it entered (`beginApplyingStaticEffects`).
        staticSeq: 1,
        ...(opts.charge ? { counters: { [CHARGE_COUNTER]: opts.charge } } : {}),
    });
    const creatures = (
        opts.creatures ?? [
            { id: "bear", cardId: BEAR_ID },
            { id: "ox", cardId: OX_ID },
        ]
    ).map((c) =>
        makeInstance(c.cardId, { id: c.id, controllerId: "p1", ownerId: "p1" })
    );
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [station, ...creatures] }),
            makePlayer("p2"),
        ],
    });
}

const ship = (state: GameState) =>
    state.players[0].battlefield.find((c) => c.id === "ship")!;
const perm = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);

/** Announce the station ability and tap `tappedId` for its cost. */
function station(state: GameState, tappedId: string): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "ship",
        abilityId: STATION_ABILITY_ID,
    });
    selectActivationCostOnState(state, {
        playerId: "p1",
        cardInstanceId: tappedId,
    });
}

function resolveAndReturnPriority(state: GameState): void {
    resolveTopOfStack(state);
    state.priorityPlayerId = "p1";
    state.passCount = 0;
    refreshExpectedInput(state);
}

describe("Station — the keyword ability (CR 702.184a)", () => {
    it("taps another untapped creature and puts charge counters equal to its power on this permanent", () => {
        const state = stationBoard(SPACECRAFT_ID);
        station(state, "ox");
        expect(perm(state, "ox")!.isTapped).toBe(true);
        expect(state.stack).toHaveLength(1);
        resolveAndReturnPriority(state);
        expect(ship(state).counters?.[CHARGE_COUNTER]).toBe(4);
    });

    it("cannot tap the station permanent itself — 'another' creature (CR 702.184a)", () => {
        // The ship is a 6/6 artifact creature at 5+: a creature you control,
        // still never a legal pick for its own station cost.
        const state = stationBoard(SPACECRAFT_ID, { charge: 5 });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "ship",
            abilityId: STATION_ABILITY_ID,
        });
        expect(() =>
            selectActivationCostOnState(state, {
                playerId: "p1",
                cardInstanceId: "ship",
            })
        ).toThrow(/Cannot tap the ability's own source/);
    });

    it("cannot be activated with no other untapped creature (CR 602.2b / 118.3)", () => {
        const state = stationBoard(SPACECRAFT_ID, { creatures: [] });
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "ship",
                abilityId: STATION_ABILITY_ID,
            })
        ).toThrow(/Not enough untapped permanents/);
    });

    it("activates only as a sorcery (CR 702.184a, CR 307.5)", () => {
        const state = stationBoard(SPACECRAFT_ID);
        state.phase = "BEGIN_COMBAT";
        refreshExpectedInput(state);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "ship",
                abilityId: STATION_ABILITY_ID,
            })
        ).toThrow();
        expect(ship(state).counters?.[CHARGE_COUNTER]).toBeUndefined();
    });

    it("reads the tapped creature's power as the ability resolves (CR 608.2h)", () => {
        const state = stationBoard(SPACECRAFT_ID);
        station(state, "bear");
        // In response, the tapped Bear grows to 4/4.
        perm(state, "bear")!.counters = { "+1/+1": 2 };
        resolveAndReturnPriority(state);
        expect(ship(state).counters?.[CHARGE_COUNTER]).toBe(4);
    });

    it("uses the tapped creature's last known power once it has left the battlefield (CR 608.2h)", () => {
        const state = stationBoard(SPACECRAFT_ID);
        station(state, "bear");
        perm(state, "bear")!.counters = { "+1/+1": 1 };
        removePermanentTo(state, "bear", "graveyard");
        resolveAndReturnPriority(state);
        expect(ship(state).counters?.[CHARGE_COUNTER]).toBe(3);
    });

    it("is had at every charge, below and above every symbol (CR 721.4)", () => {
        const state = stationBoard(SPACECRAFT_ID, { charge: 9 });
        station(state, "bear");
        resolveAndReturnPriority(state);
        expect(ship(state).counters?.[CHARGE_COUNTER]).toBe(11);
    });
});

describe("Station symbols (CR 721.2)", () => {
    it("below N+ the striation's abilities and P/T box do not apply (CR 721.2a/b)", () => {
        const state = stationBoard(SPACECRAFT_ID, { charge: 4 });
        expect(isCreature(ship(state))).toBe(false);
        expect(ship(state).staticAbilities.includes("flying")).toBe(false);
    });

    it("at N+ it is an artifact creature with the box's base P/T and the striation's keywords (CR 721.2b)", () => {
        const state = stationBoard(SPACECRAFT_ID);
        station(state, "ox");
        resolveAndReturnPriority(state);
        expect(isCreature(ship(state))).toBe(false);
        station(state, "bear");
        resolveAndReturnPriority(state);
        // 4 + 2 = 6 charge counters: past the 5+ symbol.
        const s = ship(state);
        expect(isCreature(s)).toBe(true);
        expect(s.types).toContain("Artifact");
        expect(getEffectivePower(state, s)).toBe(6);
        expect(getEffectiveToughness(state, s)).toBe(6);
        expect(s.staticAbilities.includes("flying")).toBe(true);
        expect(s.staticAbilities.includes("trample")).toBe(true);
    });

    it("a station card has no power or toughness outside the battlefield (CR 721.2c)", () => {
        const def = tryGetDefinition(SPACECRAFT_ID)!;
        expect(def.power).toBeUndefined();
        expect(def.toughness).toBeUndefined();
        const state = stationBoard(SPACECRAFT_ID);
        state.players[0].hand.push(
            makeInstance(SPACECRAFT_ID, {
                id: "ship-in-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const projected = projectPublicState(state, 1, "p1");
        const inHand = projected.players[0].hand.find(
            (c) => c.id === "ship-in-hand"
        ) as { power?: number; toughness?: number } | undefined;
        expect(inHand?.power).toBeUndefined();
        expect(inHand?.toughness).toBeUndefined();
    });

    it("a striation's activated ability exists only at N+ (CR 721.2a)", () => {
        const def = tryGetDefinition(SPACECRAFT_ID)!;
        const draw = def.activatedAbilities!.find(
            (a) => a.id === "test-station-draw"
        )!;
        const low = stationBoard(SPACECRAFT_ID, { charge: 1 });
        expect(activationPreconditionViolation(low, ship(low), draw)).toMatch(
            /cannot be activated/
        );
        expect(() =>
            activateAbilityOnState(low, {
                playerId: "p1",
                cardInstanceId: "ship",
                abilityId: "test-station-draw",
            })
        ).toThrow();
        const high = stationBoard(SPACECRAFT_ID, { charge: 2 });
        expect(activationPreconditionViolation(high, ship(high), draw)).toBe(
            null
        );
    });

    it("a striation's static applies only at N+ (CR 721.2a)", () => {
        const low = stationBoard(PLANET_ID, { charge: 2 });
        expect(getEffectivePower(low, perm(low, "bear")!)).toBe(2);
        const high = stationBoard(PLANET_ID, { charge: 3 });
        expect(getEffectivePower(high, perm(high, "bear")!)).toBe(3);
    });

    it("a striation's triggered ability triggers only at N+ (CR 721.2a, 603.2)", () => {
        const state = stationBoard(PLANET_ID);
        const life = state.players[0].life;
        // 2 charge: below 3+, the trigger is not an ability the planet has.
        station(state, "bear");
        resolveAndReturnPriority(state);
        expect(state.stack).toHaveLength(0);
        // 2 + 4 = 6: the counters are put on while it has 2, and the trigger
        // checks the permanent as it exists after the event (CR 603.2).
        station(state, "ox");
        resolveAndReturnPriority(state);
        expect(state.stack).toHaveLength(1);
        resolveAndReturnPriority(state);
        expect(state.players[0].life).toBe(life + 1);
    });

    it("refuses a malformed symbol set (CR 721.2)", () => {
        expect(stationThresholdsViolation([])).toMatch(/at least one/);
        expect(
            stationThresholdsViolation([{ charge: 5 }, { charge: 3 }])
        ).toMatch(/increasing order/);
        expect(
            stationThresholdsViolation([
                { charge: 3, creature: { power: 1, toughness: 1 } },
                { charge: 5, creature: { power: 2, toughness: 2 } },
            ])
        ).toMatch(/at most one/);
        expect(stationThresholdsViolation([{ charge: 1 }])).toBe(null);
    });
});

describe("Station — wire format (projectPublicState)", () => {
    it("projects the charge counters, the creature type, the box's P/T and the granted keywords", () => {
        const state = stationBoard(SPACECRAFT_ID, { charge: 7 });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ship"
        )!;
        expect(slim.counters?.[CHARGE_COUNTER]).toBe(7);
        expect(slim.types).toContain("Creature");
        expect(slim.types).toContain("Artifact");
        expect(slim.staticAbilities).toContain("flying");
        expect(slim.staticAbilities).toContain("trample");
    });

    it("below the symbol it projects a noncreature artifact", () => {
        const state = stationBoard(SPACECRAFT_ID, { charge: 4 });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ship"
        )!;
        expect(slim.types).not.toContain("Creature");
        expect(slim.staticAbilities).not.toContain("flying");
    });
});

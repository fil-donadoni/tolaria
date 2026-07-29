// Vehicles (CR 301.7) + the Crew keyword ability (CR 702.122) — issue #777.
//
// Full-path coverage of the mechanic: the shared cost predicates
// (`gre/tapOtherCost.ts`), announcement/legality and the pick→commit cycle
// through the REAL game.ts entry points (`activateAbilityOnState`,
// `selectActivationCostOnState`), resolution via `resolveTopOfStack`, the
// CR 514.2 cleanup revert, and the wire-format projection.

import { describe, it, expect } from "vitest";
import type { GameState } from "../state";
import { resolveTopOfStack } from "../state";
import { finalizeCleanup } from "../phases";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { isCreature } from "../constants";
import {
    canPayTapOtherCost,
    crewPowerContribution,
    isTapOtherChoicePaid,
    isTapOtherSelectionComplete,
    pickTapOtherPayment,
    tapOtherRemaining,
    totalTapOtherPower,
} from "../tapOtherCost";
import {
    activateAbilityOnState,
    finalizeTargetSelection,
    selectActivationCostOnState,
} from "../../game";
import type { PendingTarget } from "../state";
import { projectPublicState } from "../../gameProjections";
import { smugglersCopter } from "../../cards/sets/kld";
import { grizzlyBears, savannahLions } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { refreshExpectedInput } from "../expectedInput";
import { registerTokenDefinition } from "../../cards";
import { makeVehicle } from "../../cards/abilities/vehicle";

/** Hands priority back to p1 after a resolution (the engine passes it to the
 *  non-active player once an item resolves) so a second activation is legal. */
function restorePriorityToP1(state: GameState): void {
    state.priorityPlayerId = "p1";
    state.passCount = 0;
    refreshExpectedInput(state);
}

const CREW_ABILITY_ID = "smugglers-copter-crew";

/** Copter + the requested creatures under p1. `sick` marks a creature that
 *  entered this turn (CR 302.6 summoning sickness). */
function crewBoard(
    creatures: ReadonlyArray<{ id: string; cardId: string; tapped?: boolean }>,
    opts: { copterTapped?: boolean } = {}
): GameState {
    const copter = makeInstance(smugglersCopter.id, {
        id: "copter",
        controllerId: "p1",
        ownerId: "p1",
        isTapped: opts.copterTapped === true,
    });
    const perms = creatures.map((c) =>
        makeInstance(c.cardId, {
            id: c.id,
            controllerId: "p1",
            ownerId: "p1",
            isTapped: c.tapped === true,
        })
    );
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [copter, ...perms] }),
            makePlayer("p2"),
        ],
    });
}

function copterOf(state: GameState) {
    return state.players[0].battlefield.find((c) => c.id === "copter")!;
}

// ===========================================================================
// Synthetic definitions. No printed card in the catalogue carries the
// CR 702.122b rider ("crews Vehicles as though its power were N greater",
// Shorikai's Pilot token) or a Crew value above 1 yet, so the multi-pick and
// rider paths are exercised against definitions registered into the live
// registry (the same escape hatch token synthesis uses) — these are the
// permanent tests for both, inherited free by the first card that ships them.
// ===========================================================================
const CREW_3_VEHICLE_ID = "test-crew-3-vehicle";
const CREW_3_ABILITY_ID = "test-crew-three-vehicle-crew";
const PILOT_ID = "test-crew-pilot";
const PLAIN_ONE_DROP_ID = "test-crew-plain-1-1";
const ZERO_POWER_ID = "test-crew-zero-power";

registerTokenDefinition(
    makeVehicle({
        id: CREW_3_VEHICLE_ID,
        name: "Test Crew Three Vehicle",
        rarity: "rare",
        manaCost: { X: 3 },
        oracleText: "Crew 3",
        power: 4,
        toughness: 4,
        crew: 3,
    })
);
registerTokenDefinition({
    id: PILOT_ID,
    name: "Test Pilot",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    subtypes: ["Pilot"],
    power: 1,
    toughness: 1,
    // CR 702.122b — counts as power 3 while crewing, power 1 everywhere else.
    crewPowerBonus: 2,
});
registerTokenDefinition({
    id: PLAIN_ONE_DROP_ID,
    name: "Test Plain One Drop",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
});
/** A 0/1 — a creature that is a legal PICK but contributes nothing, so a pool
 *  made only of these is a non-empty board that still can't reach Crew 1. */
registerTokenDefinition({
    id: ZERO_POWER_ID,
    name: "Test Zero Power Creature",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Creature"],
    power: 0,
    toughness: 1,
});

/** The Crew 3 Vehicle plus the requested creatures under p1. */
function crewThreeBoard(
    creatures: ReadonlyArray<{ id: string; cardId: string }>
): GameState {
    const vehicle = makeInstance(CREW_3_VEHICLE_ID, {
        id: "vehicle",
        controllerId: "p1",
        ownerId: "p1",
    });
    const perms = creatures.map((c) =>
        makeInstance(c.cardId, {
            id: c.id,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [vehicle, ...perms] }),
            makePlayer("p2"),
        ],
    });
}

/** Announce the crew ability, then feed the picker one creature at a time.
 *  Both steps run the REAL game.ts code (no mirrored validation). */
function crewWith(state: GameState, pickIds: readonly string[]): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "copter",
        abilityId: CREW_ABILITY_ID,
    });
    for (const id of pickIds) {
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: id,
        });
    }
}

// ===========================================================================
describe("tap-other cost predicates (CR 602.1 / 118.8, CR 702.122a)", () => {
    it("fixed-cardinal shape counts picks, total-power shape sums power", () => {
        const picks = [
            { id: "a", power: 2 },
            { id: "b", power: 1 },
        ];
        expect(totalTapOtherPower(picks)).toBe(3);
        expect(isTapOtherSelectionComplete({ count: 3 }, picks)).toBe(false);
        expect(isTapOtherSelectionComplete({ count: 2 }, picks)).toBe(true);
        expect(isTapOtherSelectionComplete({ totalPower: 3 }, picks)).toBe(
            true
        );
        expect(isTapOtherSelectionComplete({ totalPower: 4 }, picks)).toBe(
            false
        );
    });

    it("CR 702.122a — 'N or greater': exactly N pays, N-1 does not", () => {
        const one = [{ id: "a", power: 1 }];
        expect(canPayTapOtherCost({ totalPower: 1 }, one)).toBe(true);
        expect(canPayTapOtherCost({ totalPower: 2 }, one)).toBe(false);
        expect(
            canPayTapOtherCost({ totalPower: 2 }, [{ id: "a", power: 3 }])
        ).toBe(true);
    });

    it("CR 702.122b — crewPowerBonus adds to the crew contribution only", () => {
        expect(crewPowerContribution(1, 2)).toBe(3);
        expect(crewPowerContribution(1)).toBe(1);
    });

    it("a 0-power creature contributes 0 and is never greedily picked", () => {
        const pool = [
            { id: "zero", power: 0 },
            { id: "two", power: 2 },
        ];
        expect(canPayTapOtherCost({ totalPower: 3 }, pool)).toBe(false);
        expect(pickTapOtherPayment({ totalPower: 2 }, pool)).toEqual([
            { id: "two", power: 2 },
        ]);
    });

    it("the bot's deterministic payment taps the fewest (highest-power) creatures", () => {
        const pool = [
            { id: "a", power: 1 },
            { id: "b", power: 4 },
            { id: "c", power: 2 },
        ];
        expect(pickTapOtherPayment({ totalPower: 4 }, pool)).toEqual([
            { id: "b", power: 4 },
        ]);
        // Fixed-cardinal keeps the historical first-N behaviour.
        expect(
            pickTapOtherPayment({ count: 2 }, pool).map((c) => c.id)
        ).toEqual(["a", "b"]);
        // Unpayable pool → no partial payment.
        expect(pickTapOtherPayment({ totalPower: 99 }, pool)).toEqual([]);
    });

    it("the client-side picker predicate reads the server's pickedPower mirror", () => {
        expect(isTapOtherChoicePaid({ totalPower: 3, pickedIds: ["a"] })).toBe(
            false
        );
        expect(
            isTapOtherChoicePaid({
                totalPower: 3,
                pickedIds: ["a"],
                pickedPower: 3,
            })
        ).toBe(true);
        expect(isTapOtherChoicePaid({ count: 1, pickedIds: ["a"] })).toBe(true);
        expect(tapOtherRemaining({ totalPower: 8 }, 1, 3)).toEqual({
            kind: "power",
            remaining: 5,
        });
        expect(tapOtherRemaining({ count: 3 }, 1, 0)).toEqual({
            kind: "count",
            remaining: 2,
        });
    });
});

// ===========================================================================
describe("Vehicle is not a creature until crewed (CR 301.7 / 301.7a)", () => {
    it("the printed definition is an Artifact — Vehicle with printed P/T", () => {
        expect(smugglersCopter.types).toEqual(["Artifact"]);
        expect(smugglersCopter.types).not.toContain("Creature");
        expect(smugglersCopter.subtypes).toEqual(["Vehicle"]);
        expect(smugglersCopter.power).toBe(3);
        expect(smugglersCopter.toughness).toBe(3);
        // CR 702.122 — the board-visible keyword string AND its enforcing
        // activated ability both ship from one `makeVehicle` call.
        expect(smugglersCopter.staticAbilities).toContain("crew 1");
        expect(smugglersCopter.staticAbilities).toContain("flying");
        const crew = smugglersCopter.activatedAbilities!.find(
            (a) => a.id === CREW_ABILITY_ID
        )!;
        expect(crew.cost.tapOtherFilter).toEqual({
            filter: { types: "Creature", controllerRelation: "you" },
            totalPower: 1,
        });
        expect(crew.cost.tap).toBeUndefined();
    });

    it("an uncrewed Vehicle on the battlefield is not a creature", () => {
        const state = crewBoard([]);
        expect(isCreature(copterOf(state))).toBe(false);
    });
});

// ===========================================================================
describe("Crew N (CR 702.122a)", () => {
    it("taps the chosen creature and turns the Vehicle into an artifact creature", () => {
        // Savannah Lions is a 2/1 — one creature covers Crew 1.
        const state = crewBoard([{ id: "lion", cardId: savannahLions.id }]);
        crewWith(state, ["lion"]);

        // The picker auto-commits at the threshold: cost paid, ability on the
        // stack, chosen creature tapped, Vehicle NOT tapped (crew has no {T}).
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        const lion = state.players[0].battlefield.find((c) => c.id === "lion")!;
        expect(lion.isTapped).toBe(true);
        expect(copterOf(state).isTapped).toBe(false);
        // Still not a creature — the ability has not resolved yet (CR 608.2).
        expect(isCreature(copterOf(state))).toBe(false);

        resolveTopOfStack(state);
        const copter = copterOf(state);
        expect(isCreature(copter)).toBe(true);
        expect(copter.types).toContain("Artifact");
        expect(copter.subtypes).toContain("Vehicle");
        // CR 301.7b — it immediately has its PRINTED power and toughness.
        expect(getEffectivePower(state, copter)).toBe(3);
        expect(getEffectiveToughness(state, copter)).toBe(3);
    });

    it("an EMPTY board cannot be announced (CR 602.5b)", () => {
        const state = crewBoard([]);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "copter",
                abilityId: CREW_ABILITY_ID,
            })
        ).toThrow(/Not enough untapped permanents/);
    });

    it("a pool of creatures whose TOTAL power is below N cannot be announced (CR 602.5b)", () => {
        // Two untapped, legally-matching 0/1s — a non-empty pool that still
        // sums to 0. The distinct failure from the empty board above: the
        // candidates exist and pass the filter, and it is the total-power
        // predicate alone that rejects the announcement.
        const state = crewBoard([
            { id: "zero-a", cardId: ZERO_POWER_ID },
            { id: "zero-b", cardId: ZERO_POWER_ID },
        ]);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "copter",
                abilityId: CREW_ABILITY_ID,
            })
        ).toThrow(/Not enough untapped permanents/);
        // Nothing was tapped and no picker was opened by the failed attempt.
        expect(state.pendingActivation).toBeUndefined();
        expect(
            state.players[0].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(0);
    });

    it("an already-tapped creature can't pay (CR 702.122a 'untapped')", () => {
        const state = crewBoard([
            { id: "lion", cardId: savannahLions.id, tapped: true },
        ]);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "copter",
                abilityId: CREW_ABILITY_ID,
            })
        ).toThrow(/Not enough untapped permanents/);
    });

    it("a SUMMONING-SICK creature CAN crew (CR 302.6 governs its own {T} only)", () => {
        const state = crewBoard([{ id: "lion", cardId: savannahLions.id }]);
        state.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!.isSummoningSick = true;
        crewWith(state, ["lion"]);
        resolveTopOfStack(state);
        expect(isCreature(copterOf(state))).toBe(true);
    });

    it("the Vehicle itself is never a legal pick (CR 702.122a 'other')", () => {
        const state = crewBoard([{ id: "bear", cardId: grizzlyBears.id }]);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "copter",
            abilityId: CREW_ABILITY_ID,
        });
        expect(() =>
            selectActivationCostOnState(state, {
                playerId: "p1",
                cardInstanceId: "copter",
            })
        ).toThrow(/Cannot tap the ability's own source/);
    });

    it("a tapped Vehicle can still be crewed (crew has no {T} on the source)", () => {
        const state = crewBoard([{ id: "bear", cardId: grizzlyBears.id }], {
            copterTapped: true,
        });
        crewWith(state, ["bear"]);
        resolveTopOfStack(state);
        const copter = copterOf(state);
        expect(isCreature(copter)).toBe(true);
        expect(copter.isTapped).toBe(true);
    });

    it("crewing an already-crewed Vehicle is a legal no-op (CR 702.122a)", () => {
        const state = crewBoard([
            { id: "bear-a", cardId: grizzlyBears.id },
            { id: "bear-b", cardId: grizzlyBears.id },
        ]);
        crewWith(state, ["bear-a"]);
        resolveTopOfStack(state);
        expect(isCreature(copterOf(state))).toBe(true);

        restorePriorityToP1(state);
        crewWith(state, ["bear-b"]);
        resolveTopOfStack(state);
        const copter = copterOf(state);
        expect(isCreature(copter)).toBe(true);
        // Exactly one "Creature" entry — the second animation is skipped by the
        // one-animation-at-a-time guard, not stacked.
        expect(copter.types.filter((t) => t === "Creature")).toHaveLength(1);
        expect(getEffectivePower(state, copter)).toBe(3);
    });
});

// ===========================================================================
describe("crew payment accumulates until the threshold (CR 702.122a)", () => {
    it("Crew 3 needs TWO 2/2s: the picker stays open after the first pick", () => {
        // Two 2/2 Grizzly Bears against Crew 3 — neither pays alone, and the
        // pair overshoots. This is the accumulation branch: pick, picker still
        // open with the running total mirrored, pick again, commit.
        const state = crewThreeBoard([
            { id: "b1", cardId: grizzlyBears.id },
            { id: "b2", cardId: grizzlyBears.id },
        ]);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "vehicle",
            abilityId: CREW_3_ABILITY_ID,
        });
        const opened = state.pendingActivation!.tapOtherChoice!;
        expect(opened.totalPower).toBe(3);
        expect(opened.pickedPower).toBe(0);
        expect(opened.pickedIds).toEqual([]);
        // CR 118.8 — with zero picks the cost is emphatically NOT paid.
        expect(isTapOtherChoicePaid(opened)).toBe(false);

        // Pick 1: 2 of 3. Still short, so the picker survives and the ability
        // has NOT gone on the stack.
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: "b1",
        });
        const afterFirst = state.pendingActivation!.tapOtherChoice!;
        expect(afterFirst.pickedIds).toEqual(["b1"]);
        expect(afterFirst.pickedPower).toBe(2);
        expect(isTapOtherChoicePaid(afterFirst)).toBe(false);
        expect(tapOtherRemaining({ totalPower: 3 }, 1, 2)).toEqual({
            kind: "power",
            remaining: 1,
        });
        expect(state.stack).toHaveLength(0);
        // Nothing is tapped yet — the picks are only paid at commit (CR 601.2h).
        expect(
            state.players[0].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(0);

        // Pick 2: 4 ≥ 3 → auto-commit. Both picks are tapped, the Vehicle is
        // not (crew carries no {T} on the source), the ability is on the stack.
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: "b2",
        });
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(
            state.players[0].battlefield
                .filter((c) => c.isTapped)
                .map((c) => c.id)
                .sort()
        ).toEqual(["b1", "b2"]);

        resolveTopOfStack(state);
        const vehicle = state.players[0].battlefield.find(
            (c) => c.id === "vehicle"
        )!;
        expect(isCreature(vehicle)).toBe(true);
    });

    it("a single 2/2 clears Crew 1 on the first pick (auto-commit)", () => {
        const state = crewBoard([{ id: "b1", cardId: grizzlyBears.id }]);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "copter",
            abilityId: CREW_ABILITY_ID,
        });
        const toc = state.pendingActivation!.tapOtherChoice!;
        expect(toc.totalPower).toBe(1);
        expect(toc.pickedPower).toBe(0);
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: "b1",
        });
        expect(state.pendingActivation).toBeUndefined();
        expect(
            state.players[0].battlefield
                .filter((c) => c.isTapped)
                .map((c) => c.id)
        ).toEqual(["b1"]);
    });

    it("the picker rejects a second pick once the cost is paid", () => {
        const state = crewBoard([
            { id: "bear-a", cardId: grizzlyBears.id },
            { id: "bear-b", cardId: grizzlyBears.id },
        ]);
        crewWith(state, ["bear-a"]);
        // Cost already paid and committed — there is no picker left at all.
        expect(state.pendingActivation).toBeUndefined();
        expect(
            () =>
                selectActivationCostOnState(state, {
                    playerId: "p1",
                    cardInstanceId: "bear-b",
                })
            // The activation has fully committed and priority has moved on —
            // there is no picker left to feed (the exact error depends on
            // which guard fires first, ADR 0047's expected-input check or the
            // picker's own).
        ).toThrow();
    });
});

// ===========================================================================
describe("crewed until end of turn (CR 702.122a / 514.2)", () => {
    it("the animation reverts at cleanup — the Vehicle is a non-creature again", () => {
        const state = crewBoard([{ id: "bear", cardId: grizzlyBears.id }]);
        crewWith(state, ["bear"]);
        resolveTopOfStack(state);
        expect(isCreature(copterOf(state))).toBe(true);

        // CR 514.2 — the "until end of turn" boundary is CLEANUP.
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        const copter = copterOf(state);
        expect(isCreature(copter)).toBe(false);
        expect(copter.types).toEqual(["Artifact"]);
        expect(copter.subtypes).toEqual(["Vehicle"]);
    });
});

// ===========================================================================
describe("wire format — crewed Vehicle survives the projection", () => {
    it("projectPublicState preserves the creature type and printed P/T", () => {
        const state = crewBoard([{ id: "bear", cardId: grizzlyBears.id }]);
        crewWith(state, ["bear"]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "copter"
        )!;
        expect(slim.types).toContain("Creature");
        expect(slim.types).toContain("Artifact");
        expect(slim.subtypes).toContain("Vehicle");
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
        // Flying survives too — a crewed Copter is an evasive attacker.
        expect(slim.staticAbilities).toContain("flying");
    });

    it("an UNCREWED Vehicle projects as a non-creature", () => {
        const state = crewBoard([]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "copter"
        )!;
        expect(slim.types).not.toContain("Creature");
    });
});

describe("crewPowerBonus rider (CR 702.122b)", () => {
    it("a 1/1 with 'crews as though its power were 2 greater' pays Crew 3 alone", () => {
        const state = crewThreeBoard([{ id: "pilot", cardId: PILOT_ID }]);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "vehicle",
            abilityId: CREW_3_ABILITY_ID,
        });
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: "pilot",
        });
        expect(state.pendingActivation).toBeUndefined();
        resolveTopOfStack(state);
        const vehicle = state.players[0].battlefield.find(
            (c) => c.id === "vehicle"
        )!;
        expect(isCreature(vehicle)).toBe(true);
        // The rider is crew-only — the Pilot's real power is untouched.
        const pilot = state.players[0].battlefield.find(
            (c) => c.id === "pilot"
        )!;
        expect(getEffectivePower(state, pilot)).toBe(1);
    });

    it("an identical 1/1 WITHOUT the rider can't pay Crew 3 (CR 602.5b)", () => {
        const state = crewThreeBoard([
            { id: "pilot", cardId: PLAIN_ONE_DROP_ID },
        ]);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "vehicle",
                abilityId: CREW_3_ABILITY_ID,
            })
        ).toThrow(/Not enough untapped permanents/);
    });
});

// ===========================================================================
// CR 602.1 / 118.8 / 702.122a — the TARGETED activation path
// (`finalizeTargetSelection`) must open the very same picker the non-targeted
// path does. It used to build its own `pendingActivation` literal and copied
// only the fixed-cardinal `count`, so a `totalPower` spec arrived as
// `{ count: undefined, totalPower: undefined }` — `isTapOtherSelectionComplete`
// then fell through to `pickedIds.length >= (count ?? 0)` and declared the cost
// PAID with zero picks: the ability committed for free and every subsequent
// pick threw "Tap cost already paid". Both sites now build the descriptor
// through `buildPendingActivation`, and this is that fix's regression test.
// ===========================================================================
const TARGETED_CREW_ID = "test-targeted-total-power-source";
const TARGETED_CREW_ABILITY_ID = "test-targeted-total-power-crew";

registerTokenDefinition({
    id: TARGETED_CREW_ID,
    name: "Test Targeted Total Power Source",
    rarity: "rare",
    manaCost: { X: 2 },
    types: ["Artifact"],
    subtypes: ["Vehicle"],
    oracleText:
        "Tap any number of untapped creatures you control with total power 3 or greater: This permanent becomes an artifact creature until end of turn. It fights nothing; the target only pins the ability to the targeted activation path.",
    power: 4,
    toughness: 4,
    activatedAbilities: [
        {
            id: TARGETED_CREW_ABILITY_ID,
            oracleText: "Crew 3, targeting a creature.",
            cost: {
                tapOtherFilter: {
                    filter: { types: "Creature", controllerRelation: "you" },
                    totalPower: 3,
                },
            },
            // The target is the whole point of the fixture: it routes the
            // activation through `pendingTarget` → `finalizeTargetSelection`
            // instead of the direct `activateAbility` commit.
            targetRequirement: { type: "Creature", count: 1 },
            useStack: true,
            effects: [
                {
                    op: "animate",
                    target: { ref: "$source" },
                    power: 4,
                    toughness: 4,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
});

describe("targeted totalPower activation (CR 602.1 / 118.8 / 702.122a)", () => {
    function targetedBoard(): GameState {
        const source = makeInstance(TARGETED_CREW_ID, {
            id: "source",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bears = ["b1", "b2"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [source, ...bears] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
    }

    /** Drives target selection through the REAL commit path. */
    function finalize(state: GameState): void {
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "source",
            kind: "ability",
            abilityId: TARGETED_CREW_ABILITY_ID,
            targetType: "Creature",
            count: 1,
            selected: [{ type: "permanent", id: "victim" }],
        };
        finalizeTargetSelection(state, pt, "p1");
    }

    it("opens a totalPower picker that is NOT paid with zero picks", () => {
        const state = targetedBoard();
        finalize(state);
        const toc = state.pendingActivation!.tapOtherChoice!;
        // The totalPower shape survives the targeted path…
        expect(toc.totalPower).toBe(3);
        expect(toc.count).toBeUndefined();
        expect(toc.pickedPower).toBe(0);
        expect(toc.pickedIds).toEqual([]);
        // …so the cost is emphatically unpaid and nothing auto-committed.
        expect(isTapOtherChoicePaid(toc)).toBe(false);
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[0].battlefield.filter((c) => c.isTapped)
        ).toHaveLength(0);
    });

    it("accumulates picks and commits carrying the chosen targets", () => {
        const state = targetedBoard();
        finalize(state);
        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: "b1",
        });
        // 2 of 3 — still open, still nothing on the stack.
        expect(state.pendingActivation!.tapOtherChoice!.pickedPower).toBe(2);
        expect(state.stack).toHaveLength(0);

        selectActivationCostOnState(state, {
            playerId: "p1",
            cardInstanceId: "b2",
        });
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        // CR 602.2b — the targets chosen before the picker opened ride to the
        // stack item through the deferred payment.
        expect(state.stack[0].targets).toEqual([
            { type: "permanent", id: "victim" },
        ]);
        expect(
            state.players[0].battlefield
                .filter((c) => c.isTapped)
                .map((c) => c.id)
                .sort()
        ).toEqual(["b1", "b2"]);
    });
});

// Pure `buildStateFromScenario` builder (issue #1424, PRD #1423).
//
// Factored out of the `debugSetupScenario` Convex mutation
// (`convex/game.ts`) so it's callable from vitest with no Convex runtime.
// The mutation now delegates its ENTIRE state-construction logic to this
// function — these tests are the source of truth for that logic, no longer
// exercised only indirectly through a Convex mutation test. Representative
// `ScenarioSpec`s cover cards/zones, phase, landCount and rngSeed (the
// acceptance criteria's named axes), plus the base-state-is-not-mutated
// contract the pure signature promises.

import { describe, expect, it } from "vitest";
import { buildStateFromScenario } from "../scenarioBuilder";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { shivanDragon } from "../../cards/sets/lea/red";
import type { ScenarioSpec } from "../../debugScenarioSpec";

describe("buildStateFromScenario (issue #1424)", () => {
    it("places cards into the requested zones for the requested owner", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                { name: grizzlyBears.name, owner: "me", zone: "battlefield" },
                { name: grizzlyBears.name, owner: "opp", zone: "hand" },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        expect(state.players[0].battlefield).toHaveLength(1);
        expect(
            (state.players[0].battlefield[0].card as { id: string }).id
        ).toBe(grizzlyBears.id);
        expect(state.players[0].battlefield[0].controllerId).toBe(
            state.players[0].id
        );
        expect(state.players[1].hand).toHaveLength(1);
        expect((state.players[1].hand[0].card as { id: string }).id).toBe(
            grizzlyBears.id
        );
    });

    it("honors `tapped` and `count`, and resets zones the scenario didn't touch", () => {
        const base = makeState({
            players: [
                makePlayer("p1", {
                    // A stale battlefield/graveyard from before the scenario
                    // was applied — must be cleared, not merged.
                    battlefield: [
                        {
                            id: "stale",
                            card: { id: grizzlyBears.id },
                            types: ["Creature"],
                            subtypes: [],
                            staticAbilities: [],
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                            isTapped: false,
                        },
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: grizzlyBears.name,
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                    count: 3,
                },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        expect(state.players[0].battlefield).toHaveLength(3);
        expect(
            state.players[0].battlefield.every((c) => c.isTapped === true)
        ).toBe(true);
        // The stale pre-scenario instance must be gone, not merged in.
        expect(
            state.players[0].battlefield.some((c) => c.id === "stale")
        ).toBe(false);
    });

    it("seeds `landCount` basic lands per player, colour-matched to the placed cards", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [{ name: shivanDragon.name, owner: "me" }],
            landCount: 4,
        };

        const state = buildStateFromScenario(base, spec);

        // 1 Shivan Dragon + 4 lands on "me"'s battlefield; 4 lands on "opp"'s.
        expect(state.players[0].battlefield).toHaveLength(5);
        expect(state.players[1].battlefield).toHaveLength(4);
        const lands = state.players[0].battlefield.filter(
            (c) => (c.card as { id: string }).id !== shivanDragon.id
        );
        expect(lands).toHaveLength(4);
        // Shivan Dragon is mono-red — the seeded basics must be Mountains.
        for (const land of lands) {
            expect(land.subtypes).toContain("Mountain");
        }
    });

    it("sets `phase` and `turn`, seeding combat state for DECLARE_ATTACKERS", () => {
        const base = makeState({ phase: "PRECOMBAT_MAIN", turn: 1 });
        const spec: ScenarioSpec = {
            cards: [],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
        };

        const state = buildStateFromScenario(base, spec);

        expect(state.phase).toBe("DECLARE_ATTACKERS");
        expect(state.turn).toBe(5);
        expect(state.combat).toEqual({
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        });
    });

    it("pins `rngSeed` and resets `rngCounter` (CR 705 / ADR 0023)", () => {
        const base = makeState({ rngSeed: 42, rngCounter: 7 });
        const spec: ScenarioSpec = { cards: [], rngSeed: 1 };

        const state = buildStateFromScenario(base, spec);

        expect(state.rngSeed).toBe(1);
        expect(state.rngCounter).toBe(0);
    });

    it("leaves `rngSeed` unchanged when the spec omits it", () => {
        const base = makeState({ rngSeed: 42, rngCounter: 7 });
        const spec: ScenarioSpec = { cards: [] };

        const state = buildStateFromScenario(base, spec);

        expect(state.rngSeed).toBe(42);
        expect(state.rngCounter).toBe(7);
    });

    it("does not mutate the base state passed in (pure function contract)", () => {
        const base = makeState();
        const baseSnapshot = structuredClone(base);
        const spec: ScenarioSpec = {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
            landCount: 2,
            phase: "DECLARE_ATTACKERS",
            rngSeed: 9,
        };

        buildStateFromScenario(base, spec);

        expect(base).toEqual(baseSnapshot);
    });
});

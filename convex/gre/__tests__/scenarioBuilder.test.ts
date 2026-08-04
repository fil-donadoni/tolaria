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
import { forest } from "../../cards/sets/lea/colorless";
import { fear } from "../../cards/sets/lea/black";
import { tokenDefinitionId, tryGetDefinition } from "../../cards";
import { findTokenSpec } from "../../cards/tokenCatalogue";
import { projectPublicState } from "../../gameProjections";
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
        expect(state.players[0].battlefield.some((c) => c.id === "stale")).toBe(
            false
        );
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

    it("clears a stale `combat` inherited from a mid-combat base state when the target phase doesn't re-seed it (issue #1432 review finding #3)", () => {
        const base = makeState({
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["stale-attacker"],
                confirmed: true,
                blockerAssignments: { "stale-attacker": ["stale-blocker"] },
                blockersConfirmed: false,
            },
        });
        const spec: ScenarioSpec = {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
            phase: "PRECOMBAT_MAIN",
        };

        const state = buildStateFromScenario(base, spec);

        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(state.combat).toBeUndefined();
    });

    it("clears a stale `combat` even when the spec doesn't override `phase` at all", () => {
        const base = makeState({
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["stale-attacker"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const spec: ScenarioSpec = { cards: [] };

        const state = buildStateFromScenario(base, spec);

        expect(state.combat).toBeUndefined();
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

    // #946 (CR 601.3e / 608.2g) — `castableFromExile` stamps a this-turn
    // play/cast-from-exile grant so the Debug panel can stage the affordance
    // directly. CR 305.9 (issue #1689) — the LAND-INCLUSIVE shape (Headliner
    // Scarlett / Expressive Iteration: "you may PLAY that card") is now an
    // explicit opt-in (`castableFromExileIncludesLand: true`) rather than
    // always-on, so the Debug panel can ALSO stage the cast-only shape below.
    it("`castableFromExile` + `castableFromExileIncludesLand` stamps a land-inclusive play/cast-from-exile grant (issue #1689)", () => {
        const base = makeState({ turn: 4 });
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: forest.name,
                    owner: "me",
                    zone: "exile",
                    castableFromExile: true,
                    castableFromExileIncludesLand: true,
                },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        const exiled = state.players[0].exile[0];
        expect(exiled.castableFromExileBy).toBe(state.players[0].id);
        expect(exiled.castableFromExileUntilTurn).toBe(4);
        expect(exiled.castableFromExileIncludesLand).toBe(true);
    });

    // CR 305.9 (issue #1689) — the DEFAULT shape (no
    // `castableFromExileIncludesLand`) is cast-only, mirroring the real-card
    // default (Ice Cauldron / Robber of the Rich / Ragavan): a land staged
    // this way must NOT be stamped land-inclusive, so the Debug panel can
    // reproduce the exact "no action at all" case this issue is about.
    it("`castableFromExile` alone (no includesLand) stamps a CAST-ONLY grant — a land gets no play permission", () => {
        const base = makeState({ turn: 4 });
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: forest.name,
                    owner: "me",
                    zone: "exile",
                    castableFromExile: true,
                },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        const exiled = state.players[0].exile[0];
        expect(exiled.castableFromExileBy).toBe(state.players[0].id);
        expect(exiled.castableFromExileIncludesLand).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Library seeding order — regression.
//
// `libraryCount` used to refill the libraries AFTER the placement loop, by
// assigning `player.library = []` and pushing basics: that silently DELETED
// every card the spec had placed in the `library` zone. Both fields are offered
// side by side in the Debug panel's save form, so the combination is the
// ordinary case ("stack the top of my library, and give me a deck to draw
// from"), and the symptom was a library card that simply never appeared.
// ---------------------------------------------------------------------------

describe("buildStateFromScenario — library placement + libraryCount", () => {
    it("keeps cards placed in the library when `libraryCount` also seeds filler basics", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: shivanDragon.name,
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
            ],
            libraryCount: 10,
        };

        const state = buildStateFromScenario(base, spec);

        const library = state.players[0].library;
        // 10 filler basics + the placed card, which sits on TOP (position 1 =
        // index 0, where `drawCard` reads).
        expect(library).toHaveLength(11);
        expect((library[0].card as { id: string }).id).toBe(shivanDragon.id);
        expect(
            library.filter(
                (c) => (c.card as { id: string }).id === shivanDragon.id
            )
        ).toHaveLength(1);
    });

    it("appends a library card to the BOTTOM of the filler pile when no position is given", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [{ name: shivanDragon.name, owner: "opp", zone: "library" }],
            libraryCount: 3,
        };

        const state = buildStateFromScenario(base, spec);

        const library = state.players[1].library;
        expect(library).toHaveLength(4);
        expect((library[3].card as { id: string }).id).toBe(shivanDragon.id);
    });

    it("still seeds the requested filler count when no card is placed in the library", () => {
        const base = makeState();
        const spec: ScenarioSpec = { cards: [], libraryCount: 5 };

        const state = buildStateFromScenario(base, spec);

        expect(state.players[0].library).toHaveLength(5);
        expect(state.players[1].library).toHaveLength(5);
    });
});

// ---------------------------------------------------------------------------
// Tokens on a scenario board (CR 111 / 707.2).
//
// A token has no `CardDefinition`, so it can't be placed by name like a card —
// the entry sets `token: true` and the builder creates it through the engine's
// own `createTokenPermanents`, resolving the shape from the token catalogue.
// ---------------------------------------------------------------------------

describe("buildStateFromScenario — tokens (CR 111 / 707.2)", () => {
    it("creates a token permanent on the battlefield with the catalogue's characteristics", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [{ name: "Wasp", owner: "me", token: true, count: 2 }],
        };

        const state = buildStateFromScenario(base, spec);

        const battlefield = state.players[0].battlefield;
        expect(battlefield).toHaveLength(2);
        for (const token of battlefield) {
            expect(token.isToken).toBe(true);
            expect(token.controllerId).toBe(state.players[0].id);
            expect(token.power).toBe(1);
            expect(token.toughness).toBe(1);
            expect(token.staticAbilities).toContain("flying");
            // The synthesized definition id (CR 707.1) — what the client reads
            // to render the token, art included.
            expect((token.card as { id: string }).id).toBe(
                tokenDefinitionId(findTokenSpec("Wasp")!)
            );
        }
    });

    it("stages an already-set-up board: a token is NOT summoning sick unless asked (CR 302.6)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                { name: "Wasp", owner: "me", token: true },
                {
                    name: "Wasp",
                    owner: "opp",
                    token: true,
                    summoningSick: true,
                },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        expect(state.players[0].battlefield[0].isSummoningSick).toBe(false);
        expect(state.players[1].battlefield[0].isSummoningSick).toBe(true);
    });

    // Issue #1824 — `isSummoningSick` and `enteredOnTurn` are two halves of
    // the SAME control-continuity clock, and only the latter is read by
    // `hasControlledSinceTurnStart` (which now backs a target filter, not just
    // a choice filter). Staging them inconsistently made a scenario board lie
    // to every continuity-sensitive card on it.
    it("keeps enteredOnTurn consistent with summoningSick for tokens (CR 302.6 / 400.7, issue #1824)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                { name: "Wasp", owner: "me", token: true },
                {
                    name: "Wasp",
                    owner: "opp",
                    token: true,
                    summoningSick: true,
                },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        // Staged as pre-existing: `createTokenPermanents`' entry stamp must be
        // cleared, or the token reads as having entered this turn.
        expect(state.players[0].battlefield[0].enteredOnTurn).toBeUndefined();
        // Staged as just-created: the stamp must be present and be THIS turn.
        expect(state.players[1].battlefield[0].enteredOnTurn).toBe(state.turn);
    });

    it("stamps enteredOnTurn for a summoning-sick NON-token permanent (issue #1824)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                { name: "Grizzly Bears", owner: "me" },
                { name: "Grizzly Bears", owner: "opp", summoningSick: true },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        // Pre-existing board: no stamp, so it reads as controlled since the
        // turn began.
        expect(state.players[0].battlefield[0].enteredOnTurn).toBeUndefined();
        // Explicitly staged as summoning-sick: the stamp must agree with the
        // flag, or `hasControlledSinceTurnStart` contradicts what the UI shows.
        expect(state.players[1].battlefield[0].isSummoningSick).toBe(true);
        expect(state.players[1].battlefield[0].enteredOnTurn).toBe(state.turn);
    });

    it("honors tapped / damage / counters on a token", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: "Wasp",
                    owner: "me",
                    token: true,
                    tapped: true,
                    damageMarked: 1,
                    counters: { "+1/+1": 2 },
                },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        const token = state.players[0].battlefield[0];
        expect(token.isTapped).toBe(true);
        expect(token.damageMarked).toBe(1);
        expect(token.counters).toEqual({ "+1/+1": 2 });
    });

    it("keeps a token's own activated abilities reachable (shared Treasure spec)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [{ name: "Treasure", owner: "me", token: true }],
        };

        const state = buildStateFromScenario(base, spec);

        const token = state.players[0].battlefield[0];
        const def = tryGetDefinition((token.card as { id: string }).id);
        expect(def?.activatedAbilities?.length).toBeGreaterThan(0);
    });

    it("does NOT leave a TOKENS_CREATED trigger event pending (a scenario places a board, it doesn't play one)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [{ name: "Wasp", owner: "me", token: true }],
        };

        const state = buildStateFromScenario(base, spec);

        expect(state.pendingEvents ?? []).toEqual([]);
    });

    it("attaches an Aura to a TOKEN host (CR 303.4)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                { name: "Wasp", owner: "me", token: true },
                {
                    name: fear.name,
                    owner: "me",
                    attachedTo: "Wasp",
                },
            ],
        };

        const state = buildStateFromScenario(base, spec);

        const battlefield = state.players[0].battlefield;
        const host = battlefield.find((c) => c.isToken)!;
        const aura = battlefield.find(
            (c) => (c.card as { id: string }).id === fear.id
        )!;
        expect(aura.attachedTo).toBe(host.id);
    });

    it("throws on an unknown token key (a spec error, not a silently empty board)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [{ name: "Not A Token", owner: "me", token: true }],
        };

        expect(() => buildStateFromScenario(base, spec)).toThrow(
            /Unknown token/
        );
    });

    it("survives the wire projection — the client can still resolve the token's definition", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [{ name: "Wasp", owner: "me", token: true }],
        };

        const state = buildStateFromScenario(base, spec);
        const projected = projectPublicState(state, 1, state.players[0].id);

        const slim = projected.players[0].battlefield[0];
        expect(slim.isToken).toBe(true);
        // The projection strips `card` down to `{ id }`, so the client rebuilds
        // the token's characteristics from the content-derived id alone
        // (`maybeSynthesizeToken`) — including its art.
        const synthesized = tryGetDefinition((slim.card as { id: string }).id);
        expect(synthesized?.name).toBe("Wasp");
        expect(synthesized?.imagePrintId).toBe(
            findTokenSpec("Wasp")!.imagePrintId
        );
    });
});

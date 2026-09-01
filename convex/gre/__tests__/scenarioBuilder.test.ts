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
import { buildStateFromScenario, specFromState } from "../scenarioBuilder";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { shivanDragon } from "../../cards/sets/lea/red";
import { forest } from "../../cards/sets/lea/colorless";
import { fear } from "../../cards/sets/lea/black";
import { tokenDefinitionId, tryGetDefinition } from "../../cards";
import { findTokenSpec } from "../../cards/tokenCatalogue";
import { projectFullState, projectPublicState } from "../../gameProjections";
import type { GameState, PendingChoice } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

describe("buildStateFromScenario (issue #1424)", () => {
    // CR 122.1 (issue #1969) — a debug scenario must be able to START at a
    // scaled experience total, otherwise the only way to see Otharri make more
    // than one token is to attack twice by hand. Part of the mechanic, not a
    // follow-up: the debug-scenario surface is one of the surfaces a whole
    // mechanic ships on.
    it("seeds experience counters on both seats (CR 122.1)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [],
            experience: { me: 3, opp: 1 },
        };

        const state = buildStateFromScenario(base, spec);

        expect(state.players[0].experienceCounters).toBe(3);
        expect(state.players[1].experienceCounters).toBe(1);
        // Never confused with the sibling player-counter scalars.
        expect(state.players[0].poisonCounters).toBeUndefined();
        expect(state.players[0].energyCounters).toBeUndefined();
    });

    it("leaves experience counters absent when the spec omits them", () => {
        const state = buildStateFromScenario(makeState(), { cards: [] });
        expect(state.players[0].experienceCounters).toBeUndefined();
        expect(state.players[1].experienceCounters).toBeUndefined();
    });

    // CR 119.1 (issue #2147) — every blade entry depending on a life total
    // (chump-block vs. race, burn the creature vs. the face, any lethal
    // check) was unpinnable before this: the built board always opened at
    // the base state's default life regardless of what the scenario asked
    // for.
    it("seeds life totals on both seats (CR 119.1)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [],
            life: { me: 4, opp: 17 },
        };

        const state = buildStateFromScenario(base, spec);

        expect(state.players[0].life).toBe(4);
        expect(state.players[1].life).toBe(17);
    });

    it("seeds only the requested seat, leaving the other at the base default", () => {
        const base = makeState();
        expect(base.players[0].life).toBe(20);
        expect(base.players[1].life).toBe(20);

        const state = buildStateFromScenario(base, {
            cards: [],
            life: { me: 3 },
        });

        expect(state.players[0].life).toBe(3);
        expect(state.players[1].life).toBe(20);
    });

    it("leaves life at the base state's default when the spec omits `life` entirely", () => {
        const state = buildStateFromScenario(makeState(), { cards: [] });
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });

    it("honors an explicit 0 life (a degenerate lethal-check position, not 'absent')", () => {
        const state = buildStateFromScenario(makeState(), {
            cards: [],
            life: { me: 0 },
        });
        expect(state.players[0].life).toBe(0);
        expect(state.players[1].life).toBe(20);
    });

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

    // #946 (CR 601.3 / 608.2g) — `castableFromExile` stamps a this-turn
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

// specFromState — lower a live position into a ScenarioSpec (issue #2148).
// The round-trip property test is the trust mechanism the issue asks for:
// `buildStateFromScenario(base, specFromState(s).spec)` must agree with `s`
// on every field the table in `buildStateFromScenario` consumes. The
// fingerprint helpers below read GROUND TRUTH directly off the GameState
// (never through `specFromState` itself) precisely so deleting a lowered
// field in `lowerCard` shows up as a real mismatch here, not as two
// consistently-wrong sides silently agreeing with each other.

function battlefieldFingerprint(state: GameState, seatIdx: 0 | 1): string[] {
    const bothBattlefields = [
        ...state.players[0].battlefield,
        ...state.players[1].battlefield,
    ];
    return state.players[seatIdx].battlefield
        .map((c) => {
            const host = c.attachedTo
                ? bothBattlefields.find((h) => h.id === c.attachedTo)
                : undefined;
            return JSON.stringify({
                defId: (c.card as { id?: string }).id ?? "",
                isToken: c.isToken ?? false,
                tapped: c.isTapped,
                counters: c.counters ?? {},
                damageMarked: c.damageMarked ?? 0,
                attackedLastTurn: c.attackedDuringLastTurn ?? false,
                summoningSick: c.isSummoningSick ?? false,
                faceDown: c.faceDown ?? false,
                copiedFrom: c.copiedFrom ?? null,
                attachedToDefId: host
                    ? ((host.card as { id?: string }).id ?? "")
                    : null,
            });
        })
        .sort();
}

function zoneFingerprint(
    state: GameState,
    seatIdx: 0 | 1,
    zone: "hand" | "graveyard" | "exile"
): string[] {
    const player = state.players[seatIdx];
    const list =
        zone === "hand"
            ? player.hand
            : zone === "graveyard"
              ? player.graveyard
              : player.exile;
    return list
        .map((c) =>
            JSON.stringify({
                defId: (c.card as { id?: string }).id ?? "",
                castableFromExile:
                    zone === "exile"
                        ? Boolean(c.castableFromExileBy)
                        : undefined,
                includesLand:
                    zone === "exile"
                        ? Boolean(c.castableFromExileIncludesLand)
                        : undefined,
                faceDownExile:
                    zone === "exile"
                        ? Boolean(c.knownTo?.includes(player.id))
                        : undefined,
            })
        )
        .sort();
}

describe("specFromState (issue #2148)", () => {
    function buildComprehensiveState(): {
        base: GameState;
        state: GameState;
    } {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: grizzlyBears.name,
                    owner: "me",
                    tapped: true,
                    counters: { "+1/+1": 2 },
                    damageMarked: 1,
                    attackedLastTurn: true,
                },
                { name: fear.name, owner: "me", attachedTo: grizzlyBears.name },
                { name: shivanDragon.name, owner: "me", faceDown: true },
                { name: forest.name, owner: "me", copyOf: shivanDragon.name },
                {
                    name: "Wasp",
                    owner: "me",
                    token: true,
                    tapped: true,
                    counters: { "+1/+1": 1 },
                    summoningSick: true,
                },
                { name: fear.name, owner: "me", attachedTo: "Wasp" },
                { name: grizzlyBears.name, owner: "opp", tapped: true },
                { name: shivanDragon.name, owner: "opp", summoningSick: true },
                { name: forest.name, owner: "me", zone: "hand" },
                { name: fear.name, owner: "me", zone: "hand" },
                { name: shivanDragon.name, owner: "me", zone: "graveyard" },
                {
                    name: grizzlyBears.name,
                    owner: "me",
                    zone: "exile",
                    castableFromExile: true,
                    castableFromExileIncludesLand: true,
                },
                { name: fear.name, owner: "opp", zone: "hand" },
                { name: forest.name, owner: "opp", zone: "graveyard" },
                {
                    name: shivanDragon.name,
                    owner: "opp",
                    zone: "exile",
                    castableFromExile: true,
                },
            ],
            turn: 5,
            phase: "POSTCOMBAT_MAIN",
            rngSeed: 777,
            poison: { me: 3, opp: 2 },
            life: { me: 12, opp: 8 },
            experience: { me: 2, opp: 1 },
            markLastDrawn: true,
            companion: { name: shivanDragon.name, owner: "me", used: false },
        };
        const state = buildStateFromScenario(base, spec);
        return { base, state };
    }

    it("round-trips battlefield/hand/graveyard/exile, tapped, counters, attachments, damage, phase, turn, poison, life, experience and companion", () => {
        const { base, state } = buildComprehensiveState();
        const mySeatId = state.players[0].id;

        const { spec: lowered, dropped } = specFromState(state, {
            mySeatId,
        });
        const rebuilt = buildStateFromScenario(base, lowered);

        // Nothing in this position is genuinely unlowerable — `dropped` must
        // stay empty. It must be silent EXACTLY when nothing was silently
        // lost (the flip side of the feature: see the `dropped`-reporting
        // tests below for the case where it must NOT be empty).
        expect(dropped).toEqual([]);

        expect(battlefieldFingerprint(rebuilt, 0)).toEqual(
            battlefieldFingerprint(state, 0)
        );
        expect(battlefieldFingerprint(rebuilt, 1)).toEqual(
            battlefieldFingerprint(state, 1)
        );
        for (const zone of ["hand", "graveyard", "exile"] as const) {
            expect(zoneFingerprint(rebuilt, 0, zone)).toEqual(
                zoneFingerprint(state, 0, zone)
            );
            expect(zoneFingerprint(rebuilt, 1, zone)).toEqual(
                zoneFingerprint(state, 1, zone)
            );
        }

        expect(rebuilt.turn).toBe(state.turn);
        expect(rebuilt.phase).toBe(state.phase);
        expect(rebuilt.players[0].poisonCounters).toBe(
            state.players[0].poisonCounters
        );
        expect(rebuilt.players[1].poisonCounters).toBe(
            state.players[1].poisonCounters
        );
        expect(rebuilt.players[0].life).toBe(state.players[0].life);
        expect(rebuilt.players[1].life).toBe(state.players[1].life);
        expect(rebuilt.players[0].experienceCounters).toBe(
            state.players[0].experienceCounters
        );
        expect(rebuilt.players[1].experienceCounters).toBe(
            state.players[1].experienceCounters
        );
        expect(
            (rebuilt.players[0].companion?.instance.card as { id?: string }).id
        ).toBe(
            (state.players[0].companion?.instance.card as { id?: string }).id
        );
        expect(rebuilt.players[0].companion?.used).toBe(
            state.players[0].companion?.used
        );

        // markLastDrawn — resolved by definition id since instance ids
        // differ across the two builds.
        const lastDrawnDefId = (s: GameState): string | undefined => {
            const p = s.players[0];
            const card = p.hand.find((c) => c.id === p.lastDrawnCardId);
            return card ? ((card.card as { id?: string }).id ?? "") : undefined;
        };
        expect(lastDrawnDefId(state)).toBe(fear.id);
        expect(lastDrawnDefId(rebuilt)).toBe(lastDrawnDefId(state));
    });

    it('maps the requested seat to "me" regardless of live player order (the mirroring trap the issue names)', () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [
                { name: grizzlyBears.name, owner: "me", tapped: true },
                { name: shivanDragon.name, owner: "opp" },
            ],
        });

        const { spec, dropped } = specFromState(state, {
            mySeatId: state.players[1].id,
        });

        // What was "opp" (Shivan Dragon) in the live state is "me" now.
        expect(
            spec.cards.filter((c) => c.owner === "me").map((c) => c.name)
        ).toEqual([shivanDragon.name]);
        expect(
            spec.cards.filter((c) => c.owner === "opp").map((c) => c.name)
        ).toEqual([grizzlyBears.name]);
        // The active player (players[0], "p1") is no longer "me" — flagged,
        // never silently rebuilt onto the wrong seat.
        expect(dropped.some((d) => d.startsWith("active player"))).toBe(true);
    });

    it("throws when mySeatId matches neither player", () => {
        const state = buildStateFromScenario(makeState(), { cards: [] });
        expect(() => specFromState(state, { mySeatId: "nonexistent" })).toThrow(
            /matches neither player/
        );
    });

    it("reports the stack and floating mana as dropped rather than silently losing them", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        state.stack.push({
            ...makeInstance(grizzlyBears.id, {
                controllerId: state.players[0].id,
                ownerId: state.players[0].id,
                zone: "hand",
            }),
            castById: state.players[0].id,
        });
        state.players[0].manaPool.R = 2;

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(dropped.some((d) => d.startsWith("stack:"))).toBe(true);
        expect(dropped.some((d) => d.includes("mana pool"))).toBe(true);
    });

    // CR 500.8 (issue #2886) — an owed extra combat is turn-structure state a
    // spec has no field for (ADR 0111: a preset scenario captures the
    // PRE-ATTACK setup). It must be REPORTED, not silently lost, and it must
    // not surface as unnamed residue either — both new keys are in
    // `GAME_STATE_ALLOWLIST`, so `reportGameStateResidue` stays quiet about
    // them and this bespoke message is the only mention.
    // Each field on its OWN case, never both at once: they share one `dropped`
    // message, so a state carrying both is satisfied by either clause and the
    // assertion could not tell which one fired (this was checked — with both
    // set, deleting the `extraPhases` clause left the test green).
    it("reports an OWED extra combat phase as dropped rather than silently losing it", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        state.extraPhases = [{ kind: "combat" }];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(dropped.some((d) => d.includes("extra phases"))).toBe(true);
        // Neither key may ALSO surface as unnamed residue: both are in
        // `GAME_STATE_ALLOWLIST`, so this bespoke message is the only mention.
        expect(dropped.some((d) => d.includes("extraPhases"))).toBe(false);
    });

    it("does NOT name extra phases when only a Pass-Turn intent is standing", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        state.queuedEndTurn = [state.players[0].id];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(dropped.some((d) => d.includes("auto-pass intents"))).toBe(true);
        expect(dropped.some((d) => d.includes("extra phases"))).toBe(false);
    });

    it("reports a turn ALREADY in an extra combat as dropped", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        state.extraCombatsThisTurn = 1;

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(dropped.some((d) => d.includes("extra phases"))).toBe(true);
        expect(dropped.some((d) => d.includes("extraCombatsThisTurn"))).toBe(
            false
        );
    });

    it("reports declared combat as dropped rather than silently losing it", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
            phase: "DECLARE_ATTACKERS",
        });
        state.combat = {
            attackerIds: [state.players[0].battlefield[0].id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        };

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(dropped.some((d) => d.startsWith("combat:"))).toBe(true);
    });

    it("reports a combat sub-phase past DECLARE_ATTACKERS as dropped, since buildStateFromScenario never re-seeds combat for it", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
            phase: "DECLARE_BLOCKERS",
        });

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(
            dropped.some((d) => d.startsWith('phase "DECLARE_BLOCKERS"'))
        ).toBe(true);
    });

    it("reports non-empty libraries as dropped (library contents are out of scope for a spec)", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, { cards: [] });
        state.players[0].library.push(
            makeInstance(forest.id, {
                controllerId: state.players[0].id,
                ownerId: state.players[0].id,
                zone: "library",
            })
        );

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(dropped.some((d) => d.startsWith("me's library:"))).toBe(true);
    });

    it("reports a per-card continuous effect (e.g. a temporary P/T buff) the spec has no field for", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        state.players[0].battlefield[0].temporaryPTMods = [
            { power: 3, toughness: 3, duration: { phase: "end-of-turn" } },
        ];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(
            dropped.some((d) => d.includes("live-only state not captured"))
        ).toBe(true);
    });

    // Review finding on issue #2148/PR #2866: `dropped[]` was exhaustive only
    // for `CardInstanceState` (via `CARD_STATE_ALLOWLIST` +
    // `reportCardResidue`) — `GameState`/`PlayerState` were instead a
    // hand-enumerated ~25-check list that `buildStateFromScenario` restores
    // NONE of the rest of, so any of the ~40 other live fields vanished
    // silently while the Debug panel affirmatively claimed a faithful
    // capture. This reproduces the reviewer's own disproof scratch test
    // (landsPlayedThisTurn/energyCounters/maxHandSizeOverride/skipNextTurn/
    // spellsCastThisTurn per player, plus the global turn-scoped flags) as a
    // real suite test, now that `reportGameStateResidue`/
    // `reportPlayerStateResidue` (the same allowlist-scan shape as the card
    // level) cover them.
    it("reports player- and game-level turn-scoped bookkeeping the spec has no field for, rather than a silent faithful-capture claim (review finding on #2866)", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
            phase: "PRECOMBAT_MAIN",
        });
        const me = state.players[0];
        me.landsPlayedThisTurn = 1;
        me.energyCounters = 5;
        me.maxHandSizeOverride = "unlimited";
        me.skipNextTurn = 1;
        me.spellsCastThisTurn = 3;
        state.landPlayLocked = true;
        state.cannotCastSpellsThisTurn = [{ playerId: me.id }];
        state.skipDrawStepThisTurn = [me.id];
        state.preventAllCombatDamageThisTurn = true;

        const { dropped } = specFromState(state, { mySeatId: me.id });

        // landsPlayedThisTurn is the issue's own named failure mode (a
        // PRECOMBAT_MAIN capture of a seat that already played its land):
        // must be named, not silently dropped.
        const gameStateResidue = dropped.find((d) =>
            d.startsWith("game state: live-only state not captured")
        );
        const playerResidue = dropped.find((d) =>
            d.startsWith("me: live-only player state not captured")
        );
        expect(gameStateResidue).toBeDefined();
        expect(playerResidue).toBeDefined();
        for (const field of [
            "landPlayLocked",
            "cannotCastSpellsThisTurn",
            "skipDrawStepThisTurn",
            "preventAllCombatDamageThisTurn",
        ]) {
            expect(gameStateResidue).toContain(field);
        }
        for (const field of [
            "landsPlayedThisTurn",
            "energyCounters",
            "maxHandSizeOverride",
            "skipNextTurn",
            "spellsCastThisTurn",
        ]) {
            expect(playerResidue).toContain(field);
        }
    });

    it("reports removedKeywords/abilitiesSuppressedBy sourced from a permanent that has already left the battlefield (dangling sourceId), unlike a still-present source which is rebuild behaviour and stays silent", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        const bear = state.players[0].battlefield[0];
        // No permanent on either battlefield has this id — simulates a
        // stripper source that has since left play, the one shape
        // `applySourceStaticEffects` cannot replay on reload.
        bear.removedKeywords = [
            { keyword: "flying", sourceId: "gone-forever", seq: 1 },
        ];
        bear.abilitiesSuppressedBy = [{ sourceId: "gone-forever", seq: 1 }];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(
            dropped.some((d) => d.includes("removedKeywords stripped by"))
        ).toBe(true);
        expect(
            dropped.some((d) => d.includes("abilitiesSuppressedBy a source"))
        ).toBe(true);
    });

    it("does NOT flag removedKeywords/abilitiesSuppressedBy sourced from a still-present battlefield permanent — applySourceStaticEffects re-derives it on reload (no false positive)", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [
                { name: grizzlyBears.name, owner: "me" },
                { name: shivanDragon.name, owner: "me" },
            ],
        });
        const [bear, dragon] = state.players[0].battlefield;
        bear.removedKeywords = [
            { keyword: "flying", sourceId: dragon.id, seq: 1 },
        ];
        bear.abilitiesSuppressedBy = [{ sourceId: dragon.id, seq: 1 }];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(
            dropped.some((d) => d.includes("removedKeywords stripped by"))
        ).toBe(false);
        expect(
            dropped.some((d) => d.includes("abilitiesSuppressedBy a source"))
        ).toBe(false);
    });

    // Review finding on issue #2148/PR #2866, round 2 (low severity): the
    // three `granted*` arrays are `auraId`-keyed exactly like
    // `removedKeywords`/`abilitiesSuppressedBy` are `sourceId`-keyed — a
    // dangling `auraId` (its aura has left both battlefields) is the same
    // un-replayable shape `reportDanglingStripperResidue` already catches
    // for the stripper arrays, one field over.
    it("reports grantedStaticAbilities/grantedActivatedAbilities/grantedTriggeredAbilities sourced from an aura that has already left the battlefield (dangling auraId)", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        const bear = state.players[0].battlefield[0];
        // No permanent on either battlefield has this id — simulates an aura
        // that has since left play, the one shape `applySourceStaticEffects`
        // cannot replay on reload.
        bear.grantedStaticAbilities = [
            { ability: "flying", auraId: "gone-forever" },
        ];
        bear.grantedActivatedAbilities = [
            {
                sourceCardId: fear.id,
                abilityId: "a1",
                auraId: "gone-forever",
            },
        ];
        bear.grantedTriggeredAbilities = [
            {
                sourceCardId: fear.id,
                abilityId: "t1",
                auraId: "gone-forever",
            },
        ];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        for (const field of [
            "grantedStaticAbilities",
            "grantedActivatedAbilities",
            "grantedTriggeredAbilities",
        ]) {
            expect(
                dropped.some(
                    (d) =>
                        d.includes(field) &&
                        d.includes("no longer on either battlefield")
                )
            ).toBe(true);
        }
    });

    it("does NOT flag grantedStaticAbilities/grantedActivatedAbilities/grantedTriggeredAbilities sourced from a still-present battlefield aura — applySourceStaticEffects re-derives it on reload (no false positive)", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [
                { name: grizzlyBears.name, owner: "me" },
                { name: shivanDragon.name, owner: "me" },
            ],
        });
        const [bear, dragon] = state.players[0].battlefield;
        bear.grantedStaticAbilities = [
            { ability: "flying", auraId: dragon.id },
        ];
        bear.grantedActivatedAbilities = [
            { sourceCardId: fear.id, abilityId: "a1", auraId: dragon.id },
        ];
        bear.grantedTriggeredAbilities = [
            { sourceCardId: fear.id, abilityId: "t1", auraId: dragon.id },
        ];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        for (const field of [
            "grantedStaticAbilities",
            "grantedActivatedAbilities",
            "grantedTriggeredAbilities",
        ]) {
            expect(
                dropped.some(
                    (d) =>
                        d.includes(field) &&
                        d.includes("no longer on either battlefield")
                )
            ).toBe(false);
        }
    });

    // Review finding on issue #2148/PR #2866, round 2: the round-1 allowlist
    // fix was correct in isolation but broke the ONLY production consumer —
    // `debug-copy-scenario.tsx` never calls `specFromState` on a raw engine
    // `GameState`; it feeds it `getFullState`'s `projectFullState` result
    // (`FullGameState`), which adds a non-optional top-level `seq` that
    // `GAME_STATE_ALLOWLIST` didn't know about. A test built on a hand-built
    // `GameState` (every other test in this file) cannot see that class of
    // bug — it has to cross the real projection boundary, per
    // `.claude/rules/gre-development.md` § Proof-of-failure / SURFACE
    // assertions.
    it("reports nothing dropped for a clean position bridged through the REAL production path — projectFullState, not a hand-built GameState", () => {
        const { state } = buildComprehensiveState();
        const mySeatId = state.players[0].id;

        const projected = projectFullState(state, 42);

        const { dropped } = specFromState(projected as unknown as GameState, {
            mySeatId,
        });

        expect(dropped).toEqual([]);
    });

    it("does not report the live-choice wire-projection fields (librarySearch/libraryPeek/revealedHand) as dropped while a search-library choice is on the stack", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        const me = state.players[0];
        state.pendingChoices = [
            {
                stackItemId: "stack-1",
                step: 0,
                choiceId: "c1",
                playerId: me.id,
                kind: "search-library",
                zone: "library",
                zoneOwnerId: me.id,
                count: 1,
                prompt: "Search your library for a card.",
            } as PendingChoice,
        ];

        const projected = projectFullState(state, 1);
        // Sanity: the choice really did expose the library face-up on the
        // wire, so this test is exercising the field it claims to.
        expect(projected.players[0].librarySearch).toBeDefined();

        const { dropped } = specFromState(projected as unknown as GameState, {
            mySeatId: me.id,
        });

        for (const field of ["librarySearch", "libraryPeek", "revealedHand"]) {
            expect(dropped.some((d) => d.includes(field))).toBe(false);
        }
        // The choice itself is genuinely unlowerable and SHOULD still be
        // reported — this test only guards against the spurious extra.
        expect(dropped.some((d) => d.startsWith("pendingChoices:"))).toBe(true);
    });
});

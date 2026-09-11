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
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { gaeasTouch } from "../../cards/sets/drk/green";
import { shivanDragon } from "../../cards/sets/lea/red";
import { forest } from "../../cards/sets/lea/colorless";
import { animateDead, fear } from "../../cards/sets/lea/black";
import { tokenDefinitionId, tryGetDefinition } from "../../cards";
import { findTokenSpec } from "../../cards/tokenCatalogue";
import { projectFullState, projectPublicState } from "../../gameProjections";
import { buildSpellContext } from "../state";
import {
    NO_TARGETING_SOURCE,
    getLegalActions,
    getLegalTargets,
} from "../rules";
import type { GameState, PendingChoice } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";
import { removedKeywordRows } from "../../cards/__tests__/setup";

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

// CR 121.1 / 400.7 (issue #3240) — a scenario PLACES a position, it does not
// replay the turn that reached it. The per-turn player tallies therefore reset
// with the zones. This is not hygiene: the opening hand is dealt through
// `drawCard`, and `finalizeMulligan` walks to UPKEEP via `advancePhase`, never
// `advanceTurn` — so a scenario built without this clear arrives on turn 1
// carrying SEVEN drawn cards, and the first "if you've drawn more than one card
// this turn" trigger fires for 7 on a board where nothing was drawn.
describe("buildStateFromScenario — per-turn player tallies (CR 121.1 / 400.7)", () => {
    it("clears drawnThisTurn and leftGraveyardThisTurn on both seats", () => {
        const base = makeState();
        base.players[0].drawnThisTurn = ["a", "b", "c", "d", "e", "f", "g"];
        base.players[1].drawnThisTurn = ["x"];
        base.players[0].leftGraveyardThisTurn = 3;
        base.players[1].leftGraveyardThisTurn = 1;
        const built = buildStateFromScenario(base, { cards: [] });
        for (const p of built.players) {
            expect(p.drawnThisTurn ?? []).toEqual([]);
            expect(p.leftGraveyardThisTurn ?? 0).toBe(0);
        }
    });

    it("specFromState reports a longer draw tally as dropped — the spec expresses one card, not seven", () => {
        const base = makeState();
        const built = buildStateFromScenario(base, {
            cards: [{ name: "Grizzly Bears", owner: "me", zone: "hand" }],
        });
        built.players[0].drawnThisTurn = ["d1", "d2", "d3"];
        const { dropped } = specFromState(built, { mySeatId: "p1" });
        expect(
            dropped.some((d) => /drawnThisTurn beyond the single/.test(d))
        ).toBe(true);
    });

    // CR 305.2 / 305.2a (issue #3446) — the land drop is the fourth-ranked
    // player-level residue in the lowering sweep (present on 98.5% of Bot
    // decisions), and the one that made "a main-phase decision taken after the
    // land was played" — the most common decision there is — unjudgeable.
    it("seeds lands already played on both seats (CR 305.2)", () => {
        const state = buildStateFromScenario(makeState(), {
            cards: [],
            landsPlayed: { me: 1, opp: 2 },
        });
        expect(state.players[0].landsPlayedThisTurn).toBe(1);
        expect(state.players[1].landsPlayedThisTurn).toBe(2);
    });

    it("clears the loaded game's land drop when the spec omits it", () => {
        const base = makeState();
        base.players[0].landsPlayedThisTurn = 1;
        base.players[1].landsPlayedThisTurn = 1;
        // A scenario PLACES a position: the drop the game being loaded into
        // happened to have spent is not part of what the spec described, so an
        // absent field must mean "no land played", not "whatever was there".
        const built = buildStateFromScenario(base, { cards: [] });
        for (const p of built.players) {
            expect(p.landsPlayedThisTurn ?? 0).toBe(0);
        }
    });

    // THE behavioural claim, read through the legality surface the client and
    // `assertLegalAction` both use — never by reading the field back. Playing a
    // land is a special action gated on the tally (CR 116.2a / 305.2b), so a
    // rebuilt seat that has spent its drop must not be offered one.
    it("offers NO land play to a rebuilt seat whose drop is spent (CR 305.2b)", () => {
        const landInHand = (state: GameState) => {
            const me = state.players[0];
            const card = me.hand.find(
                (c) => (c.card as { id?: string }).id === forest.id
            );
            if (!card) throw new Error("fixture: no land in hand");
            return getLegalActions(state, me, card);
        };
        const board: ScenarioSpec = {
            cards: [{ name: forest.name, owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
        };

        // The control first: with the drop unused the same board offers it, so
        // the assertion below measures the tally and not some other legality
        // of this fixture.
        expect(
            landInHand(buildStateFromScenario(makeState(), board))
        ).toContain("play");
        expect(
            landInHand(
                buildStateFromScenario(makeState(), {
                    ...board,
                    landsPlayed: { me: 1 },
                })
            )
        ).not.toContain("play");
    });

    it("markLastDrawn re-seeds the draw tally with exactly that one card", () => {
        const base = makeState();
        base.players[0].drawnThisTurn = ["stale-1", "stale-2"];
        const built = buildStateFromScenario(base, {
            cards: [
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
                { name: "Shivan Dragon", owner: "me", zone: "hand" },
            ],
            markLastDrawn: true,
        });
        const me = built.players[0];
        // "The last card you drew this turn" and "the number of cards you've
        // drawn this turn" are two readings of one fact; they must agree.
        expect(me.lastDrawnCardId).toBe(me.hand[me.hand.length - 1].id);
        expect(me.drawnThisTurn).toEqual([me.lastDrawnCardId]);
    });
});

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

describe("buildStateFromScenario — a scenario starts a LIVE game (CR 104, issue #3314)", () => {
    it("clears `gameOver` when loaded into a FINISHED game", () => {
        const base = makeState();
        // CR 104.3c — a solo game whose libraries have run out ends in a draw,
        // and that is exactly the position a scenario is loaded to rescue.
        base.players[0].library = [];
        base.players[1].library = [];
        base.gameOver = {
            winnerId: "p1",
            loserId: "p2",
            reason: "decked",
        };

        const state = buildStateFromScenario(base, {
            cards: [
                { name: grizzlyBears.name, owner: "me", zone: "battlefield" },
            ],
            libraryCount: 10,
        });

        // Without the reset the board is right and the game is dead: every
        // mutation dies on `assertGameNotOver` (`convex/game.ts`).
        expect(state.gameOver).toBeUndefined();
        // The board the spec named is still what was built ...
        expect(state.players[0].battlefield).toHaveLength(1);
        // ... and `libraryCount` is what refills the libraries, which is a
        // SEPARATE axis: it removes the cause of the draw, it never revives a
        // game the flag has already ended.
        expect(state.players[0].library).toHaveLength(10);
        expect(state.players[1].library).toHaveLength(10);
    });

    it("leaves a live game untouched, and does not mutate the base state", () => {
        const base = makeState();
        expect(base.gameOver).toBeUndefined();
        const state = buildStateFromScenario(base, {
            cards: [
                { name: grizzlyBears.name, owner: "me", zone: "battlefield" },
            ],
        });
        expect(state.gameOver).toBeUndefined();
        expect(base.players[0].battlefield).toHaveLength(0);
    });

    it("does not carry a finished game through a capture/rebuild round trip", () => {
        // `specFromState` reports `gameOver` as DROPPED rather than lowering it
        // into the spec; clearing it in the builder is what makes that note
        // true in BOTH directions — neither captured nor carried.
        const finished = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(grizzlyBears.id, { id: "b1" })],
                }),
                makePlayer("p2"),
            ],
        });
        finished.gameOver = {
            winnerId: "p1",
            loserId: "p2",
            reason: "life",
        };

        const captured = specFromState(finished, { mySeatId: "p1" });
        expect(captured.dropped.join(" ")).toContain("gameOver");
        expect(
            buildStateFromScenario(finished, captured.spec).gameOver
        ).toBeUndefined();
    });
});

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
            landsPlayed: { me: 1, opp: 2 },
            markLastDrawn: true,
            companion: { name: shivanDragon.name, owner: "me", used: false },
        };
        const state = buildStateFromScenario(base, spec);
        return { base, state };
    }

    it("round-trips battlefield/hand/graveyard/exile, tapped, counters, attachments, damage, phase, turn, poison, life, experience, lands played and companion", () => {
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
        // CR 305.2 (issue #3446) — the land drop survives the round trip on
        // BOTH seats, and `dropped` above is empty, so it is no longer the
        // live-only player state that refused a post-drop capture.
        expect(rebuilt.players[0].landsPlayedThisTurn).toBe(
            state.players[0].landsPlayedThisTurn
        );
        expect(rebuilt.players[1].landsPlayedThisTurn).toBe(
            state.players[1].landsPlayedThisTurn
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
        // CR 102.1 (issue #3454) — the active player (players[0], "p1") is no
        // longer "me", and the spec now CARRIES that instead of reporting it
        // as a loss: it is lowered in the same mirrored frame as the cards.
        expect(spec.activePlayer).toBe("opp");
        expect(dropped.some((d) => d.startsWith("active player"))).toBe(false);
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

    it("reports a continuous effect (e.g. a temporary P/T buff) the spec has no field for", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        // CR 613.4c (ADR 0082, PRD #2064 S6) — an until-end-of-turn pump is a
        // Continuous Effects Registry entry, so the residue it leaves is on the
        // GAME state rather than on the permanent. `continuousEffects` is
        // deliberately absent from `GAME_STATE_ALLOWLIST`: a scenario spec has
        // no field that can express one, and silently rebuilding a board
        // without the pump is exactly what this report exists to prevent.
        state.continuousEffects = [
            {
                id: "ce-1",
                layer: 7,
                sublayer: "7c",
                timestamp: 1,
                expiry: {
                    kind: "duration",
                    duration: { phase: "end-of-turn" },
                    controllerId: state.players[0].id,
                },
                affected: {
                    kind: "instances",
                    instanceIds: [state.players[0].battlefield[0].id],
                },
                payload: { kind: "pt-modify", power: 3, toughness: 3 },
                characteristicDefining: false,
            },
        ];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(
            dropped.some(
                (d) =>
                    d.startsWith("game state:") &&
                    d.includes("live-only state not captured") &&
                    d.includes("continuousEffects")
            )
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

        // `landsPlayedThisTurn` used to head this list — it was the issue's
        // own named failure mode. Issue #3446 gave the spec a `landsPlayed`
        // field, so it is now CAPTURED rather than reported; the assertion
        // that it round-trips lives with the other lowered fields below.
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
            "energyCounters",
            "maxHandSizeOverride",
            "skipNextTurn",
            "spellsCastThisTurn",
        ]) {
            expect(playerResidue).toContain(field);
        }
    });

    it("reports a Continuous Effects Registry entry as unrepresentable (PRD #2064 S3)", () => {
        // `ScenarioSpec` has no field for `state.continuousEffects`, and S3 is
        // the registry's first producer — so a live position carrying one CAN
        // be lowered, but not faithfully. The generic top-level residue scan is
        // what says so; this pins that it keeps saying so rather than the entry
        // going quietly missing from a saved scenario.
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        state.continuousEffects = [
            {
                id: "ce-1",
                layer: 6,
                timestamp: 1,
                expiry: {
                    kind: "counter",
                    permanentId: "bear",
                    counterType: "paralyzation",
                },
                affected: { kind: "instances", instanceIds: ["bear"] },
                payload: {
                    kind: "keyword-grant",
                    keyword: "does-not-untap",
                },
                characteristicDefining: false,
            },
        ];

        const { dropped } = specFromState(state, { mySeatId: "p1" });
        expect(dropped.some((d) => d.includes("continuousEffects"))).toBe(true);
    });

    it("does NOT report a duration-scoped keyword strip as dangling residue (PRD #2064 S3)", () => {
        // `removedKeywords` is derived output now, and a duration-scoped strip
        // (Shelkin Brownie) is stamped with the `"indefinite"` sentinel because
        // no source produced it. The dangling test asks "is this sourceId still
        // on a battlefield?", which no sentinel can answer — without the skip
        // every such strip reported as unrecoverable on every save.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const ctx = buildSpellContext(
            state,
            pushSpell(state, grizzlyBears.id, "p1")
        );
        ctx.removeStaticAbilities(
            { type: "permanent", id: "bear" },
            (kw) => kw === "flying",
            { phase: "end-of-turn" }
        );
        expect(removedKeywordRows(state, bear)).toEqual([
            expect.objectContaining({ sourceId: "indefinite" }),
        ]);

        const { dropped } = specFromState(state, { mySeatId: "p1" });
        expect(
            dropped.some((d) => d.includes("removedKeywords stripped by"))
        ).toBe(false);
    });

    it("reports abilitiesSuppressedBy sourced from a permanent that has already left the battlefield (dangling sourceId), unlike a still-present source which is rebuild behaviour and stays silent", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        const bear = state.players[0].battlefield[0];
        // No permanent on either battlefield has this id — simulates a
        // stripper source that has since left play, the one shape
        // `beginApplyingStaticEffects` cannot replay on reload.
        bear.abilitiesSuppressedBy = [{ sourceId: "gone-forever", seq: 1 }];

        const { dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        expect(
            dropped.some((d) => d.includes("abilitiesSuppressedBy a source"))
        ).toBe(true);
    });

    it("does NOT flag abilitiesSuppressedBy sourced from a still-present battlefield permanent — beginApplyingStaticEffects re-derives it on reload (no false positive)", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [
                { name: grizzlyBears.name, owner: "me" },
                { name: shivanDragon.name, owner: "me" },
            ],
        });
        const [bear, dragon] = state.players[0].battlefield;
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
    it("reports grantedActivatedAbilities/grantedTriggeredAbilities sourced from an aura that has already left the battlefield (dangling auraId)", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [{ name: grizzlyBears.name, owner: "me" }],
        });
        const bear = state.players[0].battlefield[0];
        // No permanent on either battlefield has this id — simulates an aura
        // that has since left play, the one shape `beginApplyingStaticEffects`
        // cannot replay on reload.
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

    it("does NOT flag grantedActivatedAbilities/grantedTriggeredAbilities sourced from a still-present battlefield aura — beginApplyingStaticEffects re-derives it on reload (no false positive)", () => {
        const base = makeState();
        const state = buildStateFromScenario(base, {
            cards: [
                { name: grizzlyBears.name, owner: "me" },
                { name: shivanDragon.name, owner: "me" },
            ],
        });
        const [bear, dragon] = state.players[0].battlefield;
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

// CR 113.6c (issue #3278) — a scenario-placed zone-conditional card.
//
// `debugSetupScenario` (`convex/game.ts`) PERSISTS whatever this builder
// returns, with no action in between, so leaving the materialisation to the
// next state-based-action sweep writes a wrong state to the database: a Grist
// placed in a graveyard is a bare Planeswalker card there until something
// happens to sweep, and the first thing a scenario is loaded to do is a READ.
describe("scenario-placed off-battlefield characteristics (CR 113.6c)", () => {
    const GRIST = "Grist, the Hunger Tide";

    it("materialises the zone characteristics on a graveyard card, with no SBA entry in between", () => {
        const state = buildStateFromScenario(makeState(), {
            cards: [{ name: GRIST, owner: "me", zone: "graveyard" }],
        });

        const grist = state.players[0].graveyard.find(
            (c) =>
                tryGetDefinition((c.card as { id?: string }).id!)?.name ===
                GRIST
        );
        expect(grist).toBeDefined();
        // Printed Planeswalker — Grist; a 1/1 Insect creature everywhere but
        // the battlefield, ADDITIVELY (CR 205.1b).
        expect(grist!.types).toContain("Planeswalker");
        expect(grist!.types).toContain("Creature");
        expect(grist!.subtypes).toContain("Grist");
        expect(grist!.subtypes).toContain("Insect");
        expect(grist!.power).toBe(1);
        expect(grist!.toughness).toBe(1);
    });

    it("makes it a legal Animate Dead target as the first read after setup", () => {
        // The acceptance shape from the issue: "enchant creature card in a
        // graveyard" offers a scenario-placed Grist immediately. This is the
        // FAMILY B half — `getLegalTargets`' graveyard branch reads the
        // INSTANCE's `types`, so it is right only if the builder wrote them.
        const state = buildStateFromScenario(makeState(), {
            cards: [{ name: GRIST, owner: "me", zone: "graveyard" }],
        });
        const gristId = state.players[0].graveyard.find(
            (c) =>
                tryGetDefinition((c.card as { id?: string }).id!)?.name ===
                GRIST
        )!.id;

        const offered = getLegalTargets(
            state,
            animateDead.targetRequirement!,
            NO_TARGETING_SOURCE,
            state.players[0].id
        );

        expect(offered.map((t) => t.id)).toContain(gristId);
    });

    it("leaves a BATTLEFIELD copy on its printed line", () => {
        // The negative half: CR 113.6c switches the ability off on the
        // battlefield, so the sweep must not reach a battlefield permanent.
        const state = buildStateFromScenario(makeState(), {
            cards: [{ name: GRIST, owner: "me" }],
        });

        const grist = state.players[0].battlefield.find(
            (c) =>
                tryGetDefinition((c.card as { id?: string }).id!)?.name ===
                GRIST
        )!;
        expect(grist.types).toEqual(["Planeswalker"]);
        expect(grist.subtypes ?? []).not.toContain("Insect");
        expect(grist.power).toBeUndefined();
    });
});

// ---- CR 102.1 / 117.1 / 117.4 (issue #3454) -------------------------------
//
// The turn holder and the priority holder decide WHICH decision a rebuilt
// position poses. Before the spec could carry them, every position captured
// with priority on the opponent's turn rebuilt as the judged seat's own turn —
// offering the sorcery-speed moves it did not have (CR 307.1), while `pass`
// existed in both lists, so the pick still resolved and nothing downstream
// noticed the answer was to another question. The verdict quiz refused that
// whole class rather than file it (PRD #3397).
describe("buildStateFromScenario — turn holder, priority and passCount (issue #3454)", () => {
    /** A board where "me" holds a land, a creature and an instant, with mana
     *  to cast any of them. The TIMING half of this fixture is exercised in
     *  `scenarioBuilderTiming.bot.test.ts` — that assertion needs
     *  `enumerateMoves`, which is a bot-only module (`bot-suite-boundary`). */
    const TIMING_BOARD: ScenarioSpec = {
        cards: [
            { name: forest.name, owner: "me", zone: "hand" },
            { name: grizzlyBears.name, owner: "me", zone: "hand" },
            { name: grizzlyBears.name, owner: "opp", zone: "battlefield" },
        ],
        landCount: 4,
    };

    it("sets the turn holder the spec names, leaving priority with the judged seat", () => {
        const state = buildStateFromScenario(makeState(), {
            ...TIMING_BOARD,
            activePlayer: "opp",
            priority: "me",
            passCount: 1,
        });

        expect(state.activePlayerId).toBe(state.players[1].id);
        expect(state.priorityPlayerId).toBe(state.players[0].id);
        expect(state.passCount).toBe(1);
    });

    // THE behavioural claim (CR 307.1): on the opponent's turn the judged seat
    // may only act at instant speed. A rebuild that got the turn holder wrong
    // fails HERE, loudly, rather than by quietly offering a bigger list.
    it("leaves the base state's turn holder alone, and starts a fresh priority round, when the spec omits all three", () => {
        // The pre-#3454 contract every stored spec and every blade entry was
        // written against: absent means unchanged, exactly as `phase` is.
        const base = makeState();
        base.activePlayerId = base.players[1].id;
        base.priorityPlayerId = base.players[0].id;
        base.passCount = 1;

        const state = buildStateFromScenario(base, { cards: [] });

        expect(state.activePlayerId).toBe(state.players[1].id);
        expect(state.priorityPlayerId).toBe(state.players[1].id);
        expect(state.passCount).toBe(0);

        // …and the SAME base with the field present moves the turn holder, so
        // this block proves the field rather than only the absence (a test
        // that stays green with the feature reverted is not evidence).
        const claimed = buildStateFromScenario(base, {
            cards: [],
            activePlayer: "me",
        });
        expect(claimed.activePlayerId).toBe(claimed.players[0].id);
    });

    it("round-trips a position taken on the opponent's turn through specFromState", () => {
        const live = buildStateFromScenario(makeState(), TIMING_BOARD);
        live.activePlayerId = live.players[1].id;
        live.priorityPlayerId = live.players[0].id;
        live.passCount = 1;

        const { spec, dropped } = specFromState(live, {
            mySeatId: live.players[0].id,
        });

        expect(spec.activePlayer).toBe("opp");
        expect(spec.priority).toBe("me");
        expect(spec.passCount).toBe(1);
        // Both notes are gone: the spec carries the fact, so it is no longer a
        // loss to report.
        expect(dropped.some((d) => d.startsWith("active player"))).toBe(false);
        expect(dropped.some((d) => d.startsWith("priority:"))).toBe(false);

        const rebuilt = buildStateFromScenario(makeState(), spec);
        expect(rebuilt.activePlayerId).toBe(rebuilt.players[1].id);
        expect(rebuilt.priorityPlayerId).toBe(rebuilt.players[0].id);
        expect(rebuilt.passCount).toBe(1);
    });

    it("lowers the quiet case explicitly rather than as an absence", () => {
        // Mirrors `life`: "me is active, fresh round" is a real position, and a
        // captured spec must REBUILD it rather than inherit whatever game it is
        // loaded into.
        const { spec } = specFromState(
            buildStateFromScenario(makeState(), { cards: [] }),
            { mySeatId: makeState().players[0].id }
        );
        expect(spec.activePlayer).toBe("me");
        expect(spec.priority).toBe("me");
        expect(spec.passCount).toBe(0);
    });
});

// ---- CR 602.5 / 400.7 (issue #3448) ---------------------------------------
//
// `activationsThisTurn` is what makes "activate this ability only once each
// turn" stick (CR 602.5). Before the spec could carry it, every rebuilt card
// came back with its per-turn activations unspent, so a position whose
// once-each-turn ability had already been used rebuilt with that ability legal
// again — an extra candidate, which is precisely the mismatch the verdict quiz
// refuses a decision on (PRD #3397).
//
// The field is NOT battlefield-only. The engine keeps the tally on a card that
// has LEFT play and clears it on the way back in
// (`resetBattlefieldTransientState`, CR 400.7 — what re-enters is a new object
// with a fresh quota), which is why the quiz's capture saw a cracked fetchland
// in the graveyard still carrying one. That is live state, not an engine bug,
// so the spec lowers it in every zone.
//
// The BEHAVIOURAL half — that the rebuilt position offers no activation of the
// spent ability — lives in `scenarioBuilderActivations.bot.test.ts`, because
// it reads `enumerateMoves` (a bot-only module, `bot-suite-boundary.test.ts`).
describe("buildStateFromScenario — per-turn activation tallies (issue #3448)", () => {
    /** Gaea's Touch's `oncePerTurn` ability (CR 602.5 "only once each turn").
     *  The tally is keyed by ability id, exactly as the engine keys it. */
    const ABILITY = "gaeas-touch-forest";

    function permanent(state: GameState, seat: 0 | 1) {
        return state.players[seat].battlefield.find(
            (c) => (c.card as { id?: string }).id === gaeasTouch.id
        );
    }

    it("places the declared tally on a battlefield permanent (CR 602.5)", () => {
        const state = buildStateFromScenario(makeState(), {
            cards: [
                {
                    name: gaeasTouch.name,
                    owner: "me",
                    activations: { [ABILITY]: 1 },
                },
                { name: gaeasTouch.name, owner: "opp" },
            ],
        });

        expect(permanent(state, 0)?.activationsThisTurn).toEqual({
            [ABILITY]: 1,
        });
        // The seat that declared nothing keeps a fresh quota — the field is
        // per-INSTANCE, never a board-wide stamp.
        expect(permanent(state, 1)?.activationsThisTurn).toBeUndefined();
    });

    it("round-trips the tally in every lowerable zone and on a token, dropping nothing (CR 400.7)", () => {
        const base = makeState();
        const spec: ScenarioSpec = {
            cards: [
                {
                    name: gaeasTouch.name,
                    owner: "me",
                    activations: { [ABILITY]: 1 },
                },
                // A token carries the same field: it is placed through the
                // token primitive rather than `makeInstance`, a separate seam
                // that would silently drop the tally now that the residue
                // reporter allowlists it. The ability id is opaque to the
                // builder (as a counter TYPE is), so any key round-trips.
                {
                    name: "Wasp",
                    owner: "me",
                    token: true,
                    activations: { [ABILITY]: 3 },
                },
                {
                    name: gaeasTouch.name,
                    owner: "opp",
                    zone: "graveyard",
                    activations: { [ABILITY]: 2 },
                },
                // All four lowerable zones, because the allowlist entry this
                // change adds is what STOPS `reportCardResidue` naming the key:
                // with the safety net gone, a zone `lowerCard` forgot would be
                // a silent drop rather than a `dropped[]` line.
                {
                    name: gaeasTouch.name,
                    owner: "me",
                    zone: "hand",
                    activations: { [ABILITY]: 4 },
                },
                {
                    name: gaeasTouch.name,
                    owner: "me",
                    zone: "exile",
                    activations: { [ABILITY]: 5 },
                },
            ],
        };
        const state = buildStateFromScenario(base, spec);

        const { spec: lowered, dropped } = specFromState(state, {
            mySeatId: state.players[0].id,
        });

        // The whole point: nothing here is unlowerable any more. A graveyard
        // card carrying a tally used to read as `live-only state not captured
        // (activationsThisTurn)`.
        expect(dropped).toEqual([]);
        expect(
            lowered.cards.find((c) => c.owner === "me" && !c.token)?.activations
        ).toEqual({ [ABILITY]: 1 });
        expect(lowered.cards.find((c) => c.token)?.activations).toEqual({
            [ABILITY]: 3,
        });
        expect(
            lowered.cards.find((c) => c.zone === "graveyard")?.activations
        ).toEqual({ [ABILITY]: 2 });
        expect(
            lowered.cards.find((c) => c.zone === "hand")?.activations
        ).toEqual({ [ABILITY]: 4 });
        expect(
            lowered.cards.find((c) => c.zone === "exile")?.activations
        ).toEqual({ [ABILITY]: 5 });

        const rebuilt = buildStateFromScenario(base, lowered);
        expect(permanent(rebuilt, 0)?.activationsThisTurn).toEqual({
            [ABILITY]: 1,
        });
        expect(
            rebuilt.players[0].battlefield.find((c) => c.isToken)
                ?.activationsThisTurn
        ).toEqual({ [ABILITY]: 3 });
        expect(rebuilt.players[1].graveyard[0]?.activationsThisTurn).toEqual({
            [ABILITY]: 2,
        });
        expect(rebuilt.players[0].hand[0]?.activationsThisTurn).toEqual({
            [ABILITY]: 4,
        });
        expect(rebuilt.players[0].exile[0]?.activationsThisTurn).toEqual({
            [ABILITY]: 5,
        });
    });

    it("drops a count of zero — an absent key already says 'not activated'", () => {
        const state = buildStateFromScenario(makeState(), {
            cards: [
                {
                    name: gaeasTouch.name,
                    owner: "me",
                    activations: { [ABILITY]: 0 },
                },
            ],
        });

        // Kept, a zero would rebuild into a spec `specFromState` never writes,
        // so the round trip would stop being a fixed point.
        expect(permanent(state, 0)?.activationsThisTurn).toBeUndefined();
        const { spec } = specFromState(state, {
            mySeatId: state.players[0].id,
        });
        expect(spec.cards[0]?.activations).toBeUndefined();
    });
});

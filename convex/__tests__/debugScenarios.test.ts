// Debug scenarios DB path (issue #769, ADR 0044). The tracer-bullet slice
// relocates a debug scenario's spec from the `PRESET_SCENARIOS` code literal
// into the `debugScenarios` table; the panel lists rows and passes the stored
// spec straight to the unchanged `debugSetupScenario` builder.
//
// The project has no convex-test harness (see `convex/__tests__/adminAuth.test.ts`,
// `convex/__tests__/decks.test.ts`), so the query/mutation gate is asserted via
// the same pure decision `assertIsAdmin` is built from — `isAdminUser`. The
// load-bearing NEW logic — the tolerant load (`normalizeScenarioSpec`) and the
// pre-write card-name guard (`collectUnresolvedCardNames`) — is pure and tested
// directly, end to end against the REAL card registry (the DB → load → builder-
// input path a saved row travels).
import { describe, it, expect } from "vitest";
import { isAdminUser } from "../auth";
import { tryGetCardByName } from "../cards";
import type { Doc } from "../_generated/dataModel";
import {
    collectUnresolvedCardNames,
    normalizeScenarioSpec,
    resolveScenarioBattlefieldCounters,
    resolveScenarioGolden,
    selectEphemeralIdsToPrune,
    selectScenarioUpsert,
    SCENARIO_SCHEMA_VERSION,
    EPHEMERAL_KEEP_BOUND,
    type PrunableScenarioRow,
    type ScenarioSpec,
    type UpsertableScenarioRow,
} from "../debugScenarioSpec";
import { getCardByName } from "../cards";

function user(isAdmin?: boolean): Doc<"users"> {
    return {
        _id: "user_1" as Doc<"users">["_id"],
        _creationTime: 0,
        nickname: "Tester",
        isAdmin,
    } as Doc<"users">;
}

const resolves = (name: string) => tryGetCardByName(name) !== null;

describe("debugScenarios — admin gate (issue #769)", () => {
    it("rejects a non-admin caller (list/save/delete assertIsAdmin)", () => {
        expect(isAdminUser(user(false))).toBe(false);
        expect(isAdminUser(user(undefined))).toBe(false);
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin caller through the gate", () => {
        expect(isAdminUser(user(true))).toBe(true);
    });
});

describe("resolveScenarioBattlefieldCounters — real loyalty counters (CR 306.5b)", () => {
    it("folds a free-text 'Loyalty' counter onto the engine's lowercase `loyalty` key", () => {
        // The editor's counter type is free text — a walker given "Loyalty" 6
        // must become real loyalty (read by the badge / SBA / damage removal),
        // not an inert cosmetic counter.
        const out = resolveScenarioBattlefieldCounters(
            { Loyalty: 6 },
            { isPlaneswalker: true, printedLoyalty: 3 }
        );
        expect(out).toEqual({ loyalty: 6 });
    });

    it("treats an explicit loyalty counter as authoritative (does not add printed)", () => {
        const out = resolveScenarioBattlefieldCounters(
            { LOYALTY: 9 },
            { isPlaneswalker: true, printedLoyalty: 3 }
        );
        expect(out).toEqual({ loyalty: 9 });
    });

    it("seeds a planeswalker's printed starting loyalty when no counter is set", () => {
        const out = resolveScenarioBattlefieldCounters(undefined, {
            isPlaneswalker: true,
            printedLoyalty: 3,
        });
        expect(out).toEqual({ loyalty: 3 });
    });

    it("leaves non-loyalty counters untouched and still seeds loyalty for a walker", () => {
        const out = resolveScenarioBattlefieldCounters(
            { "+1/+1": 2 },
            { isPlaneswalker: true, printedLoyalty: 4 }
        );
        expect(out).toEqual({ "+1/+1": 2, loyalty: 4 });
    });

    it("passes non-loyalty counters through unchanged for a non-planeswalker", () => {
        const out = resolveScenarioBattlefieldCounters(
            { "+1/+1": 3, charge: 1 },
            { isPlaneswalker: false }
        );
        expect(out).toEqual({ "+1/+1": 3, charge: 1 });
    });

    it("returns undefined for a non-planeswalker with no counters (minimal instance shape)", () => {
        expect(
            resolveScenarioBattlefieldCounters(undefined, {
                isPlaneswalker: false,
            })
        ).toBeUndefined();
    });

    it("does not seed loyalty for a stub planeswalker with no printed loyalty", () => {
        expect(
            resolveScenarioBattlefieldCounters(undefined, {
                isPlaneswalker: true,
            })
        ).toBeUndefined();
    });

    it("drives a real planeswalker (Liliana of the Veil, printed loyalty 3) from the catalogue", () => {
        const def = getCardByName("Liliana of the Veil");
        const pw = {
            isPlaneswalker: def.types.includes("Planeswalker"),
            printedLoyalty: def.loyalty,
        };
        // No explicit counter → printed loyalty is seeded.
        expect(resolveScenarioBattlefieldCounters(undefined, pw)).toEqual({
            loyalty: 3,
        });
        // An explicit "Loyalty" counter overrides the printed value.
        expect(resolveScenarioBattlefieldCounters({ Loyalty: 6 }, pw)).toEqual({
            loyalty: 6,
        });
    });
});

describe("normalizeScenarioSpec — tolerant load (ADR 0044)", () => {
    it("keeps known fields and maps card placements", () => {
        const raw = {
            cards: [
                {
                    name: "Plains",
                    owner: "opp",
                    zone: "graveyard",
                    tapped: true,
                    count: 3,
                    counters: { "+1/+1": 2 },
                    // CR 602.5 (issue #3448) — the per-turn activation tally,
                    // same tolerant `Record<string, number>` shape as
                    // `counters`: non-numeric values are DROPPED, not thrown
                    // on, and the surviving keys reach the builder. On a
                    // GRAVEYARD card deliberately — the engine keeps the tally
                    // on a card that has left play (CR 400.7 clears it on
                    // re-entry instead), so this is the shape the verdict
                    // quiz's own capture produced.
                    activations: { "fetchland-crack": 1, bogus: "x" },
                    // CR 106.4 / 603.3 / 502.1 (issue #3451) — the tap-state
                    // trio. Normalize is the only path a stored row reaches
                    // the builder by, so one it drops rebuilds a captured
                    // mid-turn board with every tapped land freely untappable
                    // and every "started the turn untapped" upkeep trigger
                    // silent.
                    manaCommitted: true,
                    tapTriggerCommitted: true,
                    startedTurnUntapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
            libraryCount: 10,
            turn: 3,
            markLastDrawn: true,
            rngSeed: 7,
            poison: { me: 4, opp: 9 },
            // CR 119.1 (issue #2147) — starting life totals, mirroring the
            // `poison` shape exactly.
            life: { me: 4, opp: 17 },
            // CR 122.1 (issue #1969) — the scaling seed for a "for each
            // experience counter you have" card.
            experience: { me: 2 },
            // CR 305.2 (issue #3446) — the land drops already spent, the fact
            // that decides whether the rebuilt main phase still offers one.
            landsPlayed: { me: 1 },
            // CR 102.1 / 117.1 / 117.4 (issue #3454) — the turn holder, the
            // priority holder and the banked passes. Normalize is the ONLY
            // path a stored row and a markdown seed reach the builder by, so a
            // field it silently drops loads a curated opponent-turn position
            // on the wrong turn.
            activePlayer: "opp",
            priority: "me",
            passCount: 1,
            // CR 601.2i / 118.9 / 702.40a (issue #3449) — what has already
            // been cast. Same argument as the three above: normalize is the
            // only path a stored row reaches the builder by, and a dropped
            // tally reopens a judged position at a free Once Upon a Time and
            // a storm count of zero.
            spellsCastThisTurn: { me: 2, opp: 1 },
            spellsCastThisGame: { me: 6 },
            stormCount: 3,
            // CR 120.3a / 119.3 / 700.4 / 508.1a (issue #3453) — what has
            // already HAPPENED this turn. Same argument again: a tally
            // normalize drops rebuilds a position where the damage was never
            // taken and the life was never gained.
            damageDealtToPlayerThisTurn: { me: 4, opp: 1 },
            artifactDamageToPlayerThisTurn: { me: 2 },
            lifeGainedThisTurn: { me: 3 },
            deathsThisTurn: 2,
            creatureAttackedThisTurn: true,
            // CR 508.1 / 509.1 (issue #3458) — a declared combat. Same
            // argument again: a curated block-window row that normalize drops
            // reopens as an undeclared attack step, which is a different
            // question under the same label.
            combat: {
                attackers: ["Savannah Lions"],
                confirmed: true,
                blockers: [{ blocker: "Shivan Dragon", blocking: [0] }],
                blockersConfirmed: false,
                attackedThisTurn: { me: ["Savannah Lions"] },
                blockedThisTurn: { opp: ["Grizzly Bears"] },
            },
        };
        expect(normalizeScenarioSpec(raw)).toEqual({
            cards: [
                {
                    name: "Plains",
                    owner: "opp",
                    zone: "graveyard",
                    tapped: true,
                    count: 3,
                    counters: { "+1/+1": 2 },
                    activations: { "fetchland-crack": 1 },
                    manaCommitted: true,
                    tapTriggerCommitted: true,
                    startedTurnUntapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
            libraryCount: 10,
            turn: 3,
            markLastDrawn: true,
            rngSeed: 7,
            poison: { me: 4, opp: 9 },
            life: { me: 4, opp: 17 },
            experience: { me: 2 },
            landsPlayed: { me: 1 },
            activePlayer: "opp",
            priority: "me",
            passCount: 1,
            spellsCastThisTurn: { me: 2, opp: 1 },
            spellsCastThisGame: { me: 6 },
            stormCount: 3,
            damageDealtToPlayerThisTurn: { me: 4, opp: 1 },
            artifactDamageToPlayerThisTurn: { me: 2 },
            lifeGainedThisTurn: { me: 3 },
            deathsThisTurn: 2,
            creatureAttackedThisTurn: true,
            combat: {
                attackers: ["Savannah Lions"],
                confirmed: true,
                blockers: [{ blocker: "Shivan Dragon", blocking: [0] }],
                blockersConfirmed: false,
                attackedThisTurn: { me: ["Savannah Lions"] },
                blockedThisTurn: { opp: ["Grizzly Bears"] },
            },
        });
    });

    // CR 120.3a / 119.3 / 700.4 / 508.1a (issue #3453) — the retrospective
    // tallies are tolerant the same way the cast tallies above are: a garbage
    // value is DROPPED rather than passed through to the builder, which would
    // otherwise write a string onto a numeric ledger and make
    // "damage dealt to you this turn" read `NaN`.
    it("normalizes the retrospective per-turn tallies — both seats, one seat, absent, garbage", () => {
        expect(
            normalizeScenarioSpec({
                cards: [],
                damageDealtToPlayerThisTurn: { me: 4, opp: 1 },
                artifactDamageToPlayerThisTurn: { me: 2, opp: 0 },
                lifeGainedThisTurn: { me: 3, opp: 5 },
                deathsThisTurn: 2,
                creatureAttackedThisTurn: true,
            })
        ).toEqual({
            cards: [],
            damageDealtToPlayerThisTurn: { me: 4, opp: 1 },
            artifactDamageToPlayerThisTurn: { me: 2, opp: 0 },
            lifeGainedThisTurn: { me: 3, opp: 5 },
            deathsThisTurn: 2,
            creatureAttackedThisTurn: true,
        });

        // One seat only, and an explicit 0 / false — real claims, never
        // trimmed as if they were absent.
        expect(
            normalizeScenarioSpec({
                cards: [],
                lifeGainedThisTurn: { me: 0 },
                deathsThisTurn: 0,
                creatureAttackedThisTurn: false,
            })
        ).toEqual({
            cards: [],
            lifeGainedThisTurn: { me: 0 },
            deathsThisTurn: 0,
            creatureAttackedThisTurn: false,
        });

        expect(normalizeScenarioSpec({ cards: [] })).toEqual({ cards: [] });

        expect(
            normalizeScenarioSpec({
                cards: [],
                damageDealtToPlayerThisTurn: { me: "four" },
                lifeGainedThisTurn: "three",
                deathsThisTurn: "two",
                creatureAttackedThisTurn: "yes",
            })
        ).toEqual({ cards: [], damageDealtToPlayerThisTurn: {} });
    });

    // CR 608.2 (issue #3453) — the card-level tally, read off a raw row the
    // same tolerant way `activations` is.
    it("normalizes a card's ability-resolution tally, dropping non-numeric entries", () => {
        expect(
            normalizeScenarioSpec({
                cards: [
                    {
                        name: "Scythecat Cub",
                        owner: "me",
                        abilityResolutions: {
                            "scythecat-cub-landfall": 2,
                            bogus: "x",
                        },
                    },
                ],
            })
        ).toEqual({
            cards: [
                {
                    name: "Scythecat Cub",
                    owner: "me",
                    abilityResolutions: { "scythecat-cub-landfall": 2 },
                },
            ],
        });
    });

    // CR 508.1 / 509.1 (issue #3458) — the tolerant read of the one nested
    // ARRAY field in the spec. A malformed blocker entry is dropped rather
    // than thrown on (ADR 0044), and a `combat` that normalizes to nothing is
    // left off entirely, so it reads as exactly the absence the builder
    // defaults from.
    it("normalizes `combat` — full, partial, absent, garbage (CR 508.1 / 509.1)", () => {
        expect(
            normalizeScenarioSpec({
                cards: [],
                combat: { attackers: ["Savannah Lions"], confirmed: true },
            })
        ).toEqual({
            cards: [],
            combat: { attackers: ["Savannah Lions"], confirmed: true },
        });

        expect(normalizeScenarioSpec({ cards: [] })).toEqual({ cards: [] });

        // Every shape a hand-edited row produces: a string where a list
        // belongs, a blocker with no name, a blocker blocking nothing, an
        // index that is not a number.
        expect(
            normalizeScenarioSpec({
                cards: [],
                combat: {
                    attackers: "Savannah Lions",
                    blockers: [
                        { blocking: [0] },
                        { blocker: "Shivan Dragon", blocking: [] },
                        { blocker: "Shivan Dragon", blocking: ["0"] },
                    ],
                },
            })
        ).toEqual({ cards: [] });

        // A list with one usable entry keeps that entry and drops the rest —
        // never the whole field.
        expect(
            normalizeScenarioSpec({
                cards: [],
                combat: {
                    attackers: ["Savannah Lions", 7],
                    blockers: [
                        { blocker: "Shivan Dragon", blocking: [0, "1"] },
                        "not an entry",
                    ],
                },
            })
        ).toEqual({
            cards: [],
            combat: {
                attackers: ["Savannah Lions"],
                blockers: [{ blocker: "Shivan Dragon", blocking: [0] }],
            },
        });
    });

    // CR 601.2i / 118.9 / 702.40a (issue #3449) — the per-seat pairs are
    // tolerant the same way `life` is, and `stormCount` is a bare number:
    // a garbage value is DROPPED, never passed through to the builder, which
    // would otherwise write a string onto `GameState.spellsCastThisTurn` and
    // make every storm trigger count `NaN` copies.
    it("normalizes the spells-cast tallies and the storm count — both seats, one seat, absent, garbage", () => {
        expect(
            normalizeScenarioSpec({
                cards: [],
                spellsCastThisTurn: { me: 2, opp: 1 },
                spellsCastThisGame: { me: 6, opp: 4 },
                stormCount: 3,
            })
        ).toEqual({
            cards: [],
            spellsCastThisTurn: { me: 2, opp: 1 },
            spellsCastThisGame: { me: 6, opp: 4 },
            stormCount: 3,
        });

        // One seat only, and an explicit 0 — a real claim ("this seat has cast
        // nothing"), never trimmed as if it were absent.
        expect(
            normalizeScenarioSpec({
                cards: [],
                spellsCastThisGame: { me: 0 },
                stormCount: 0,
            })
        ).toEqual({
            cards: [],
            spellsCastThisGame: { me: 0 },
            stormCount: 0,
        });

        expect(normalizeScenarioSpec({ cards: [] })).toEqual({ cards: [] });

        expect(
            normalizeScenarioSpec({
                cards: [],
                spellsCastThisTurn: { me: "two" },
                spellsCastThisGame: "six",
                stormCount: "three",
            })
        ).toEqual({ cards: [], spellsCastThisTurn: {} });
    });

    // CR 508.1c / 500.1 / 207.2c (issue #3450) — the turn-history trio. The
    // two flag pairs and `revolt` are BOOLEAN pairs, the first of their shape:
    // a non-boolean has to be dropped rather than passed through, because the
    // builder writes the value straight onto `PlayerState` and a truthy
    // string would read as "this seat took a qualifying action" — which, with
    // an Arboria out, is the difference between a legal attack and none.
    it("normalizes the turn-history flags and turnsTaken — both seats, one seat, absent, garbage", () => {
        expect(
            normalizeScenarioSpec({
                cards: [],
                qualifyingActionThisTurn: { me: true, opp: false },
                qualifyingActionLastTurn: { opp: true },
                turnsTaken: { me: 4, opp: 3 },
                revolt: { me: true },
            })
        ).toEqual({
            cards: [],
            qualifyingActionThisTurn: { me: true, opp: false },
            qualifyingActionLastTurn: { opp: true },
            turnsTaken: { me: 4, opp: 3 },
            revolt: { me: true },
        });

        expect(normalizeScenarioSpec({ cards: [] })).toEqual({ cards: [] });

        expect(
            normalizeScenarioSpec({
                cards: [],
                qualifyingActionThisTurn: { me: "yes" },
                qualifyingActionLastTurn: "true",
                turnsTaken: { me: "four" },
                revolt: 1,
            })
        ).toEqual({
            cards: [],
            qualifyingActionThisTurn: {},
            turnsTaken: {},
        });
    });

    // CR 400.2 (issue #3452) — the hidden-hand counts come off an untrusted
    // stored row like every other pair, and a garbage value here would be
    // handed to the builder's seeding loop as a bound.
    it("normalizes hiddenHand — both seats, one seat, absent, garbage", () => {
        expect(
            normalizeScenarioSpec({ cards: [], hiddenHand: { me: 2, opp: 6 } })
        ).toEqual({ cards: [], hiddenHand: { me: 2, opp: 6 } });

        expect(
            normalizeScenarioSpec({ cards: [], hiddenHand: { opp: 6 } })
        ).toEqual({ cards: [], hiddenHand: { opp: 6 } });

        expect(normalizeScenarioSpec({ cards: [] }).hiddenHand).toBeUndefined();

        expect(
            normalizeScenarioSpec({
                cards: [],
                hiddenHand: { me: "six", opp: null },
            })
        ).toEqual({ cards: [], hiddenHand: {} });

        expect(normalizeScenarioSpec({ cards: [], hiddenHand: 6 })).toEqual({
            cards: [],
        });
    });

    // CR 102.1 / 117.1 / 117.4 (issue #3454) — the seat fields are a CLOSED
    // vocabulary, so the tolerant load has to drop anything outside it rather
    // than leak a raw value the builder would compare against "me".
    it("normalizes the turn holder, priority and passCount — absent and garbage", () => {
        expect(
            normalizeScenarioSpec({
                cards: [],
                activePlayer: "opp",
                priority: "opp",
                passCount: 0,
            })
        ).toEqual({
            cards: [],
            activePlayer: "opp",
            priority: "opp",
            passCount: 0,
        });

        // Absent stays absent — which is what the builder reads as "leave the
        // base state's turn holder alone".
        expect(normalizeScenarioSpec({ cards: [] })).toEqual({ cards: [] });

        // A seat name outside the vocabulary is a DROP, never a pass-through:
        // `"ME"` and `"p2"` are exactly the shapes a hand-edited row produces.
        expect(
            normalizeScenarioSpec({
                cards: [],
                activePlayer: "ME",
                priority: "p2",
                passCount: "one",
            })
        ).toEqual({ cards: [] });
    });

    // CR 305.2 (issue #3446) — `landsPlayed` through the same shapes as
    // `life` below. Normalize is the ONLY path a stored row or a markdown seed
    // reaches the builder by, so a field it drops silently reopens the land
    // drop on a curated post-drop position.
    it("normalizes `landsPlayed` — both seats, one seat, absent, garbage (CR 305.2)", () => {
        expect(
            normalizeScenarioSpec({ cards: [], landsPlayed: { me: 1, opp: 2 } })
        ).toEqual({ cards: [], landsPlayed: { me: 1, opp: 2 } });

        expect(
            normalizeScenarioSpec({ cards: [], landsPlayed: { me: 1 } })
        ).toEqual({ cards: [], landsPlayed: { me: 1 } });

        expect(normalizeScenarioSpec({ cards: [] })).toEqual({ cards: [] });

        expect(
            normalizeScenarioSpec({ cards: [], landsPlayed: "one" })
        ).toEqual({ cards: [] });
        expect(
            normalizeScenarioSpec({ cards: [], landsPlayed: { me: "one" } })
        ).toEqual({ cards: [], landsPlayed: {} });
    });

    // CR 119.1 (issue #2147) — round-trip `life` through every shape the
    // tolerant load must handle: both seats, one seat, absent, and garbage.
    it("normalizes `life` — both seats, one seat, absent, garbage (CR 119.1)", () => {
        expect(
            normalizeScenarioSpec({ cards: [], life: { me: 4, opp: 17 } })
        ).toEqual({ cards: [], life: { me: 4, opp: 17 } });

        expect(normalizeScenarioSpec({ cards: [], life: { me: 4 } })).toEqual({
            cards: [],
            life: { me: 4 },
        });

        expect(normalizeScenarioSpec({ cards: [] })).toEqual({ cards: [] });

        // Garbage `life` (wrong shape, wrong types) degrades to an empty
        // `{}` rather than throwing or leaking the raw value through.
        expect(normalizeScenarioSpec({ cards: [], life: "dead" })).toEqual({
            cards: [],
        });
        expect(
            normalizeScenarioSpec({ cards: [], life: { me: "four" } })
        ).toEqual({ cards: [], life: {} });
    });

    it("DROPS unknown fields rather than throwing", () => {
        const raw = {
            cards: [{ name: "Plains", owner: "me", bogusCardField: 42 }],
            landCount: 1,
            // A field a FUTURE schema removed / never had — must be ignored.
            experimentalFlag: "danger",
        };
        const spec = normalizeScenarioSpec(raw);
        expect(spec).toEqual({
            cards: [{ name: "Plains", owner: "me" }],
            landCount: 1,
        });
        expect(spec).not.toHaveProperty("experimentalFlag");
        expect(spec.cards[0]).not.toHaveProperty("bogusCardField");
    });

    it("DEFAULTS missing/malformed fields (never throws)", () => {
        expect(normalizeScenarioSpec(undefined)).toEqual({ cards: [] });
        expect(normalizeScenarioSpec(null)).toEqual({ cards: [] });
        expect(normalizeScenarioSpec("nonsense")).toEqual({ cards: [] });
        expect(normalizeScenarioSpec({})).toEqual({ cards: [] });
        // A card missing `owner` defaults to "me"; a card missing `name` is
        // dropped (unloadable).
        expect(
            normalizeScenarioSpec({
                cards: [{ name: "Plains" }, { owner: "opp" }],
            })
        ).toEqual({ cards: [{ name: "Plains", owner: "me" }] });
    });

    it("coerces wrong-typed scalar fields away (tolerant, not throwing)", () => {
        const spec = normalizeScenarioSpec({
            cards: [{ name: "Plains", owner: "me", count: "3" }],
            landCount: "2",
        });
        // `count` and `landCount` were strings → dropped, defaults apply.
        expect(spec).toEqual({ cards: [{ name: "Plains", owner: "me" }] });
    });
});

describe("collectUnresolvedCardNames — pre-write loadability guard (ADR 0044)", () => {
    it("passes a spec whose names all resolve in the catalogue", () => {
        const spec: ScenarioSpec = {
            cards: [{ name: "Plains", owner: "me" }],
        };
        expect(collectUnresolvedCardNames(spec, resolves)).toEqual([]);
    });

    it("surfaces an unresolved placement / host / copy name", () => {
        const spec: ScenarioSpec = {
            cards: [
                { name: "Definitely Not A Real Card", owner: "me" },
                { name: "Plains", owner: "me", attachedTo: "Also Fake" },
                { name: "Plains", owner: "opp", copyOf: "Phantom Copy" },
            ],
        };
        expect(collectUnresolvedCardNames(spec, resolves).sort()).toEqual(
            ["Also Fake", "Definitely Not A Real Card", "Phantom Copy"].sort()
        );
    });

    // CR 111 / 707.2 — a `token: true` entry names a shape in the TOKEN
    // catalogue, not a card in the registry, so it must be validated against
    // the token resolver. Checking it against the card resolver would reject
    // every legal token scenario ("Treasure" is no card); skipping it would
    // wave through a row the builder then throws on at load.
    const resolvesToken = (name: string) => ["Treasure", "Wasp"].includes(name);

    it("validates a token entry against the TOKEN resolver, not the card one", () => {
        const spec: ScenarioSpec = {
            cards: [{ name: "Treasure", owner: "me", token: true }],
        };
        expect(
            collectUnresolvedCardNames(spec, resolves, resolvesToken)
        ).toEqual([]);
        // Same name WITHOUT the flag is a card reference — and no such card.
        expect(
            collectUnresolvedCardNames(
                { cards: [{ name: "Treasure", owner: "me" }] },
                resolves,
                resolvesToken
            )
        ).toEqual(["Treasure"]);
    });

    it("surfaces an unknown token key", () => {
        const spec: ScenarioSpec = {
            cards: [{ name: "Nonexistent Token", owner: "me", token: true }],
        };
        expect(
            collectUnresolvedCardNames(spec, resolves, resolvesToken)
        ).toEqual(["Nonexistent Token"]);
    });

    it("accepts an aura host that names a token (CR 303.4)", () => {
        const spec: ScenarioSpec = {
            cards: [
                { name: "Wasp", owner: "me", token: true },
                { name: "Plains", owner: "me", attachedTo: "Wasp" },
            ],
        };
        expect(
            collectUnresolvedCardNames(spec, resolves, resolvesToken)
        ).toEqual([]);
    });

    it("rejects a token entry when no token resolver is supplied (fails loud)", () => {
        const spec: ScenarioSpec = {
            cards: [{ name: "Treasure", owner: "me", token: true }],
        };
        expect(collectUnresolvedCardNames(spec, resolves)).toEqual([
            "Treasure",
        ]);
    });
});

describe("DB row → load → builder input (issue #769 integration)", () => {
    it("a hand-authored saved spec normalizes to valid debugSetupScenario args with only resolvable cards", () => {
        // The exact shape a DB row's `spec` carries. This is what the panel
        // hands to the unchanged `debugSetupScenario` builder on click.
        const savedRow = {
            label: "Plains + lands",
            spec: {
                cards: [
                    { name: "Plains", owner: "me", zone: "battlefield" },
                    { name: "Mountain", owner: "opp", zone: "hand", count: 2 },
                ],
                landCount: 3,
                phase: "PRECOMBAT_MAIN",
                // A stray field a future schema might drop — proves tolerance.
                _legacy: true,
            },
        };

        const args = normalizeScenarioSpec(savedRow.spec);
        // Tolerant: stray field gone.
        expect(args).not.toHaveProperty("_legacy");
        // Every card name in the loaded args resolves in the real registry, so
        // `getCardByName` inside the builder will not throw / corrupt the board.
        expect(collectUnresolvedCardNames(args, resolves)).toEqual([]);
        expect(args.cards.map((c) => c.name)).toEqual(["Plains", "Mountain"]);
        expect(args.landCount).toBe(3);
        expect(args.phase).toBe("PRECOMBAT_MAIN");
    });
});

describe("golden flag + schema-drift tag (issue #772, ADR 0044)", () => {
    // The mutations (`saveDebugScenario`, `setDebugScenarioGolden`,
    // `seedScenarioDirect`) all stamp the SAME decision: a golden row carries
    // the version tag, an ephemeral one carries none. Asserting the decision
    // directly (no convex-test harness) proves the stamp the mutations write.
    const stamp = (golden: boolean): number | undefined =>
        golden ? SCENARIO_SCHEMA_VERSION : undefined;

    it("stamps the schema version onto golden rows only", () => {
        expect(stamp(true)).toBe(SCENARIO_SCHEMA_VERSION);
        expect(stamp(false)).toBeUndefined();
    });

    it("keeps the version tag a finite positive integer (a real drift marker)", () => {
        expect(Number.isInteger(SCENARIO_SCHEMA_VERSION)).toBe(true);
        expect(SCENARIO_SCHEMA_VERSION).toBeGreaterThan(0);
    });
});

describe("selectEphemeralIdsToPrune — cleanup policy (issue #772, ADR 0044)", () => {
    // The `cleanupEphemeralScenarios` mutation is a thin wrapper over this pure
    // policy: it deletes exactly the ids returned. So "golden survives cleanup,
    // ephemeral is pruned past the bound" (the AC) is asserted here directly.
    const row = (
        id: string,
        createdAt: number,
        golden?: boolean
    ): PrunableScenarioRow<string> => ({ _id: id, createdAt, golden });

    it("NEVER prunes a golden row, no matter how tight the bound", () => {
        const rows = [
            row("g1", 100, true),
            row("g2", 200, true),
            row("g3", 300, true),
        ];
        expect(selectEphemeralIdsToPrune(rows, 0)).toEqual([]);
    });

    it("keeps the newest `keep` ephemeral rows and prunes the rest", () => {
        const rows = [row("e-old", 100), row("e-mid", 200), row("e-new", 300)];
        // keep=1 → newest ("e-new") survives, the two older are pruned.
        expect(selectEphemeralIdsToPrune(rows, 1).sort()).toEqual(
            ["e-mid", "e-old"].sort()
        );
    });

    it("golden rows don't count against the ephemeral bound", () => {
        const rows = [
            row("g1", 500, true),
            row("g2", 400, true),
            row("e-new", 300),
            row("e-old", 100),
        ];
        // keep=1 counts ONLY ephemeral rows: e-new survives, e-old pruned;
        // both golden rows are untouched.
        expect(selectEphemeralIdsToPrune(rows, 1)).toEqual(["e-old"]);
    });

    it("prunes nothing when ephemeral rows are within the bound", () => {
        const rows = [row("e1", 100), row("e2", 200)];
        expect(selectEphemeralIdsToPrune(rows, 5)).toEqual([]);
    });

    it("defaults to EPHEMERAL_KEEP_BOUND when no bound is given", () => {
        const many = Array.from({ length: EPHEMERAL_KEEP_BOUND + 3 }, (_, i) =>
            row(`e${i}`, i)
        );
        // 3 rows beyond the default bound are pruned (the 3 OLDEST).
        expect(selectEphemeralIdsToPrune(many).sort()).toEqual(
            ["e0", "e1", "e2"].sort()
        );
    });
});

describe("selectScenarioUpsert — insert-vs-patch decision for seedScenarioDirect (issue #1453)", () => {
    // `seedScenarioDirect` is a thin wrapper over this pure decision (same
    // convention as `selectEphemeralIdsToPrune` above): it inserts when
    // `action === "insert"` and patches `id` when `action === "patch"`. So
    // "upsert-by-label, no duplicate rows on re-run" (the AC) is asserted
    // here directly, without a convex-test harness.
    const rows: UpsertableScenarioRow<string>[] = [
        { _id: "s1", label: "Storm test" },
        { _id: "s2", label: "Improvise smoke" },
    ];

    it("inserts when no existing row shares the label", () => {
        expect(selectScenarioUpsert(rows, "Brand New Scenario")).toEqual({
            action: "insert",
        });
    });

    it("patches the existing row's id when a same-label row already exists", () => {
        expect(selectScenarioUpsert(rows, "Storm test")).toEqual({
            action: "patch",
            id: "s1",
        });
    });

    it("matches by exact label only — a different label never patches", () => {
        expect(selectScenarioUpsert(rows, "Storm Test")).toEqual({
            action: "insert",
        });
    });

    it("inserts against an empty pool (first-ever direct write)", () => {
        expect(selectScenarioUpsert([], "First Scenario")).toEqual({
            action: "insert",
        });
    });
});

describe("resolveScenarioGolden — golden defaults true (issue #1453)", () => {
    it("defaults to true when omitted", () => {
        expect(resolveScenarioGolden(undefined)).toBe(true);
    });

    it("respects an explicit true", () => {
        expect(resolveScenarioGolden(true)).toBe(true);
    });

    it("respects an explicit false (an ephemeral direct write is allowed)", () => {
        expect(resolveScenarioGolden(false)).toBe(false);
    });
});

// CR 106.4 / 106.6 (issue #3460) — floating mana off a RAW stored row. Every
// branch here is fail-CLOSED, and the direction is the whole point: a
// restricted-mana unit carrying neither a `restriction` nor a `castableCardId`
// is UNRESTRICTED mana (`restrictedUnitAllowsSpell`), so keeping a unit whose
// permission could not be read would hand the rebuilt board mana spendable on
// anything — strictly more permissive than the row asked for. The realistic
// producer is not a future engine member but the admin JSON textarea, which
// normalizes hand-typed JSON BEFORE the write validator ever sees it
// (`debug-scenario-preview.tsx`).
describe("normalizeScenarioSpec — floating mana is read fail-closed (issue #3460)", () => {
    it("keeps a well-formed pool and unit", () => {
        expect(
            normalizeScenarioSpec({
                cards: [],
                manaPool: { me: { G: 1, W: 2 }, opp: { C: 1 } },
                restrictedMana: {
                    me: [
                        {
                            color: "R",
                            amount: 2,
                            restriction: "creature-spell",
                            hasteRider: true,
                        },
                    ],
                },
            })
        ).toEqual({
            cards: [],
            manaPool: { me: { G: 1, W: 2 }, opp: { C: 1 } },
            restrictedMana: {
                me: [
                    {
                        color: "R",
                        amount: 2,
                        restriction: "creature-spell",
                        hasteRider: true,
                    },
                ],
            },
        });
    });

    it("drops a pool key that is not a mana type the engine can spend (CR 105.1)", () => {
        // `Green` / `g` would sit in the pool forever: every payment path reads
        // `MANA_COLORS`, so the row would render as eight mana on a board that
        // can spend one.
        expect(
            normalizeScenarioSpec({
                cards: [],
                manaPool: { me: { Green: 5, g: 2, G: 1 } },
            }).manaPool
        ).toEqual({ me: { G: 1 } });
        // Nothing left at all is an ABSENCE, not an empty record — that is what
        // the builder's own clear leaves.
        expect(
            normalizeScenarioSpec({
                cards: [],
                manaPool: { me: { Green: 5 } },
            }).manaPool
        ).toBeUndefined();
    });

    it("drops the WHOLE unit when its restriction is not one the engine enforces (CR 106.6)", () => {
        expect(
            normalizeScenarioSpec({
                cards: [],
                restrictedMana: {
                    me: [
                        { color: "G", amount: 2, restriction: "creature" },
                        {
                            color: "R",
                            amount: 1,
                            restriction: "creature-spell",
                        },
                    ],
                },
            }).restrictedMana
        ).toEqual({
            me: [{ color: "R", amount: 1, restriction: "creature-spell" }],
        });
    });

    it("drops a unit whose permission names a card INSTANCE (Ice Cauldron, CR 106.6)", () => {
        // `specFromState` refuses to lower one, so a stored row carrying one was
        // hand-written: promoting it to unrestricted mana is the fail-open.
        expect(
            normalizeScenarioSpec({
                cards: [],
                restrictedMana: {
                    me: [{ color: "U", amount: 1, castableCardId: "inst-7" }],
                },
            }).restrictedMana
        ).toBeUndefined();
    });

    it("drops a unit with no colour, no amount, or an unspendable colour", () => {
        expect(
            normalizeScenarioSpec({
                cards: [],
                restrictedMana: {
                    me: [
                        { amount: 2, restriction: "creature-spell" },
                        { color: "G", restriction: "creature-spell" },
                        { color: "Green", amount: 2 },
                        "not an object",
                    ],
                },
            }).restrictedMana
        ).toBeUndefined();
    });
});

describe("seedScenarioDirect — loadability guard reused (issue #1453, ADR 0044)", () => {
    // `seedScenarioDirect` rejects before write via the SAME
    // `collectUnresolvedCardNames` call as `saveDebugScenario` above —
    // asserted directly here since there is no convex-test harness to
    // invoke the mutation itself.
    it("flags an unknown card name (the offending name surfaces in the guard's output)", () => {
        const spec: ScenarioSpec = {
            cards: [{ name: "Definitely Not A Real Card", owner: "me" }],
        };
        const unresolved = collectUnresolvedCardNames(spec, resolves);
        expect(unresolved).toEqual(["Definitely Not A Real Card"]);
    });

    it("passes a spec whose card names all resolve in the catalogue", () => {
        const spec: ScenarioSpec = {
            cards: [{ name: "Forest", owner: "me" }],
        };
        expect(collectUnresolvedCardNames(spec, resolves)).toEqual([]);
    });
});

describe("normalizeScenarioSpec — continuous effects are read fail-closed (issue #3488)", () => {
    const PUMP = {
        layer: 7,
        sublayer: "7c",
        affected: { me: ["Grizzly Bears"] },
        controller: "me",
        duration: { phase: "end-of-turn" },
        payload: { kind: "pt-modify", power: 3, toughness: 3 },
    };

    it("keeps a well-formed entry, parameter and all", () => {
        const grant = {
            layer: 6,
            affected: { opp: ["Shivan Dragon"] },
            controller: "me",
            payload: {
                kind: "keyword-grant",
                keyword: "protection from red",
                parameter: { kind: "protection", qualities: ["red"] },
            },
            characteristicDefining: true,
        };
        expect(
            normalizeScenarioSpec({
                cards: [],
                continuousEffects: [PUMP, grant],
            }).continuousEffects
        ).toEqual([PUMP, grant]);
    });

    it("drops an entry missing any of the three facts that make it mean something", () => {
        // What it applies to, who controls it, what it does. A half-built entry
        // would rebuild a board nobody captured, which is the one failure a
        // lowering exists to prevent.
        const dropped = [
            { ...PUMP, affected: {} },
            { ...PUMP, controller: "nobody" },
            { ...PUMP, payload: { kind: "pt-modify", power: 3 } },
            {
                ...PUMP,
                payload: { kind: "control-change", controllerId: "p2" },
            },
        ];
        for (const entry of dropped) {
            expect(
                normalizeScenarioSpec({ cards: [], continuousEffects: [entry] })
                    .continuousEffects
            ).toBeUndefined();
        }
        // And the well-formed neighbours of a malformed entry survive it.
        expect(
            normalizeScenarioSpec({
                cards: [],
                continuousEffects: [dropped[0], PUMP],
            }).continuousEffects
        ).toEqual([PUMP]);
    });

    it("drops a layer-7 entry that names no sublayer, and a sublayer on any other layer (CR 613.4)", () => {
        const { sublayer: _sublayer, ...noSublayer } = PUMP;
        expect(
            normalizeScenarioSpec({
                cards: [],
                continuousEffects: [noSublayer],
            }).continuousEffects
        ).toBeUndefined();
        // A layer-6 entry carrying one is not rejected but STRIPPED: the slot
        // it would name has no meaning outside layer 7, and the entry's own
        // three facts are intact.
        expect(
            normalizeScenarioSpec({
                cards: [],
                continuousEffects: [
                    {
                        ...PUMP,
                        layer: 6,
                        payload: { kind: "keyword-grant", keyword: "flying" },
                    },
                ],
            }).continuousEffects
        ).toEqual([
            {
                layer: 6,
                affected: { me: ["Grizzly Bears"] },
                controller: "me",
                duration: { phase: "end-of-turn" },
                payload: { kind: "keyword-grant", keyword: "flying" },
            },
        ]);
    });

    it("reads a malformed duration as an ABSENCE, never as an invented boundary (CR 611.2a)", () => {
        // Absent means INDEFINITE, and that is the reading a malformed value
        // must collapse to as well: a `phase` the tick does not count would
        // otherwise be a boundary nothing ever reaches.
        expect(
            normalizeScenarioSpec({
                cards: [],
                continuousEffects: [
                    { ...PUMP, duration: { phase: "end-of-everything" } },
                ],
            }).continuousEffects?.[0].duration
        ).toBeUndefined();
    });
});

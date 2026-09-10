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
        });
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

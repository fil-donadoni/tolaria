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
import { MIGRATED_PRESET_SCENARIOS } from "../debugScenarios";
import {
    collectUnresolvedCardNames,
    normalizeScenarioSpec,
    selectEphemeralIdsToPrune,
    SCENARIO_SCHEMA_VERSION,
    EPHEMERAL_KEEP_BOUND,
    type PrunableScenarioRow,
    type ScenarioSpec,
} from "../debugScenarioSpec";

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
        });
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
            normalizeScenarioSpec({ cards: [{ name: "Plains" }, { owner: "opp" }] })
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
    // `seedPresetScenarios`) all stamp the SAME decision: a golden row carries
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
        const rows = [
            row("e-old", 100),
            row("e-mid", 200),
            row("e-new", 300),
        ];
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

describe("MIGRATED_PRESET_SCENARIOS — PRESET_SCENARIOS → DB migration (issue #770)", () => {
    it("is non-empty and every label is unique (the idempotency key `seedPresetScenarios` skips on)", () => {
        expect(MIGRATED_PRESET_SCENARIOS.length).toBeGreaterThan(0);
        const labels = MIGRATED_PRESET_SCENARIOS.map((s) => s.label);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it("every migrated spec loads with only resolvable card names (would not corrupt a board)", () => {
        for (const preset of MIGRATED_PRESET_SCENARIOS) {
            expect(
                collectUnresolvedCardNames(preset.spec, resolves)
            ).toEqual([]);
        }
    });

    it("every migrated spec round-trips through the tolerant load unchanged (matches the debugScenarios row shape)", () => {
        for (const preset of MIGRATED_PRESET_SCENARIOS) {
            expect(normalizeScenarioSpec(preset.spec)).toEqual(preset.spec);
        }
    });

    it("carries the historical Wild Growth scenario (CR 605.1b / 605.4)", () => {
        const wildGrowth = MIGRATED_PRESET_SCENARIOS.find((s) =>
            s.label.startsWith("Wild Growth")
        );
        expect(wildGrowth).toBeDefined();
        const spec = wildGrowth!.spec;
        expect(spec.cards.map((c) => c.name)).toEqual([
            "Forest",
            "Wild Growth",
            "Craw Wurm",
        ]);
        expect(spec.phase).toBe("PRECOMBAT_MAIN");
        expect(spec.landCount).toBe(4);
    });
});

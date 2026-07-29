// Dominance pruning (issue #1887) — the "provably dominated by `pass`" seam.
//
// Every assertion here is a DOMINANCE PROOF, not a heuristic score: the seam
// applies the move on a clone, resolves it to completion and requires exact
// equality with the untouched baseline in every term but the mover's own cost.
// So each case is stated twice — the futile position (pruned) and its NEGATIVE
// CONTROL, the same card in a position where it does something (never pruned).

import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import {
    isDominatedNoOpMove,
    deepEqual,
    dominanceProbeStats,
    resetDominanceProbeStats,
} from "../dominance";
import { tryGetDefinition } from "../../../cards";
import { searchWithTrace } from "../../search";

/** Build a position from a bare `ScenarioSpec`, reusing the blade harness so
 *  these tests and the blade registry entries describe boards the same way. */
function build(
    spec: BladeScenario["spec"],
    setup?: BladeScenario["setup"]
): GameState {
    return buildBladeState({
        label: "dominance-unit",
        spec,
        ...(setup ? { setup } : {}),
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

function me(state: GameState): string {
    return state.players[0].id;
}

function castsOf(state: GameState, name: string, pruned: boolean): Move[] {
    return enumerateMoves(
        state,
        me(state),
        pruned ? { pruneDominatedNoOps: true } : undefined
    ).filter(
        (m) =>
            m.kind === "cast-spell" &&
            cardName(state, m.cardInstanceId) === name
    );
}

/** Instance id → card NAME. Production instances carry `card: { id }` only, so
 *  the name comes from the registry, never from the instance. */
function cardName(state: GameState, instanceId: string): string | undefined {
    for (const p of state.players) {
        for (const zone of [p.hand, p.battlefield, p.graveyard]) {
            const found = zone.find((c) => c.id === instanceId);
            if (found) {
                return tryGetDefinition(
                    (found.card as { id?: string }).id ?? ""
                )?.name;
            }
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------

describe("isDominatedNoOpMove — sweepers (CR 608.2, issue #1887)", () => {
    it("proves Damnation on a creature-free board is dominated by pass", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Damnation", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
    });

    it("NEGATIVE CONTROL: Damnation with creatures out is never dominated", () => {
        const state = build({
            cards: [
                { name: "Damnation", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Damnation", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
    });

    it("drops the futile Damnation from the pruned enumeration, keeps pass", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const pruned = enumerateMoves(state, me(state), {
            pruneDominatedNoOps: true,
        });
        expect(castsOf(state, "Damnation", true)).toHaveLength(0);
        expect(pruned.some((m) => m.kind === "pass")).toBe(true);
        expect(pruned.length).toBeGreaterThan(0);
    });

    it("keeps the useful Damnation in the pruned enumeration", () => {
        const state = build({
            cards: [
                { name: "Damnation", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        expect(castsOf(state, "Damnation", true).length).toBeGreaterThan(0);
    });
});

describe("isDominatedNoOpMove — edicts (CR 700.2 modal, issue #1887)", () => {
    it("proves every Sheoldred's Edict mode is a no-op against an empty board", () => {
        const state = build({
            cards: [{ name: "Sheoldred's Edict", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Sheoldred's Edict", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
        expect(castsOf(state, "Sheoldred's Edict", true)).toHaveLength(0);
    });

    it("NEGATIVE CONTROL: keeps the Edict when the opponent has a creature", () => {
        const state = build({
            cards: [
                { name: "Sheoldred's Edict", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        expect(
            castsOf(state, "Sheoldred's Edict", true).length
        ).toBeGreaterThan(0);
    });
});

describe("isDominatedNoOpMove — activated abilities (CR 602.2, issue #1887)", () => {
    const salvagerSpec: BladeScenario["spec"] = {
        cards: [
            {
                name: "Sandstorm Salvager",
                owner: "me",
                zone: "battlefield",
                summoningSick: false,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 4,
        libraryCount: 20,
    };

    function activationsOf(state: GameState, pruned: boolean): Move[] {
        return enumerateMoves(
            state,
            me(state),
            pruned ? { pruneDominatedNoOps: true } : undefined
        ).filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "sandstorm-salvager-token-buff"
        );
    }

    it("proves the Salvager's token buff is a no-op with no tokens out", () => {
        const state = build(salvagerSpec);
        const activations = activationsOf(state, false);
        expect(activations.length).toBeGreaterThan(0);
        for (const move of activations) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
        expect(activationsOf(state, true)).toHaveLength(0);
    });

    it("NEGATIVE CONTROL: keeps the buff once a Golem token is on the board", () => {
        // The token arrives through the card's OWN ETB trigger, resolved by the
        // real engine — no hand-seeded token (ADR 0070 §4).
        const state = build(salvagerSpec, [
            { kind: "etb-trigger", card: "Sandstorm Salvager" },
            { kind: "resolve-top" },
        ]);
        expect(state.players[0].battlefield.some((c) => c.isToken)).toBe(true);
        const activations = activationsOf(state, false);
        expect(activations.length).toBeGreaterThan(0);
        for (const move of activations) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
        expect(activationsOf(state, true).length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Review finding 1 (issue #1905): the mover's MANA POOL is a delta, not a cost.
// ---------------------------------------------------------------------------

describe("rituals are never dominated — the pool is a delta (issue #1905)", () => {
    // A position that CANNOT pass by accident: the same hand also holds a
    // genuine no-op (Damnation on a creature-free board). If the pool ever goes
    // back on the mover's ignore list the ritual is pruned while Damnation
    // stays pruned, so the `dominated` assertion below is the discriminator —
    // "nothing here is prunable" would fail the Damnation half instead.
    const spec = (ritual: string): BladeScenario["spec"] => ({
        cards: [
            { name: ritual, owner: "me", zone: "hand" },
            { name: "Damnation", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 8,
        libraryCount: 20,
    });

    for (const ritual of ["Dark Ritual", "Cabal Ritual"]) {
        it(`${ritual} adds mana, so it is never proved dominated by pass`, () => {
            const state = build(spec(ritual));
            const casts = castsOf(state, ritual, false);
            expect(casts.length).toBeGreaterThan(0);
            for (const move of casts) {
                expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
            }
            // …and it SURVIVES the pruned enumeration the bot paths use.
            expect(castsOf(state, ritual, true).length).toBeGreaterThan(0);
        });

        it(`${ritual} shares its position with a genuine no-op that IS pruned`, () => {
            // The discriminator: the same board, the same enumeration, one
            // move dropped and one kept. A pruner that kept everything (or
            // dropped everything) fails one half or the other.
            const state = build(spec(ritual));
            expect(castsOf(state, "Damnation", true)).toHaveLength(0);
            expect(castsOf(state, ritual, true).length).toBeGreaterThan(0);
        });
    }

    it("Cabal Ritual is kept on BOTH sides of its threshold branch", () => {
        // The `if` predicate picks {B}{B}{B}{B}{B} at seven cards in the
        // graveyard and {B}{B}{B} below it — both are mana, both are deltas.
        const state = build({
            cards: [
                { name: "Cabal Ritual", owner: "me", zone: "hand" },
                ...Array.from({ length: 7 }, () => ({
                    name: "Dark Ritual",
                    owner: "me" as const,
                    zone: "graveyard" as const,
                })),
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 8,
            libraryCount: 20,
        });
        expect(state.players[0].graveyard.length).toBeGreaterThanOrEqual(7);
        expect(castsOf(state, "Cabal Ritual", true).length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Review finding 2 (issue #1905): the all-branches choice/mode quantifier.
// ---------------------------------------------------------------------------

describe("mid-resolution choice quantifier (CR 601.2b, issue #1905)", () => {
    // Searing Rays ({2}{R} sorcery) suspends MID-RESOLUTION on an `optionChoice`
    // ("choose a color"), unlike Sheoldred's Edict whose modes are picked at
    // CAST time and enumerated as separate `chosenModeId` moves. Each mode then
    // deals damage equal to a creature count — so the position decides whether
    // the branch is a no-op, which is exactly what the quantifier is for.
    const spec = (opponentCreature?: string): BladeScenario["spec"] => ({
        cards: [
            { name: "Searing Rays", owner: "me", zone: "hand" },
            ...(opponentCreature
                ? [
                      {
                          name: opponentCreature,
                          owner: "opp" as const,
                          zone: "battlefield" as const,
                          summoningSick: false,
                      },
                  ]
                : []),
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 6,
        libraryCount: 20,
    });

    it("ALL branches no-op → pruned, and the branches were really opened", () => {
        const state = build(spec());
        const casts = castsOf(state, "Searing Rays", false);
        expect(casts.length).toBeGreaterThan(0);
        resetDominanceProbeStats();
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(true);
        }
        // Without this the test could not tell "every colour proved a no-op"
        // from "the probe never reached the choice at all" — the exact hole the
        // review flagged. Five colours per probe.
        const opened = dominanceProbeStats().choiceBranches;
        expect(opened).toBeGreaterThanOrEqual(5 * casts.length);
        expect(castsOf(state, "Searing Rays", true)).toHaveLength(0);
    });

    it("ONE useful branch → kept (a single green creature is enough)", () => {
        // Grizzly Bears is green: the Green branch deals 1 to its controller,
        // the other four branches are still no-ops. One counterexample must
        // defeat the universal quantifier.
        const state = build(spec("Grizzly Bears"));
        const casts = castsOf(state, "Searing Rays", false);
        expect(casts.length).toBeGreaterThan(0);
        resetDominanceProbeStats();
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
        expect(dominanceProbeStats().choiceBranches).toBeGreaterThan(0);
        expect(castsOf(state, "Searing Rays", true).length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Review finding 3 (issue #1905): the probe must not scale with the search.
// ---------------------------------------------------------------------------

describe("probe cost is O(root moves), not O(iterations) (issue #1905)", () => {
    const spec: BladeScenario["spec"] = {
        cards: [
            { name: "Damnation", owner: "me", zone: "hand" },
            { name: "Dark Ritual", owner: "me", zone: "hand" },
            { name: "Lightning Bolt", owner: "me", zone: "hand" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 8,
        landCount: 8,
        libraryCount: 30,
    };

    it("a longer search runs exactly as many probes as a short one", () => {
        // The regression this pins: probing inside `keyedMovesFor` ran at every
        // tree node of every iteration — 1682 probed enumerations for a
        // 300-iteration search, 42.6% of its wall clock. Since the budget is
        // ITERATION-based that is a straight ~1.75× think-time regression, and
        // a wall-clock assertion would be too flaky to pin it. The probe COUNT
        // is deterministic, so assert on that: it is a function of the root
        // move list alone.
        const state = build(spec);
        const pid = me(state);

        resetDominanceProbeStats();
        searchWithTrace(state, pid, { iterations: 40 }, 7);
        const short = dominanceProbeStats().probes;

        resetDominanceProbeStats();
        searchWithTrace(state, pid, { iterations: 400 }, 7);
        const long = dominanceProbeStats().probes;

        expect(short).toBeGreaterThan(0);
        expect(long).toBe(short);
        // …and one root enumeration's worth, nothing more.
        resetDominanceProbeStats();
        enumerateMoves(state, pid, { pruneDominatedNoOps: true });
        expect(short).toBe(dominanceProbeStats().probes);
    }, 60000);

    it("the dominated move is kept out of the TREE, not just the move list", () => {
        // `selectRootMove` picks among the root's CHILD EDGES, so pruning the
        // root `moves` list alone would leave the no-op openable, visited and
        // selectable. The root deny-set is what actually removes it.
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const pid = me(state);
        const { move, trace } = searchWithTrace(
            state,
            pid,
            { iterations: 120 },
            11
        );
        expect(move?.kind).not.toBe("cast-spell");
        const damnations = (trace?.candidates ?? []).filter(
            (c) =>
                c.move.kind === "cast-spell" &&
                cardName(state, c.move.cardInstanceId) === "Damnation"
        );
        expect(damnations).toHaveLength(0);
    }, 60000);
});

describe("dominance pruning guards (issue #1887)", () => {
    it("is OFF by default — the human legal-actions surface keeps every legal cast", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        expect(castsOf(state, "Damnation", false).length).toBeGreaterThan(0);
    });

    it("never prunes a land drop", () => {
        const state = build({
            cards: [{ name: "Swamp", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const pruned = enumerateMoves(state, me(state), {
            pruneDominatedNoOps: true,
        });
        expect(pruned.some((m) => m.kind === "play-land")).toBe(true);
    });

    it("never prunes a permanent spell — board presence is a real delta", () => {
        const state = build({
            cards: [{ name: "Chrome Mox", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 4,
            libraryCount: 20,
        });
        const casts = castsOf(state, "Chrome Mox", false);
        expect(casts.length).toBeGreaterThan(0);
        for (const move of casts) {
            expect(isDominatedNoOpMove(state, me(state), move)).toBe(false);
        }
    });

    it("never empties the move list — pass always survives", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const pruned = enumerateMoves(state, me(state), {
            pruneDominatedNoOps: true,
        });
        expect(pruned.length).toBeGreaterThan(0);
        expect(pruned[0]).toEqual({ kind: "pass" });
    });

    it("the probe is pure — the caller's state is byte-identical afterwards", () => {
        const state = build({
            cards: [{ name: "Damnation", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 6,
            libraryCount: 20,
        });
        const before = structuredClone(
            JSON.parse(JSON.stringify(state)) as unknown
        );
        const casts = castsOf(state, "Damnation", false);
        for (const move of casts) isDominatedNoOpMove(state, me(state), move);
        const after = JSON.parse(JSON.stringify(state)) as unknown;
        expect(deepEqual(before, after)).toBe(true);
    });
});

describe("deepEqual (issue #1887)", () => {
    it("treats an absent key and an explicit undefined as equal", () => {
        expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
        expect(deepEqual({ a: 1 }, { a: 1, b: 0 })).toBe(false);
    });

    it("is order-independent on keys and order-SENSITIVE on arrays", () => {
        expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
        expect(deepEqual([1, 2], [2, 1])).toBe(false);
    });

    it("compares nested structures by value", () => {
        expect(deepEqual({ a: [{ b: 1 }] }, { a: [{ b: 1 }] })).toBe(true);
        expect(deepEqual({ a: [{ b: 1 }] }, { a: [{ b: 2 }] })).toBe(false);
    });
});

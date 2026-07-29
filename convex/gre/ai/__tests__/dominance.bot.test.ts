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
import { isDominatedNoOpMove, deepEqual } from "../dominance";
import { tryGetDefinition } from "../../../cards";

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

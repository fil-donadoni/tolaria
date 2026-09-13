// Issue #3190 — `buildTriggerStateView` must build the board-wide layer state
// ONCE per call, not once per permanent.
//
// The reducer fills every battlefield entry with EFFECTIVE P/T (CR 613.4). It
// used to do that through the `effectivePower` / `effectiveToughness`
// wrappers, and each wrapper rebuilds the whole `LayerStateView` from
// `players` — so one view build was O(N²) on the permanent count, and the
// battlefield's per-card `getActivatable` made a render O(N³). Measured on the
// UI stress board (83 permanents): 1.63 ms per call, ~135 ms of a ~300 ms
// main-thread longtask per server push.
//
// Counting is done WITHOUT a mock: the `players` rows expose `battlefield`
// through a getter, so every layer-state build is observable from the real
// code path (`toLayerState` maps `p.battlefield`). A mock of
// `~/lib/effective-stats` would not see it — the wrappers call `toLayerState`
// module-locally.
import { describe, it, expect } from "vitest";
import { buildTriggerStateView } from "../card-utils";
import { effectivePower, effectiveToughness } from "../effective-stats";
import type { ContinuousEffect } from "@convex/gre/continuousEffects";
import type { CardInstance, Player } from "~/types/game";

// Known card ids from convex/cards/sets/lea.ts (same fixtures as
// `effective-stats.test.ts` — never a second copy of the catalogue).
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";
const CASTLE = "b0da8d56-3178-44c2-9344-95d2346d326f";

function creature(id: string, overrides: Partial<CardInstance> = {}) {
    return {
        id,
        card: { id: SAVANNAH_LIONS },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        power: 2,
        toughness: 1,
        ...overrides,
    } as CardInstance;
}

/** CR 613.1d — Castle's "+0/+2 to untapped creatures you control": a layer-7d
 *  static effect that is invisible to a walk which forgets the board. */
function castle(): CardInstance {
    return {
        id: "castle",
        card: { id: CASTLE },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        types: ["Enchantment"],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
    } as CardInstance;
}

/** CR 613.4c — one layer-7c until-end-of-turn pump as the Continuous Effects
 *  Registry stores it (ADR 0082, PRD #2064 S6), the shape the wire carries. */
function pumpEntry(
    instanceId: string,
    power: number,
    toughness: number
): ContinuousEffect {
    return {
        id: `ce-pump-${instanceId}`,
        layer: 7,
        sublayer: "7c",
        timestamp: 1,
        expiry: {
            kind: "duration",
            duration: { phase: "end-of-turn" },
            controllerId: "me",
        },
        affected: { kind: "instances", instanceIds: [instanceId] },
        payload: { kind: "pt-modify", power, toughness },
        characteristicDefining: false,
    };
}

/** A one-seat player list whose `battlefield` reads are counted. Every
 *  layer-state build walks `players` and touches this getter exactly once, so
 *  the counter IS the build count (plus the reducer's own single pass). */
function countingBoard(permanentCount: number) {
    const battlefield = Array.from({ length: permanentCount }, (_, i) =>
        creature(`c${i}`)
    );
    let reads = 0;
    const players = [
        {
            id: "me",
            life: 20,
            hand: [] as unknown[],
            graveyard: [] as CardInstance[],
            get battlefield() {
                reads += 1;
                return battlefield;
            },
        },
    ];
    return { players, reads: () => reads };
}

describe("buildTriggerStateView — one shared layer-state build per call (issue #3190, CR 613)", () => {
    it("walks the board a number of times INDEPENDENT of the permanent count", () => {
        const small = countingBoard(2);
        buildTriggerStateView(small.players, "me");
        const large = countingBoard(12);
        buildTriggerStateView(large.players, "me");

        // Before the fix: 1 (the reducer's own map) + 2 per permanent (the
        // `effectivePower` + `effectiveToughness` wrappers each rebuilding the
        // layer state) — 5 vs 25 here. After: the reducer's own map plus ONE
        // shared build, whatever N is.
        expect(large.reads()).toBe(small.reads());
        expect(large.reads()).toBeLessThanOrEqual(2);
    });

    it("still costs the same single build with a 60-permanent board (no hidden per-card walk)", () => {
        const board = countingBoard(60);
        buildTriggerStateView(board.players, "me");
        expect(board.reads()).toBeLessThanOrEqual(2);
    });
});

describe("buildTriggerStateView — the shared build derives the SAME effective P/T (CR 613.4)", () => {
    // Acceptance criterion 3: the shared layer state must not silently drop
    // `continuousEffects` (or any other input the per-permanent wrappers got).
    // Asserted two ways — concrete numbers, and parity with the untouched
    // `effectivePower`/`effectiveToughness` wrappers, which ARE the
    // pre-change computation.
    const lion = creature("lion");
    const players = [
        {
            id: "me",
            life: 20,
            hand: [],
            graveyard: [],
            battlefield: [lion, castle()],
        },
    ] as unknown as Player[];
    const continuousEffects = [pumpEntry("lion", 1, 1)];

    it("applies a layer-7d static anthem and a layer-7c registry pump together", () => {
        const view = buildTriggerStateView(
            players,
            "me",
            undefined,
            undefined,
            undefined,
            continuousEffects
        );
        const entry = view.players[0].battlefield.find((c) => c.id === "lion")!;
        // Savannah Lions 2/1, +0/+2 from Castle (untapped), +1/+1 from the pump.
        expect(entry.power).toBe(3);
        expect(entry.toughness).toBe(4);
    });

    it("matches the per-permanent wrappers field for field", () => {
        const view = buildTriggerStateView(
            players,
            "me",
            undefined,
            undefined,
            undefined,
            continuousEffects
        );
        const entry = view.players[0].battlefield.find((c) => c.id === "lion")!;
        expect(entry.power).toBe(
            effectivePower(players, lion, undefined, continuousEffects)
        );
        expect(entry.toughness).toBe(
            effectiveToughness(players, lion, undefined, continuousEffects)
        );
    });

    it("drops the pump when no continuousEffects are passed (the input is really read)", () => {
        const view = buildTriggerStateView(players, "me");
        const entry = view.players[0].battlefield.find((c) => c.id === "lion")!;
        expect(entry.power).toBe(2);
        expect(entry.toughness).toBe(3);
    });
});

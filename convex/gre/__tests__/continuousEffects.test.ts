import { describe, expect, it } from "vitest";
import {
    compareContinuousEffects,
    continuousEffectsInLayer,
    type ContinuousEffect,
} from "../continuousEffects";
import { applySourceStaticEffects } from "../state";
import type { GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { crusade } from "../../cards/sets/lea/white";

/** Minimal registry entry; every field an assertion cares about is overridden
 *  at the call site so the defaults never carry meaning. */
function entry(overrides: Partial<ContinuousEffect> = {}): ContinuousEffect {
    return {
        id: "ce-1",
        layer: 6,
        timestamp: 1,
        expiry: { kind: "indefinite" },
        affected: { kind: "instances", instanceIds: ["c1"] },
        payload: { kind: "keyword-grant", keyword: "flying" },
        characteristicDefining: false,
        ...overrides,
    } as ContinuousEffect;
}

function stateWith(entries: ContinuousEffect[]): GameState {
    return makeState({ continuousEffects: entries });
}

describe("continuousEffectsInLayer — CR 613.7 ordering authority", () => {
    it("returns the layer's entries in ascending timestamp order (CR 613.7)", () => {
        const state = stateWith([
            entry({ id: "ce-late", layer: 6, timestamp: 30 }),
            entry({ id: "ce-early", layer: 6, timestamp: 10 }),
            entry({ id: "ce-mid", layer: 6, timestamp: 20 }),
        ]);
        expect(continuousEffectsInLayer(state, 6).map((e) => e.id)).toEqual([
            "ce-early",
            "ce-mid",
            "ce-late",
        ]);
    });

    it("does not mutate the stored registry order", () => {
        const state = stateWith([
            entry({ id: "ce-late", layer: 6, timestamp: 30 }),
            entry({ id: "ce-early", layer: 6, timestamp: 10 }),
        ]);
        continuousEffectsInLayer(state, 6);
        expect(state.continuousEffects?.map((e) => e.id)).toEqual([
            "ce-late",
            "ce-early",
        ]);
    });

    it("excludes entries from other layers (CR 613.1b-g)", () => {
        const state = stateWith([
            entry({ id: "ce-l2", layer: 2, timestamp: 1 }),
            entry({ id: "ce-l6", layer: 6, timestamp: 2 }),
            entry({
                id: "ce-l7",
                layer: 7,
                sublayer: "7c",
                timestamp: 3,
                payload: { kind: "pt-modify", power: 1, toughness: 1 },
            }),
        ]);
        expect(continuousEffectsInLayer(state, 2).map((e) => e.id)).toEqual([
            "ce-l2",
        ]);
        expect(continuousEffectsInLayer(state, 6).map((e) => e.id)).toEqual([
            "ce-l6",
        ]);
    });

    it("scopes a layer-7 query to one sublayer (CR 613.4)", () => {
        const state = stateWith([
            entry({
                id: "ce-cda",
                layer: 7,
                sublayer: "7a",
                timestamp: 5,
                characteristicDefining: true,
                payload: { kind: "pt-modify", power: 2, toughness: 2 },
            }),
            entry({
                id: "ce-set",
                layer: 7,
                sublayer: "7b",
                timestamp: 1,
                payload: { kind: "pt-set", power: 4, toughness: 4 },
            }),
            entry({
                id: "ce-buff",
                layer: 7,
                sublayer: "7c",
                timestamp: 2,
                payload: { kind: "pt-modify", power: 1, toughness: 1 },
            }),
            entry({
                id: "ce-buff2",
                layer: 7,
                sublayer: "7c",
                timestamp: 9,
                payload: { kind: "pt-modify", power: 3, toughness: 0 },
            }),
        ]);
        expect(
            continuousEffectsInLayer(state, 7, "7c").map((e) => e.id)
        ).toEqual(["ce-buff", "ce-buff2"]);
        expect(
            continuousEffectsInLayer(state, 7, "7a").map((e) => e.id)
        ).toEqual(["ce-cda"]);
    });

    it("returns [] on an empty or absent registry", () => {
        expect(continuousEffectsInLayer(makeState(), 6)).toEqual([]);
        expect(continuousEffectsInLayer(stateWith([]), 6)).toEqual([]);
    });

    it("breaks an (impossible) timestamp tie deterministically by id", () => {
        const a = entry({ id: "ce-b", timestamp: 7 });
        const b = entry({ id: "ce-a", timestamp: 7 });
        expect(compareContinuousEffects(a, b)).toBeGreaterThan(0);
        expect(compareContinuousEffects(b, a)).toBeLessThan(0);
        expect(compareContinuousEffects(a, a)).toBe(0);
    });
});

describe("registry timestamps share the CR 613.7 sequence", () => {
    it("a newly applied static source outranks every live registry entry", () => {
        const source = makeInstance(crusade.id, {
            id: "crusade-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
            continuousEffects: [
                entry({ id: "ce-live", layer: 6, timestamp: 50 }),
            ],
        });
        applySourceStaticEffects(state, source);
        // CR 613.7 — a source applying now sorts strictly AFTER every effect
        // already applying, registry entries included. A tie would let the two
        // order arbitrarily (issue #1715's bug class, one layer over).
        expect(source.staticSeq).toBe(51);
    });
});

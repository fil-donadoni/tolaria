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

/** Minimal layer-6 registry entry; every field an assertion cares about is
 *  overridden at the call site so the defaults never carry meaning. */
function entry(
    id: string,
    timestamp: number,
    overrides: Partial<ContinuousEffect> = {}
): ContinuousEffect {
    const base: ContinuousEffect = {
        id,
        layer: 6,
        timestamp,
        expiry: { kind: "indefinite", controllerId: "p1" },
        affected: { kind: "instances", instanceIds: ["c1"] },
        payload: { kind: "keyword-grant", keyword: "flying" },
        characteristicDefining: false,
    };
    return { ...base, ...overrides } as ContinuousEffect;
}

/** Layer-7 entry — its sublayer is REQUIRED (CR 613.4). */
function ptEntry(
    id: string,
    timestamp: number,
    sublayer: "7a" | "7b" | "7c" | "7d"
): ContinuousEffect {
    return {
        id,
        layer: 7,
        sublayer,
        timestamp,
        expiry: { kind: "indefinite", controllerId: "p1" },
        affected: { kind: "instances", instanceIds: ["c1"] },
        payload: { kind: "pt-modify", power: 1, toughness: 1 },
        characteristicDefining: sublayer === "7a",
    };
}

function stateWith(entries: ContinuousEffect[]): GameState {
    return makeState({ continuousEffects: entries });
}

describe("continuousEffectsInLayer — CR 613.7 ordering authority", () => {
    it("returns the layer's entries in ascending timestamp order (CR 613.7)", () => {
        const state = stateWith([
            entry("ce-late", 30),
            entry("ce-early", 10),
            entry("ce-mid", 20),
        ]);
        expect(continuousEffectsInLayer(state, 6).map((e) => e.id)).toEqual([
            "ce-early",
            "ce-mid",
            "ce-late",
        ]);
    });

    it("does not mutate the stored registry order", () => {
        const state = stateWith([entry("ce-late", 30), entry("ce-early", 10)]);
        continuousEffectsInLayer(state, 6);
        expect(state.continuousEffects?.map((e) => e.id)).toEqual([
            "ce-late",
            "ce-early",
        ]);
    });

    it("excludes entries from other layers (CR 613.1b-g)", () => {
        const state = stateWith([
            entry("ce-l2", 1, {
                layer: 2,
                payload: { kind: "control-change", controllerId: "p2" },
            }),
            entry("ce-l6", 2),
            ptEntry("ce-l7", 3, "7c"),
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
            ptEntry("ce-cda", 5, "7a"),
            ptEntry("ce-set", 1, "7b"),
            ptEntry("ce-buff", 2, "7c"),
            ptEntry("ce-buff2", 9, "7c"),
            ptEntry("ce-switch", 3, "7d"),
        ]);
        expect(
            continuousEffectsInLayer(state, 7, "7c").map((e) => e.id)
        ).toEqual(["ce-buff", "ce-buff2"]);
        expect(
            continuousEffectsInLayer(state, 7, "7a").map((e) => e.id)
        ).toEqual(["ce-cda"]);
        expect(
            continuousEffectsInLayer(state, 7, "7d").map((e) => e.id)
        ).toEqual(["ce-switch"]);
    });

    it("returns [] on an empty or absent registry", () => {
        expect(continuousEffectsInLayer(makeState(), 6)).toEqual([]);
        expect(continuousEffectsInLayer(stateWith([]), 6)).toEqual([]);
    });

    it("breaks an (impossible) timestamp tie deterministically by id", () => {
        const a = entry("ce-b", 7);
        const b = entry("ce-a", 7);
        expect(compareContinuousEffects(a, b)).toBeGreaterThan(0);
        expect(compareContinuousEffects(b, a)).toBeLessThan(0);
        expect(compareContinuousEffects(a, a)).toBe(0);
    });
});

// The entry shape carries four invariants that are enforced by `tsc` alone —
// no runtime check exists or should. `@ts-expect-error` is the assertion: each
// block fails the build if the type ever stops rejecting it.
describe("entry-shape invariants are type errors", () => {
    it("a layer-7 entry cannot omit its sublayer (CR 613.4)", () => {
        // @ts-expect-error layer 7 requires a sublayer
        const bad: ContinuousEffect = {
            id: "ce-1",
            layer: 7,
            timestamp: 1,
            expiry: { kind: "indefinite", controllerId: "p1" },
            affected: { kind: "instances", instanceIds: ["c1"] },
            payload: { kind: "pt-modify", power: 1, toughness: 1 },
            characteristicDefining: false,
        };
        expect(bad.layer).toBe(7);
    });

    it("a non-layer-7 entry cannot carry a sublayer", () => {
        const bad: ContinuousEffect = {
            id: "ce-1",
            layer: 6,
            // @ts-expect-error only layer 7 has sublayers
            sublayer: "7c",
            timestamp: 1,
            expiry: { kind: "indefinite", controllerId: "p1" },
            affected: { kind: "instances", instanceIds: ["c1"] },
            payload: { kind: "keyword-grant", keyword: "flying" },
            characteristicDefining: false,
        };
        expect(bad.layer).toBe(6);
    });

    it("a predicate entry cannot have a non-source expiry (CR 611.2c)", () => {
        // @ts-expect-error a predicate is evaluated against a LIVE source
        const bad: ContinuousEffect = {
            id: "ce-1",
            layer: 6,
            timestamp: 1,
            expiry: { kind: "indefinite", controllerId: "p1" },
            affected: { kind: "predicate" },
            payload: {
                kind: "template",
                sourceCardId: crusade.id,
                effectIndex: 0,
            },
            characteristicDefining: false,
        };
        expect(bad.affected.kind).toBe("predicate");
    });

    it("a predicate entry cannot carry an inline payload", () => {
        // @ts-expect-error a predicate IS the template's applies/condition
        const bad: ContinuousEffect = {
            id: "ce-1",
            layer: 6,
            timestamp: 1,
            expiry: { kind: "source", sourceId: "aura-1" },
            affected: { kind: "predicate" },
            payload: { kind: "keyword-grant", keyword: "flying" },
            characteristicDefining: false,
        };
        expect(bad.affected.kind).toBe("predicate");
    });

    it("a source-expiry entry cannot snapshot a controllerId", () => {
        const bad: ContinuousEffect = {
            id: "ce-1",
            layer: 6,
            timestamp: 1,
            // @ts-expect-error a source's controller is read live, never stored
            expiry: { kind: "source", sourceId: "aura-1", controllerId: "p1" },
            affected: { kind: "instances", instanceIds: ["c1"] },
            payload: { kind: "keyword-grant", keyword: "flying" },
            characteristicDefining: false,
        };
        expect(bad.expiry.kind).toBe("source");
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
            continuousEffects: [entry("ce-live", 50)],
        });
        applySourceStaticEffects(state, source);
        // CR 613.7 — a source applying now sorts strictly AFTER every effect
        // already applying, registry entries included. A tie would let the two
        // order arbitrarily (issue #1715's bug class, one layer over).
        expect(source.staticSeq).toBe(51);
    });
});

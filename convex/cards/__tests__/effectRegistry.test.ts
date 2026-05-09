import { describe, it, expect } from "vitest";
import { EFFECT_REGISTRY, getResolveFn } from "../effectRegistry";
import type { CardDefinition, SpellContext } from "../types";

describe("effectRegistry", () => {
    it("EFFECT_REGISTRY has a closure for every declared shorthand", () => {
        for (const [shorthand, fn] of Object.entries(EFFECT_REGISTRY)) {
            expect(typeof fn, `registry entry ${shorthand}`).toBe("function");
        }
    });

    it("destroy-target invokes ctx.destroy with the first target", () => {
        const calls: unknown[] = [];
        const ctx = {
            targets: [{ type: "permanent", id: "victim" }],
            destroy: (t: unknown) => {
                calls.push(t);
                return true;
            },
        } as unknown as SpellContext;
        EFFECT_REGISTRY["destroy-target"](ctx);
        expect(calls).toEqual([{ type: "permanent", id: "victim" }]);
    });

    it("destroy-target is a no-op when no target was selected", () => {
        const calls: unknown[] = [];
        const ctx = {
            targets: [],
            destroy: (t: unknown) => {
                calls.push(t);
                return true;
            },
        } as unknown as SpellContext;
        EFFECT_REGISTRY["destroy-target"](ctx);
        expect(calls).toEqual([]);
    });
});

describe("getResolveFn", () => {
    const baseDef: CardDefinition = {
        id: "test-card",
        name: "Test",
        types: ["Instant"],
    };

    it("returns def.resolve when the card declares an imperative resolve", () => {
        const resolve = (() => {}) as (ctx: SpellContext) => void;
        const def: CardDefinition = { ...baseDef, resolve };
        expect(getResolveFn(def)).toBe(resolve);
    });

    it("compiles def.effect via the registry when no imperative resolve exists", () => {
        const def: CardDefinition = { ...baseDef, effect: "destroy-target" };
        expect(getResolveFn(def)).toBe(EFFECT_REGISTRY["destroy-target"]);
    });

    it("returns undefined when neither resolve nor effect is declared", () => {
        expect(getResolveFn(baseDef)).toBeUndefined();
    });

    it("throws when both resolve and effect are declared (mutually exclusive)", () => {
        const def: CardDefinition = {
            ...baseDef,
            resolve: () => {},
            effect: "destroy-target",
        };
        expect(() => getResolveFn(def)).toThrow(
            /mutually exclusive|both imperative resolve and effect/
        );
    });

    it("throws when both resolveSteps and effect are declared", () => {
        const def: CardDefinition = {
            ...baseDef,
            resolveSteps: [() => {}],
            effect: "destroy-target",
        };
        expect(() => getResolveFn(def)).toThrow(
            /mutually exclusive|both imperative resolve and effect/
        );
    });
});

// `childOpArrays` — the ONE enumeration of the Effect Script DSL's nesting
// constructs every static walk in `gre/ai/**` stands on (issue #4477).
//
// Characterisation ahead of the field-kind derivation (issue #4451) and the
// walker unification (issue #4442): the reach of the authority is pinned per
// nesting shape, so a derivation that drops a shape — or a new nesting Op the
// authority never learns — is a red test, not a silently unvalued Op.
//
// CR 608.2c — a spell's instructions are followed in the order written, nested
// ones included; an Op a walker cannot see is an instruction it cannot read.

import { describe, expect, it } from "vitest";
import type { EffectOp } from "../../cards/types";
import { EFFECT_OP_REGISTRY } from "../../cards/mechanicsRegistry";
import { childOpArrays } from "../ai/effectOpChildren";
import { markerOp, NESTING_SHAPES } from "./fixtures/nestedOpShapes";

/** Every Op reachable from `ops` through `childOpArrays`, depth-first. */
function reach(ops: readonly EffectOp[]): EffectOp[] {
    const out: EffectOp[] = [];
    for (const op of ops) {
        out.push(op);
        for (const child of childOpArrays(op)) out.push(...reach(child));
    }
    return out;
}

describe("childOpArrays — every nesting shape (CR 608.2c, issue #4477)", () => {
    it.each(NESTING_SHAPES.map((s) => [s.label, s] as const))(
        "%s: the nested list is returned, and the marker in it is reached",
        (_label, shape) => {
            const marker = markerOp();
            const host = shape.nest([marker]);
            const children = childOpArrays(host).flat();
            // The host's other nested lists are empty, so the marker is the
            // ONLY child — a shape returning the wrong field returns [] here.
            expect(children).toHaveLength(1);
            expect(children[0]).toBe(marker);
        }
    );

    it("one script nesting a marker under every shape: a walk reaches all of them", () => {
        const markers = NESTING_SHAPES.map(() => markerOp());
        const script = NESTING_SHAPES.map((s, i) => s.nest([markers[i]]));
        const reached = reach(script);
        for (const [i, shape] of NESTING_SHAPES.entries()) {
            expect(reached, shape.label).toContain(markers[i]);
        }
    });

    it("the shapes nest inside each other — a marker at the bottom of every shape at once is reached", () => {
        const marker = markerOp();
        const deepest = NESTING_SHAPES.reduceRight<EffectOp[]>(
            (inner, shape) => [shape.nest(inner)],
            [marker]
        );
        expect(reach(deepest)).toContain(marker);
    });

    it("an Op outside the nesting set has no children — the authority's reach is exactly the fixture's host Ops", () => {
        const hosts = new Set<string>(NESTING_SHAPES.map((s) => s.hostOp));
        expect([...hosts].sort()).toEqual([
            "coinFlip",
            "coinFlipSync",
            "delayedTrigger",
            "divideIntoPiles",
            "forEach",
            "if",
            "optionChoice",
            "reflexiveTrigger",
        ]);
        for (const { op } of EFFECT_OP_REGISTRY) {
            if (hosts.has(op)) continue;
            // `childOpArrays` switches on `op` alone; any other field is
            // irrelevant to a non-nesting Op, so the bare name is the input.
            expect(childOpArrays({ op } as EffectOp), op).toEqual([]);
        }
    });
});

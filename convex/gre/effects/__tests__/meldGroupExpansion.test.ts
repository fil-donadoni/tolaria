// CR 712.21c (ADR 0161) — the mechanical half of "one card becomes two
// expands at the ACTION site": every executor that acts on an object an
// Effect Script found through a reference is adjudicated in
// `MELD_GROUP_DISPOSITION`, and every `"expands"` row is really wrapped by
// `withMeldGroup`. Without this the rule is prose a new Op forgets.
//
// The census is DERIVED, never listed: an executor is object-acting when its
// source calls `resolveObjectRef(` — the one function that turns a
// reference into the object an Op acts on.

import { describe, it, expect } from "vitest";
import {
    MELD_GROUP_DISPOSITION,
    MELD_GROUP_WRAPPED,
    OP_EXECUTORS,
} from "../interpreter";

type Executor = ((...args: never[]) => unknown) & {
    [MELD_GROUP_WRAPPED]?: (...args: never[]) => unknown;
};

const table = OP_EXECUTORS as unknown as Record<string, Executor>;

function sourceOf(op: string): string {
    const exec = table[op];
    return String(exec[MELD_GROUP_WRAPPED] ?? exec);
}

describe("meld group expansion census (CR 712.21c, ADR 0161)", () => {
    it("adjudicates exactly the executors that act on a referenced object", () => {
        const objectActing = Object.keys(table)
            .filter((op) => sourceOf(op).includes("resolveObjectRef("))
            .sort();
        expect(Object.keys(MELD_GROUP_DISPOSITION).sort()).toEqual(
            objectActing
        );
    });

    it("wraps every expanding executor with withMeldGroup", () => {
        for (const [op, disposition] of Object.entries(
            MELD_GROUP_DISPOSITION
        )) {
            expect(
                table[op][MELD_GROUP_WRAPPED] !== undefined,
                `${op}: wrapped iff "expands"`
            ).toBe(disposition === "expands");
        }
    });

    it("gives every non-expanding row a reason", () => {
        for (const [op, disposition] of Object.entries(
            MELD_GROUP_DISPOSITION
        )) {
            if (disposition === "expands") continue;
            expect(disposition.length, op).toBeGreaterThan(20);
        }
    });
});

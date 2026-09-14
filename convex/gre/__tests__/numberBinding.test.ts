// The numeric binding's payload tag (CR 107.1b / 107.3f, issue #1701).
//
// A numeric binding is read back in a NUMBER position by a BARE `{ ref }`, so
// it must be impossible to confuse with any other answer the engine persists
// into `StackItem.collectedChoices`. The tag is what buys that, and the
// guarantee is the conjunction `length === 2 && stored[0] === "#n"` — NOT `#`
// being rare, which it is not (`CASCADE_NO_HIT`, the `#forEach:` key).
//
// PR #3568 review finding: nothing mechanical protects the conjunction, so a
// future payload shape could collide silently — a boolean read as a number is
// `NaN` propagating through a count. This file is that guard.

import { describe, it, expect } from "vitest";
import {
    NUMBER_BINDING_TAG,
    readTaggedNumber,
    writeTaggedNumber,
} from "../numberBinding";

describe("numeric binding payload (CR 107.1b / 107.3f, issue #1701)", () => {
    it("round-trips every amount a nomination can produce, including the decline", () => {
        for (const amount of [0, 1, 2, 7, 42]) {
            expect(readTaggedNumber(writeTaggedNumber(amount))).toBe(amount);
        }
    });

    it("reads every OTHER payload family the engine persists as `undefined`", () => {
        // One row per shape a `collectedChoices` writer actually produces.
        const foreign: Record<string, string[]> = {
            "may-pay accepted": ["yes"],
            "may-pay declined": ["no"],
            "name-card": ["Grizzly Bears"],
            "choice pick": ["card-instance-1"],
            "players-set $each": ["p1"],
            "pick-pile": ["A"],
            "coin flip": ["heads"],
            "cascade miss": ["#none"],
            "empty picks (declined 'you may')": [],
            "multi-pick": ["card-1", "card-2"],
            // A bound object SNAPSHOT — the widest payload, and the one whose
            // head is an instance id that must never read as a number.
            snapshot: [
                "card-1",
                "2",
                "2",
                "p1",
                "p1",
                "3",
                "Bear",
                "1",
                "",
                "",
            ],
        };
        for (const [label, payload] of Object.entries(foreign)) {
            expect(
                { [label]: readTaggedNumber(payload) },
                `${label} must not read as a number`
            ).toEqual({ [label]: undefined });
        }
        expect(readTaggedNumber(undefined)).toBeUndefined();
    });

    it("refuses a TAGGED payload whose tail is not a whole number", () => {
        // Fail-closed: a malformed tail is an uncaptured binding (CR 608.2b),
        // never a silent NaN reaching a count.
        for (const tail of ["", "x", "1.5", "NaN", "Infinity"]) {
            expect(
                readTaggedNumber([NUMBER_BINDING_TAG, tail])
            ).toBeUndefined();
        }
        expect(readTaggedNumber([NUMBER_BINDING_TAG])).toBeUndefined();
        expect(
            readTaggedNumber([NUMBER_BINDING_TAG, "1", "2"])
        ).toBeUndefined();
    });
});

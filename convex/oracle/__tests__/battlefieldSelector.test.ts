// The battlefield object selector is an ALLOW-list (issue #4192).
//
// Six verbs — destroy, tap/untap, regenerate, pump, keyword grant and counters
// — turn an announced target into the Effect Script Op's object reference
// through ONE selector. A refusal list is the shape that fails OPEN: the two
// announced-slot shapes it forgot compiled to a `ready` ability that is
// activated legally, whose target is chosen legally, and whose Op then reaches
// an object that is not where it looks.
//
//  - CR 115.4 "any target" — a slot a PLAYER may legally fill, and a player is
//    not an object (CR 109.1) with the characteristics these verbs read.
//  - a card in the graveyard — outside the battlefield (CR 400.1), where every
//    one of these verbs writes (CR 110.1).
//
// Both are asserted PER VERB, not once: the guard lives in the shared helper,
// and a verb that stops calling it is exactly what one shared assertion would
// never notice. Each refusal carries its OWN reason, distinct from its
// neighbours', so `oracle:report --gap` ranks it as its own Grammar Gap.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./fixtures";

const ANY_REASON =
    '"any target" may be a player, which is not an object (CR 115.4, CR 109.1)';
const ZONE_REASON =
    "a card outside the battlefield is not a permanent (CR 110.1, CR 400.1)";

/** One battlefield verb, with the sentence that reaches it for a given slot. */
const VERBS: ReadonlyArray<readonly [string, (slot: string) => string]> = [
    ["destroy", (slot) => `Destroy ${slot}.`],
    ["tap", (slot) => `Tap ${slot}.`],
    ["untap", (slot) => `Untap ${slot}.`],
    ["regenerate", (slot) => `Regenerate ${slot}.`],
    ["pump", (slot) => `${cap(slot)} gets +1/+1 until end of turn.`],
    ["keyword grant", (slot) => `${cap(slot)} gains flying until end of turn.`],
    ["counters", (slot) => `Put a +1/+1 counter on ${slot}.`],
];

function cap(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function instant(oracleText: string) {
    return oracleCard({
        name: "Probe",
        manaCost: "{2}",
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

/** The reasons the compiler gave up with, one per refused line. */
function refusedAt(oracleText: string) {
    const outcome = compileCard(instant(oracleText));
    if (outcome.state !== "unparsed")
        throw new Error(`"${oracleText}" parsed, but should not have`);
    return outcome.gaps.map((gap) =>
        gap.attribution === undefined
            ? gap.reason
            : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`
    );
}

function parses(oracleText: string): boolean {
    return compileCard(instant(oracleText)).state !== "unparsed";
}

describe("the battlefield selector refuses 'any target' (CR 115.4)", () => {
    for (const [verb, sentence] of VERBS)
        it(`${verb}`, () => {
            expect(refusedAt(sentence("any target"))).toEqual([ANY_REASON]);
        });
});

describe("the battlefield selector refuses a card in a graveyard (CR 400.1)", () => {
    for (const [verb, sentence] of VERBS)
        it(`${verb}`, () => {
            expect(
                refusedAt(sentence("target creature card in your graveyard"))
            ).toEqual([ZONE_REASON]);
        });
});

describe("the two refusals rank as two gaps, not one", () => {
    it("carry distinct reasons, neither shared with a neighbour", () => {
        expect(new Set([ANY_REASON, ZONE_REASON]).size).toBe(2);
        for (const neighbour of [
            "a player is not an object (CR 109.1)",
            "a player has no color (CR 109.1)",
            "a colour change reaches the battlefield and the stack (CR 613.1e)",
        ])
            expect([ANY_REASON, ZONE_REASON]).not.toContain(neighbour);
    });
});

// The allow-list must keep everything a printed card reaches today: the
// battlefield permanent each verb was written for, and the two consumers that
// share the announced-slot machinery but read another zone or another kind.
describe("the allow-list keeps what it was shown", () => {
    for (const [verb, sentence] of VERBS)
        it(`${verb} still reads a battlefield permanent`, () => {
            expect(parses(sentence("target creature"))).toBe(true);
        });

    // CR 119.3 — damage takes "any target": a player is exactly what it wants.
    it("damage still reads 'any target'", () => {
        expect(parses("Probe deals 3 damage to any target.")).toBe(true);
    });

    // CR 400.7 — a zone change out of a graveyard is the graveyard verb.
    it("a graveyard return still reads a graveyard card", () => {
        expect(
            parses(
                "Return target creature card from your graveyard to your hand."
            )
        ).toBe(true);
    });

    // A zone change is not a battlefield verb, but a PLAYER cannot be returned.
    it("a bounce refuses 'any target'", () => {
        expect(refusedAt("Return any target to its owner's hand.")).toEqual([
            ANY_REASON,
        ]);
    });
});

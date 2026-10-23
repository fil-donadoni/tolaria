// "Counter that spell" behind a cast head (CR 603.2, CR 701.6a), and a
// source's counter-threshold sacrifice (CR 701.21a, CR 122.1) — Decree of
// Silence.
//
//  1. GOLDEN — the real card compiles to its full Compiled Definition.
//  2. REFUSALS — the neighbours the rule must not read stay `unparsed`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

function enchantment(oracleText: string) {
    return oracleCard({
        name: "Test Enchantment",
        manaCost: "{2}{U}",
        typeLine: "Enchantment",
        oracleText,
    });
}

describe("counter that spell — golden (CR 603.2, CR 701.6a, CR 122.1)", () => {
    it("Decree of Silence compiles to counter-by-event-ref, a counter, a gated sacrifice", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Decree of Silence"
        )!;
        const outcome = compileCard(oracleCard(fixture.card));
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture.expected)
        );
        const trigger = outcome.definition.compiledTriggeredAbilities![0]!;
        expect(trigger.head).toEqual({ kind: "spell-cast", scope: "opponent" });
        expect(trigger.effects![0]).toEqual({
            op: "counter",
            target: { ref: "$event.spell" },
        });
    });
});

describe("counter that spell — refusals (fail-closed)", () => {
    const refused = (text: string) =>
        expect(compileCard(enchantment(text)).state).toBe("unparsed");

    it("a head that names no spell binds no 'that spell'", () => {
        refused(
            "Whenever a creature dies, counter that spell and put a depletion counter on this enchantment."
        );
    });
    it("'that spell' with a counter tax is not read", () => {
        refused(
            "Whenever an opponent casts a spell, counter that spell unless its controller pays {1}."
        );
    });
    it("a threshold sacrifice on something other than the source is not read", () => {
        refused(
            "Whenever an opponent casts a spell, counter that spell. If there are three or more depletion counters on target land, sacrifice it."
        );
    });
    it("a tally not spelled as a number is not read", () => {
        refused(
            "Whenever an opponent casts a spell, counter that spell. If there are several or more depletion counters on this enchantment, sacrifice it."
        );
    });
});

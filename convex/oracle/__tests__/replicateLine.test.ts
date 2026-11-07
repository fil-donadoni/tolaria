/**
 * Replicate keyword line — CR 702.56a: "Replicate [cost]" means "As an
 * additional cost to cast this spell, you may pay [cost] any number of times"
 * plus a cast trigger copying the spell once per payment. The card authors
 * only the COST half — a `kickers[]` entry `{ id: "replicate", keyword:
 * "replicate", multi: true }`; the engine row for the keyword supplies the
 * copy trigger. Goldens are real corpus rows; refusals pin fail-closed.
 */
import { describe, expect, it } from "vitest";
import { getAllRawCards } from "../../cards/catalogue";
import type { KickerCost } from "../../cards/types";
import { compileCard } from "../compile";
import { canonicaliseShorthands, sortKeys } from "../gates";
import { keywordLineSlot, replicateRule } from "../grammar/slots/keywordLine";
import { lowerKickers } from "../lowerSpell";
import { oracleCard, parseContext } from "./oracle.fixture";

function sorcery(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

/** The replicate line alone, through the keyword-line slot and lowering. */
function kickersOf(line: string): KickerCost[] {
    const parsed = keywordLineSlot.run(line, parseContext());
    if (!parsed.ok) throw new Error(`${line}: ${parsed.reason}`);
    if (parsed.value.kind !== "kicker") throw new Error(`${line}: not kicker`);
    const lowered = lowerKickers(parsed.value.kickers);
    if (!lowered.ok) throw new Error(`${line}: ${lowered.reason}`);
    return lowered.value;
}

describe("Replicate line — golden fixtures (CR 702.56a)", () => {
    it("Train of Thought: the whole Compiled Definition", () => {
        const outcome = compileCard(
            sorcery(
                "Train of Thought",
                "{1}{U}",
                "Replicate {1}{U} (When you cast this spell, copy it for each time you paid its replicate cost.)\nDraw a card."
            )
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Train of Thought",
                types: ["Sorcery"],
                manaCost: { X: 1, U: 1 },
                oracleText:
                    "Replicate {1}{U} (When you cast this spell, copy it for each time you paid its replicate cost.)\nDraw a card.",
                kickers: [
                    {
                        id: "replicate",
                        keyword: "replicate",
                        description: "Replicate {1}{U}",
                        multi: true,
                        mana: { X: 1, U: 1 },
                    },
                ],
                effects: [{ op: "draw", player: "controller", count: 1 }],
            })
        );
    });

    it("Replicate {R} (Shattering Spree) is one multi entry under the keyword's own id", () => {
        expect(kickersOf("Replicate {R}")).toEqual([
            {
                id: "replicate",
                keyword: "replicate",
                description: "Replicate {R}",
                multi: true,
                mana: { R: 1 },
            },
        ]);
    });
});

describe("Replicate gold over the hand-written catalogue", () => {
    const REPLICATE_LINE = /^Replicate .*$/m;

    it("every hand-written replicate line compiles to its author's kickers[]", () => {
        let accepted = 0;
        for (const def of getAllRawCards()) {
            const line = def.oracleText?.match(REPLICATE_LINE)?.[0];
            if (line === undefined) continue;
            accepted++;
            expect(
                sortKeys(
                    canonicaliseShorthands(
                        kickersOf(line.replace(/ \(.*\)$/, ""))
                    )
                ),
                def.name
            ).toEqual(sortKeys(canonicaliseShorthands(def.kickers)));
        }
        expect(accepted).toBeGreaterThan(0);
    });
});

describe("Replicate refusals — grammar", () => {
    const ctx = parseContext();

    it.each([
        ["Replicate—Pay {E}{E}{E}.", "a non-mana (energy) replicate cost"],
        [
            "Replicate—Tap an untapped Dalek you control.",
            "a non-mana (tap) replicate cost",
        ],
        ["Replicate {X}", "a variable X on a cost payable many times"],
        ["Replicate {W/U}", "hybrid pip"],
    ])("refuses %s (%s)", (line) => {
        expect(replicateRule.run(line, ctx).ok).toBe(false);
        expect(keywordLineSlot.run(line, ctx).ok).toBe(false);
    });

    it("a bare 'Replicate' is not a replicate line (no cost to pay)", () => {
        expect(replicateRule.run("Replicate", ctx).ok).toBe(false);
    });

    it("refuses a card printing both Kicker and Replicate (one kicker-family line per card)", () => {
        const outcome = compileCard(
            sorcery(
                "Kicked Replica",
                "{1}{U}",
                "Kicker {1}\nReplicate {U}\nDraw a card."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});

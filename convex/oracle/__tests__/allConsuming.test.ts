// The all-consuming invariant, catalogue-wide (PRD #2693 acceptance criterion).
//
// This is THE guarding test of the Oracle compiler. Everything else measures
// how much the grammar reads; this measures whether reading LESS than the whole
// card can ever be reported as success. The competitor's ~4,700 silent
// misparses are all one bug — a rule matched part of its input and the rest
// went nowhere — so a compiler that cannot fail this test is a compiler whose
// "supported" number means nothing.
//
// Method: take every hand-written card that grammar v0 ACCEPTS today, perturb
// its Oracle text with a clause the grammar demonstrably cannot read, and
// assert the card flips to `unparsed`. Not "the extra clause is reported" —
// `unparsed`, no definition emitted at all, because a definition missing one of
// its abilities looks playable and plays wrong.
//
// The perturbations cover the three places residue can hide: the end of a line,
// a whole new line at the end, and a whole new line at the front (a compiler
// that iterates until its first success would pass the first two and fail this
// one).

import { describe, expect, it } from "vitest";
import { getAllCards } from "../../cards/catalogue";
import { compileCard } from "../compile";
import { goldOracleCard } from "../gold";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

/** A clause no v0 slot can read — verified as such below, not assumed. */
const UNREADABLE_CLAUSE = "It can't be regenerated.";

function mutate(card: OracleCard, oracleText: string): OracleCard {
    return { ...card, oracleText };
}

describe("all-consuming invariant (PRD #2693)", () => {
    const accepted = getAllCards()
        .filter((definition) => definition.oracleText !== undefined)
        .map((definition) => goldOracleCard(definition))
        .filter((card) => compileCard(card).state !== "unparsed");

    it("the corpus of accepted cards is non-empty (the test cannot pass vacuously)", () => {
        expect(accepted.length).toBeGreaterThan(50);
    });

    it("the perturbation clause is genuinely unreadable on its own", () => {
        const bare = compileCard(
            mutate(
                oracleCard({
                    typeLine: "Sorcery",
                    power: undefined,
                    toughness: undefined,
                }),
                UNREADABLE_CLAUSE
            )
        );
        expect(bare.state).toBe("unparsed");
    });

    it("a clause APPENDED TO THE LAST LINE flips every accepted card to unparsed", () => {
        const survivors: string[] = [];
        for (const card of accepted) {
            const lines = card.oracleText.split("\n");
            lines[lines.length - 1] =
                `${lines[lines.length - 1]} ${UNREADABLE_CLAUSE}`;
            const outcome = compileCard(mutate(card, lines.join("\n")));
            if (outcome.state !== "unparsed")
                survivors.push(`${card.name} -> ${outcome.state}`);
        }
        expect(survivors).toEqual([]);
    });

    it("a NEW TRAILING LINE flips every accepted card to unparsed", () => {
        const survivors: string[] = [];
        for (const card of accepted) {
            const outcome = compileCard(
                mutate(card, `${card.oracleText}\n${UNREADABLE_CLAUSE}`.trim())
            );
            if (outcome.state !== "unparsed")
                survivors.push(`${card.name} -> ${outcome.state}`);
        }
        expect(survivors).toEqual([]);
    });

    it("a NEW LEADING LINE flips every accepted card to unparsed", () => {
        // The one a "stop at the first slot that works" compiler would miss.
        const survivors: string[] = [];
        for (const card of accepted) {
            const outcome = compileCard(
                mutate(card, `${UNREADABLE_CLAUSE}\n${card.oracleText}`.trim())
            );
            if (outcome.state !== "unparsed")
                survivors.push(`${card.name} -> ${outcome.state}`);
        }
        expect(survivors).toEqual([]);
    });

    it("names the unconsumed line in the gap, so the diagnosis is actionable", () => {
        const card = accepted[0]!;
        const outcome = compileCard(
            mutate(card, `${card.oracleText}\n${UNREADABLE_CLAUSE}`.trim())
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed") {
            expect(outcome.gaps.map((g) => g.fragment)).toContain(
                UNREADABLE_CLAUSE
            );
        }
    });

    it("an unparsed outcome carries NO definition — a partial parse has no shape", () => {
        const outcome = compileCard(
            mutate(
                oracleCard({ typeLine: "Creature — Bear" }),
                `Flying\n${UNREADABLE_CLAUSE}`
            )
        );
        expect(outcome.state).toBe("unparsed");
        expect(Object.keys(outcome).sort()).toEqual(["gaps", "state"]);
    });
});

describe("all-consuming invariant — targeted residue shapes", () => {
    const creature = oracleCard({ typeLine: "Creature — Bear" });
    const land = oracleCard({
        typeLine: "Land",
        manaCost: "",
        power: undefined,
        toughness: undefined,
    });

    const cases: [string, OracleCard, string][] = [
        // A trailing FILTER on a keyword line — the competitor's largest bucket.
        [
            "keyword line + trailing prose",
            creature,
            "Flying as long as you control an Island",
        ],
        ["keyword line + extra keyword text", creature, "Flying and vigilance"],
        ["keyword line + punctuation", creature, "Flying."],
        // A trailing RIDER on a mana ability.
        [
            "mana ability + activation restriction",
            land,
            "{T}: Add {G}. Activate only during your turn.",
        ],
        [
            "mana ability + a second sentence",
            land,
            "{T}: Add {G}. You gain 1 life.",
        ],
        [
            "mana ability + trailing condition",
            land,
            "{T}: Add {G} if you control a Forest.",
        ],
        // A conjunction whose second half is unreadable.
        [
            "mana ability with an unreadable option",
            land,
            "{T}: Add {G} or one mana of any color.",
        ],
    ];

    for (const [name, card, text] of cases) {
        it(`${name} is unparsed`, () => {
            expect(compileCard(mutate(card, text)).state).toBe("unparsed");
        });
    }

    it("the readable half of each case DOES compile, so the refusal is about the residue", () => {
        expect(compileCard(mutate(creature, "Flying")).state).not.toBe(
            "unparsed"
        );
        expect(compileCard(mutate(land, "{T}: Add {G}.")).state).not.toBe(
            "unparsed"
        );
    });
});

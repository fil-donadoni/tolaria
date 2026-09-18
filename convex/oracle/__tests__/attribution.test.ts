/**
 * The attribution diagnostic (issue #3822, ADR 0137): for a refused line, the
 * deepest failing path across every slot — which slot, which sub-grammar, and
 * the span it could not consume.
 *
 * One real corpus card per slot, driven through `compileCard` (the public
 * entry point), asserting the WHOLE attribution: a diagnostic that names the
 * wrong slot or the wrong sub-grammar ranks a gap nobody can close, so every
 * fixture pins the exact path, not just "some attribution exists".
 *
 * The second half pins the combinator properties the diagnostic rests on:
 * progress beats nesting, `oneOf` stays order-independent, and a sub-grammar
 * with a printed opener is not blamed for a span it never opened.
 */

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import {
    EFFECT_CLAUSE,
    SENTENCE_ASSEMBLY,
} from "../grammar/shared/effectClause";
import { ACTIVATION_COST } from "../grammar/shared/cost";
import { CONDITION } from "../grammar/shared/condition";
import { STATIC_CLAUSE } from "../grammar/shared/staticClause";
import { DESCRIPTOR, TARGET_FILTER } from "../grammar/shared/targetFilter";
import { TRIGGER_HEAD } from "../grammar/shared/triggerHead";
import { KEYWORD_ABILITY } from "../grammar/slots/keywordLine";
import {
    MANA_ABILITY_RIDER,
    MANA_PRODUCTION,
} from "../grammar/slots/manaAbility";
import {
    fail,
    listOf,
    literal,
    oneOf,
    pair,
    rule,
    subGrammar,
    type Rule,
} from "../rule";
import type { Attribution, OracleCard } from "../types";
import { oracleCard } from "./fixtures";

/** The attribution of the card's ONE refused line. */
function attributionOf(card: Partial<OracleCard>): Attribution | undefined {
    const outcome = compileCard(oracleCard(card));
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} compiled ${outcome.state}`);
    expect(outcome.gaps).toHaveLength(1);
    return outcome.gaps[0]!.attribution;
}

describe("attribution — one real card per slot names the sub-grammar that failed", () => {
    it("keyword-line: a parameterised keyword the vocabulary cannot read (Air Response Unit)", () => {
        expect(
            attributionOf({
                name: "Air Response Unit",
                manaCost: "{2}{W}",
                typeLine: "Artifact — Vehicle",
                oracleText:
                    "Flying, vigilance\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)",
                power: "3",
                toughness: "3",
            })
        ).toEqual({
            slot: "keyword-line",
            path: [KEYWORD_ABILITY],
            span: "Crew 1",
        });
    });

    it("mana-ability: a production the mana grammar cannot read (Orochi Leafcaller)", () => {
        // The activated slot reads the same line one sub-grammar over — its
        // effect clause refuses "Add one mana of any color" — and loses on the
        // shorter span the mana production could not consume.
        expect(
            attributionOf({
                name: "Orochi Leafcaller",
                manaCost: "{G}",
                typeLine: "Creature — Snake Shaman",
                oracleText: "{G}: Add one mana of any color.",
                power: "1",
                toughness: "1",
            })
        ).toEqual({
            slot: "mana-ability",
            path: [MANA_PRODUCTION],
            span: "one mana of any color",
        });
    });

    it("mana-ability: the rider sentence after a production that parsed (Shivan Reef)", () => {
        // CR 605.1a — this is a mana ability; the activated slot's effect
        // clause also refuses "Add {R}", and must not take the blame for it.
        expect(
            attributionOf({
                name: "Shivan Reef",
                manaCost: "",
                typeLine: "Land",
                oracleText:
                    "{T}: Add {C}.\n{T}: Add {U} or {R}. This land deals 1 damage to you.",
                power: undefined,
                toughness: undefined,
            })
        ).toEqual({
            slot: "mana-ability",
            path: [MANA_ABILITY_RIDER],
            span: "This land deals 1 damage to you",
        });
    });

    it('mana-ability: never the activated slot\'s effect clause for an "Add" sentence (Ancient Ziggurat)', () => {
        // Both slots refuse at the same depth and progress, and the activated
        // slot's span ("Add one mana of any color") is the SHORTER one — the
        // shape that blamed the wrong slot on 340 corpus cards.
        expect(
            attributionOf({
                name: "Ancient Ziggurat",
                manaCost: "",
                typeLine: "Land",
                oracleText:
                    "{T}: Add one mana of any color. Spend this mana only to cast a creature spell.",
                power: undefined,
                toughness: undefined,
            })
        ).toEqual({
            slot: "mana-ability",
            path: [MANA_PRODUCTION],
            span: "one mana of any color. Spend this mana only to cast a creature spell",
        });
    });

    it("activated: a target descriptor inside the effect clause (Dogged Hunter)", () => {
        expect(
            attributionOf({
                name: "Dogged Hunter",
                manaCost: "{2}{W}",
                typeLine: "Creature — Human Nomad",
                oracleText: "{T}: Destroy target creature token.",
                power: "1",
                toughness: "1",
            })
        ).toEqual({
            slot: "activated",
            path: [EFFECT_CLAUSE, TARGET_FILTER, DESCRIPTOR],
            span: "creature token",
        });
    });

    it("triggered: a trigger head the grammar does not know (Drogskol Reaver)", () => {
        expect(
            attributionOf({
                name: "Drogskol Reaver",
                manaCost: "{5}{W}{U}",
                typeLine: "Creature — Spirit",
                oracleText:
                    "Flying\nDouble strike (This creature deals both first-strike and regular combat damage.)\nLifelink (Damage dealt by this creature also causes you to gain that much life.)\nWhenever you gain life, draw a card.",
                power: "3",
                toughness: "5",
            })
        ).toEqual({
            slot: "triggered",
            path: [TRIGGER_HEAD],
            span: "Whenever you gain life",
        });
    });

    it("triggered: the effect, once the head has parsed (Rustspore Ram)", () => {
        expect(
            attributionOf({
                name: "Rustspore Ram",
                manaCost: "{4}",
                typeLine: "Artifact Creature — Sheep",
                oracleText:
                    "When this creature enters, destroy target Equipment.",
                power: "1",
                toughness: "3",
            })
        ).toEqual({
            slot: "triggered",
            path: [EFFECT_CLAUSE, TARGET_FILTER, DESCRIPTOR],
            span: "Equipment",
        });
    });

    it("triggered: every sentence parsed, the list refused as a whole", () => {
        // CR 602.5 — an activation restriction has no meaning on a trigger.
        // Without the slot's own trace the static clause, which never read a
        // word of this, was blamed for the whole line.
        const line =
            "When {self} enters, draw a card. Activate only once each turn.";
        expect(
            attributionOf({
                name: "Test Card",
                oracleText:
                    "When Test Card enters, draw a card. Activate only once each turn.",
            })
        ).toEqual({
            slot: "triggered",
            path: [SENTENCE_ASSEMBLY],
            span: line.slice(0, -1),
        });
    });

    it("spell: every sentence parsed, the list refused as a whole", () => {
        expect(
            attributionOf({
                typeLine: "Instant",
                oracleText: "Draw a card. Activate only once each turn.",
                power: undefined,
                toughness: undefined,
            })
        ).toEqual({
            slot: "spell",
            path: [SENTENCE_ASSEMBLY],
            span: "Draw a card. Activate only once each turn",
        });
    });

    it("triggered: an intervening-if condition (Settlement Blacksmith)", () => {
        expect(
            attributionOf({
                name: "Settlement Blacksmith",
                manaCost: "{2}{W}",
                typeLine: "Creature — Human Artificer",
                oracleText:
                    "When this creature enters, if you control an Equipment, draw a card.",
                power: "3",
                toughness: "3",
            })
        ).toEqual({
            slot: "triggered",
            path: [CONDITION, DESCRIPTOR],
            span: "Equipment",
        });
    });

    it("static: a descriptor inside the static clause (Urza's Filter)", () => {
        expect(
            attributionOf({
                name: "Urza's Filter",
                manaCost: "{4}",
                typeLine: "Artifact",
                oracleText: "Multicolored spells cost {2} less to cast.",
                power: undefined,
                toughness: undefined,
            })
        ).toEqual({
            slot: "static",
            path: [STATIC_CLAUSE, DESCRIPTOR],
            span: "Multicolored cards",
        });
    });

    it("spell: a target descriptor inside the effect clause (Smite)", () => {
        expect(
            attributionOf({
                name: "Smite",
                manaCost: "{W}",
                typeLine: "Instant",
                oracleText: "Destroy target blocked creature.",
                power: undefined,
                toughness: undefined,
            })
        ).toEqual({
            slot: "spell",
            path: [EFFECT_CLAUSE, TARGET_FILTER, DESCRIPTOR],
            span: "blocked creature",
        });
    });

    it("spell: an additional cost reaches the shared activation-cost grammar (Bond of Agony)", () => {
        expect(
            attributionOf({
                name: "Bond of Agony",
                manaCost: "{X}{B}",
                typeLine: "Sorcery",
                oracleText:
                    "As an additional cost to cast this spell, pay X life.",
                power: undefined,
                toughness: undefined,
            })
        ).toEqual({
            slot: "spell",
            path: [ACTIVATION_COST],
            span: "Pay X life",
        });
    });

    it("carries no attribution when no slot entered any sub-grammar", () => {
        // A permanent's line that no slot frame even opens: not a keyword, no
        // colon, no trigger word, no full stop for the static slot.
        expect(
            attributionOf({ oracleText: "Totally unreadable text" })
        ).toBeUndefined();
    });
});

// ── The combinator properties the diagnostic rests on ─────────────────────

const leaf = (label: string, accepts: string): Rule<string> =>
    subGrammar(label, literal(accepts));

describe("failure traces — the order the combinators impose", () => {
    it("pair: a right-side miss (left parsed) outranks a deeper left-side miss", () => {
        // Split at ", " twice. At the first comma the left side parses and the
        // right side fails at depth 1; at the second the left side fails at
        // depth 2. Progress wins: the reading whose head parsed got further.
        const deepLeft = subGrammar(
            "outer",
            rule("head", (span, ctx) =>
                span === "a"
                    ? { ok: true as const, value: span }
                    : leaf("inner", "never").run(span, ctx)
            )
        );
        const r = pair(
            "p",
            ", ",
            deepLeft,
            leaf("tail", "never"),
            (a) => a
        ).run("a, b, c", undefined);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.trace).toEqual({ path: ["tail"], span: "b, c", progress: 1 });
    });

    it("listOf: the nth element's miss carries n elements of progress", () => {
        const r = listOf("l", "; ", leaf("item", "x")).run(
            "x; x; y",
            undefined
        );
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.trace).toEqual({ path: ["item"], span: "y", progress: 2 });
    });

    it("oneOf: the deepest miss is reported whatever the alternatives' order", () => {
        const shallow = leaf("shallow", "never");
        const deep = subGrammar("outer", leaf("inner", "never"));
        const forward = oneOf("o", [shallow, deep]).run("z", undefined);
        const reversed = oneOf("o", [deep, shallow]).run("z", undefined);
        expect(forward.ok || reversed.ok).toBe(false);
        if (forward.ok || reversed.ok) return;
        expect(forward.trace).toEqual({
            path: ["outer", "inner"],
            span: "z",
            progress: 0,
        });
        expect(reversed.trace).toEqual(forward.trace);
    });

    it("oneOf: an exact depth tie resolves the same whatever the order", () => {
        const b = leaf("b", "never");
        const a = leaf("a", "never");
        const forward = oneOf("o", [a, b]).run("z", undefined);
        const reversed = oneOf("o", [b, a]).run("z", undefined);
        expect(forward.ok || reversed.ok).toBe(false);
        if (forward.ok || reversed.ok) return;
        expect(forward.trace?.path).toEqual(["a"]);
        expect(reversed.trace).toEqual(forward.trace);
    });

    it("subGrammar: an opener that does not match carries no blame", () => {
        const gated = subGrammar(
            "gated",
            rule("g", (span) => fail("no", span)),
            (span) => span.startsWith("When ")
        );
        const outside = gated.run("Destroy target creature", undefined);
        const inside = gated.run("When it dies", undefined);
        expect(outside.ok || inside.ok).toBe(false);
        if (outside.ok || inside.ok) return;
        expect(outside.trace).toBeUndefined();
        expect(inside.trace).toEqual({
            path: ["gated"],
            span: "When it dies",
            progress: 0,
        });
    });
});

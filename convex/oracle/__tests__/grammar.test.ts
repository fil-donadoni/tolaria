// Grammar v0: keyword lines (CR 702.1), mana abilities (CR 605.1a), the slot
// router's unique dispatch, and the fail-closed behaviour of every stub.

import { describe, expect, it } from "vitest";
import { MECHANICS_REGISTRY } from "../../cards/mechanicsRegistry";
import { conditionRule } from "../grammar/shared/condition";
import { durationRule } from "../grammar/shared/duration";
import { playerRefRule } from "../grammar/shared/playerRef";
import { quantityRule } from "../grammar/shared/quantity";
import { targetFilterRule } from "../grammar/shared/targetFilter";
import { zoneRefRule } from "../grammar/shared/zoneRef";
import { activatedSlot } from "../grammar/slots/activated";
import {
    keywordLineSlot,
    keywordVocabulary,
} from "../grammar/slots/keywordLine";
import { manaAbilitySlot } from "../grammar/slots/manaAbility";
import { spellSlot } from "../grammar/slots/spell";
import { staticSlot } from "../grammar/slots/staticSlot";
import { triggeredSlot } from "../grammar/slots/triggered";
import type { SlotIR } from "../grammar/ir";
import type { Slot } from "../grammar/router";
import {
    explainLine,
    routeLine,
    routeLineWith,
    SLOTS,
} from "../grammar/router";
import { ok, rule } from "../rule";
import { oracleCard, parseContext } from "./fixtures";

describe("keyword line slot (CR 702.1)", () => {
    const ctx = parseContext();

    it("reads a single keyword", () => {
        const r = keywordLineSlot.run("Flying", ctx);
        expect(r.ok).toBe(true);
        if (r.ok && r.value.kind === "keywords") {
            expect(r.value.keywords.map((k) => k.ability)).toEqual(["flying"]);
        }
    });

    it("reads a comma run and a semicolon group, keeping every keyword", () => {
        const comma = keywordLineSlot.run("Flying, trample", ctx);
        expect(comma.ok).toBe(true);
        if (comma.ok && comma.value.kind === "keywords") {
            expect(comma.value.keywords.map((k) => k.ability)).toEqual([
                "flying",
                "trample",
            ]);
        }
        const semi = keywordLineSlot.run("Flying; banding", ctx);
        expect(semi.ok).toBe(true);
        if (semi.ok && semi.value.kind === "keywords") {
            expect(semi.value.keywords.map((k) => k.ability)).toEqual([
                "flying",
                "banding",
            ]);
        }
    });

    it("REFUSES a parameterised keyword rather than dropping the parameter", () => {
        // The whole misparse class in one assertion: "Protection from white"
        // read as "protection" is a card that plays wrong forever.
        for (const line of [
            "Protection from white",
            "Rampage 1",
            "Ward {4}",
            "Cycling {2}",
        ]) {
            expect(keywordLineSlot.run(line, ctx).ok).toBe(false);
        }
    });

    it("refuses a keyword line with any prose attached", () => {
        expect(
            keywordLineSlot.run("Flying, and it can't be blocked", ctx).ok
        ).toBe(false);
        expect(keywordLineSlot.run("Flying.", ctx).ok).toBe(false);
    });

    it("refuses the same keyword twice on one line", () => {
        expect(keywordLineSlot.run("Flying, flying", ctx).ok).toBe(false);
    });

    it("draws its vocabulary from the Mechanics Registry, not a local list", () => {
        const vocabulary = keywordVocabulary();
        const registryNames = new Set(
            MECHANICS_REGISTRY.filter((r) => r.kind === "keyword-ability").map(
                (r) => r.name.toLowerCase()
            )
        );
        expect(vocabulary.size).toBe(registryNames.size);
        for (const name of registryNames)
            expect(vocabulary.has(name)).toBe(true);
    });

    it("carries the registry status through, so a planned keyword is visible", () => {
        const vocabulary = keywordVocabulary();
        const flying = vocabulary.get("flying");
        expect(flying?.status).toBe("implemented");
        for (const [, keyword] of vocabulary) {
            expect(["implemented", "planned", "out-of-scope"]).toContain(
                keyword.status
            );
        }
    });
});

describe("mana ability slot (CR 605.1a)", () => {
    const land = parseContext(
        oracleCard({
            typeLine: "Land",
            manaCost: "",
            power: undefined,
            toughness: undefined,
        })
    );

    it("reads a fixed production", () => {
        const r = manaAbilitySlot.run("{T}: Add {G}.", land);
        expect(r.ok).toBe(true);
        if (r.ok && r.value.kind === "mana-ability") {
            expect(r.value.cost).toEqual({ tap: true });
            expect(r.value.produces).toEqual({ kind: "fixed", mana: { G: 1 } });
        }
    });

    it("reads a multi-symbol production without collapsing it to one", () => {
        const r = manaAbilitySlot.run("{T}: Add {C}{C}.", land);
        expect(r.ok).toBe(true);
        if (r.ok && r.value.kind === "mana-ability") {
            expect(r.value.produces).toEqual({ kind: "fixed", mana: { C: 2 } });
        }
    });

    it("reads a mana cost alongside the tap symbol (CR 602.1a)", () => {
        const r = manaAbilitySlot.run("{2}, {T}: Add {W}.", land);
        expect(r.ok).toBe(true);
        if (r.ok && r.value.kind === "mana-ability") {
            expect(r.value.cost).toEqual({ tap: true, mana: { X: 2 } });
        }
    });

    it("reads a two-way and an oxford choice, keeping every option", () => {
        const two = manaAbilitySlot.run("{T}: Add {B} or {R}.", land);
        expect(two.ok).toBe(true);
        if (two.ok && two.value.kind === "mana-ability") {
            expect(two.value.produces).toEqual({
                kind: "choice",
                options: [{ B: 1 }, { R: 1 }],
            });
        }
        const three = manaAbilitySlot.run("{T}: Add {W}, {U}, or {B}.", land);
        expect(three.ok).toBe(true);
        if (three.ok && three.value.kind === "mana-ability") {
            expect(three.value.produces).toEqual({
                kind: "choice",
                options: [{ W: 1 }, { U: 1 }, { B: 1 }],
            });
        }
    });

    it("refuses a quantity expression rather than approximating it (#2697)", () => {
        for (const line of [
            "{T}: Add one mana of any color.",
            "{T}: Add three mana of any one color.",
            "{T}: Add {G} for each Forest you control.",
        ]) {
            expect(manaAbilitySlot.run(line, land).ok).toBe(false);
        }
    });

    it("refuses a trailing rider on an otherwise readable ability", () => {
        expect(
            manaAbilitySlot.run(
                "{T}: Add {G}. Activate only as a sorcery.",
                land
            ).ok
        ).toBe(false);
        expect(manaAbilitySlot.run("{T}: Add {G}", land).ok).toBe(false);
    });

    it("refuses a mana ability on a non-permanent", () => {
        const instant = parseContext(
            oracleCard({
                typeLine: "Instant",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(manaAbilitySlot.run("{T}: Add {G}.", instant).ok).toBe(false);
    });
});

describe("slot router — unique dispatch (CR 113.3a-d)", () => {
    const ctx = parseContext();

    it("routes a line to exactly one slot", () => {
        const r = routeLine("Flying", ctx);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.slot).toBe("keyword-line");
    });

    it("fails, with no slot chosen, when nothing consumes the line", () => {
        const r = routeLine(
            "Destroy target creature. It can't be regenerated.",
            ctx
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe("no slot consumed the line");
    });

    it("exposes every slot, including the four that are still stubs", () => {
        expect(SLOTS.map((s) => s.name)).toEqual([
            "keyword-line",
            "mana-ability",
            "activated",
            "triggered",
            "static",
            "spell",
        ]);
    });

    it("explainLine reports a verdict from every slot", () => {
        const verdicts = explainLine("Flying", ctx);
        expect(verdicts).toHaveLength(SLOTS.length);
        expect(verdicts.find((v) => v.slot === "keyword-line")?.verdict).toBe(
            "consumed"
        );
        for (const v of verdicts.filter((v) => v.slot !== "keyword-line")) {
            expect(v.verdict).not.toBe("consumed");
        }
    });

    it("REFUSES a line two slots both consume, rather than taking the first", () => {
        // The 2+ branch is unreachable through `SLOTS` while four of six slots
        // are stubs, so it is exercised through injected slots instead. This
        // is the guard on the PR's headline invariant (ADR 0105: no priority
        // ladder, no catch-all): mutating `hits.length === 1` to `>= 1` makes
        // the router first-slot-wins, and nothing else in this directory
        // notices.
        const always = (name: string): Slot => ({
            name,
            rule: rule<SlotIR>(name, () =>
                ok({ kind: "keywords", keywords: [] })
            ),
        });
        const r = routeLineWith(
            [always("zebra-slot"), always("alpha-slot")],
            "Flying",
            ctx
        );
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toMatch(/ambiguous/);
            // Sorted, so slot ORDER cannot reach the lockfile.
            expect(r.reason).toContain("alpha-slot and zebra-slot");
        }
    });

    it("routes through the injected list, so a single hit still wins", () => {
        // Without this the test above would also pass on a router that failed
        // unconditionally.
        const only: Slot = {
            name: "only-slot",
            rule: rule<SlotIR>("only-slot", () =>
                ok({ kind: "keywords", keywords: [] })
            ),
        };
        const r = routeLineWith([only], "Flying", ctx);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.slot).toBe("only-slot");
    });

    it("has NO catch-all: spell text is refused, not best-effort parsed", () => {
        const sorcery = parseContext(
            oracleCard({
                typeLine: "Sorcery",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(routeLine("Draw a card.", sorcery).ok).toBe(false);
    });
});

describe("stubs fail closed", () => {
    const ctx = parseContext();

    it("every unimplemented SLOT fails on representative input", () => {
        const cases: [string, string][] = [
            ["activated", "{2}, {T}: Draw a card."],
            ["triggered", "When this creature enters, draw a card."],
            ["static", "Creatures you control get +1/+1."],
            ["spell", "Destroy target creature."],
        ];
        const rules = {
            activated: activatedSlot,
            triggered: triggeredSlot,
            static: staticSlot,
            spell: spellSlot,
        };
        for (const [name, line] of cases) {
            const r = rules[name as keyof typeof rules].run(line, ctx);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.reason).toMatch(/#(2697|2698|2699|2700)/);
        }
    });

    it("every shared SUB-GRAMMAR fails on representative input", () => {
        const cases: [ReturnType<typeof String>, string][] = [
            ["targetFilter", "target creature an opponent controls"],
            ["quantity", "for each Forest you control"],
            ["duration", "until end of turn"],
            ["condition", "if you control a creature"],
            ["playerRef", "each opponent"],
            ["zoneRef", "your graveyard"],
        ];
        const rules = {
            targetFilter: targetFilterRule,
            quantity: quantityRule,
            duration: durationRule,
            condition: conditionRule,
            playerRef: playerRefRule,
            zoneRef: zoneRefRule,
        };
        for (const [name, input] of cases) {
            const r = rules[name as keyof typeof rules].run(input, ctx);
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.reason).toMatch(/#269[78]/);
        }
    });
});

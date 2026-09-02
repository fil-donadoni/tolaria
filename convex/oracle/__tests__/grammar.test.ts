// Grammar v0: keyword lines (CR 702.1), mana abilities (CR 605.1a), activated
// abilities (CR 602.1a), the slot router's unique dispatch, and the fail-closed
// behaviour of every remaining stub.
//
// Per-SUB-GRAMMAR range tests live in `subGrammars.test.ts` — this file tests
// the SLOTS, which is where the router's exactly-one-hit rule is observable.

import { describe, expect, it } from "vitest";
import { MECHANICS_REGISTRY } from "../../cards/mechanicsRegistry";
import { conditionRule } from "../grammar/shared/condition";
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
            expect(r.value.cost).toEqual({ atoms: [{ kind: "tap" }] });
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
            expect(r.value.cost).toEqual({
                atoms: [{ kind: "mana", mana: { X: 2 } }, { kind: "tap" }],
            });
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

    it("has NO catch-all: unread spell text is refused, not best-effort parsed", () => {
        const sorcery = parseContext(
            oracleCard({
                typeLine: "Sorcery",
                power: undefined,
                toughness: undefined,
            })
        );
        // The spell slot ships (#2699), so the catch-all question is no longer
        // "is any sorcery line refused" but the sharper one: a line the spell
        // grammar does not READ must still fail, rather than being swept into
        // the slot that happens to apply to this card type. "Draw a card." is
        // now consumed — deliberately asserted here too, so this test cannot
        // pass by the slot having been switched off.
        expect(routeLine("Draw a card.", sorcery).ok).toBe(true);
        expect(routeLine("Destroy all green creatures.", sorcery).ok).toBe(
            false
        );
        expect(
            routeLine("Each player sacrifices a creature.", sorcery).ok
        ).toBe(false);
    });
});

describe("activated ability slot (CR 602.1a)", () => {
    const creature = parseContext();
    const land = parseContext(
        oracleCard({
            typeLine: "Land",
            manaCost: "",
            power: undefined,
            toughness: undefined,
        })
    );

    function ir(line: string, ctx = creature) {
        const r = activatedSlot.run(line, ctx);
        if (!r.ok) throw new Error(`${line} -> ${r.reason}`);
        if (r.value.kind !== "activated") throw new Error("wrong IR kind");
        return r.value;
    }

    it("reads a tap cost and a targeted effect", () => {
        const parsed = ir("{1}, {T}: Tap target land.", land);
        expect(parsed.cost.atoms).toEqual([
            { kind: "mana", mana: { X: 1 } },
            { kind: "tap" },
        ]);
        expect(parsed.effects).toEqual([
            {
                kind: "tap-untap",
                action: "tap",
                subject: {
                    kind: "target",
                    requirement: { type: "Land", count: 1 },
                },
            },
        ]);
    });

    it("reads a non-mana cost atom the mana slot also uses", () => {
        const parsed = ir(
            "{3}, {T}, Sacrifice a land: Destroy target nonbasic land.",
            land
        );
        expect(parsed.cost.atoms.map((a) => a.kind)).toEqual([
            "mana",
            "tap",
            "sacrifice-other",
        ]);
    });

    it("keeps a trailing restriction sentence (CR 602.5d)", () => {
        const parsed = ir(
            "{T}: Draw a card. Activate only as a sorcery.",
            creature
        );
        expect(parsed.effects).toHaveLength(1);
        expect(parsed.restrictions).toEqual([{ kind: "sorcery-only" }]);
    });

    it('attaches "It can\'t be regenerated." to the destroy it follows', () => {
        const parsed = ir(
            "{T}: Destroy target creature. It can't be regenerated."
        );
        expect(parsed.effects).toEqual([
            {
                kind: "destroy",
                cantBeRegenerated: true,
                subject: {
                    kind: "target",
                    requirement: { type: "Creature", count: 1 },
                },
            },
        ]);
    });

    it("refuses a modifier with no sentence in front of it", () => {
        const r = activatedSlot.run("{T}: It can't be regenerated.", creature);
        expect(r.ok).toBe(false);
    });

    it("refuses an effect sentence AFTER a restriction (CR 602.5)", () => {
        const r = activatedSlot.run(
            "{T}: Activate only as a sorcery. Draw a card.",
            creature
        );
        expect(r.ok).toBe(false);
    });

    it("refuses a trailing clause it cannot read, rather than the prefix", () => {
        expect(activatedSlot.run("{T}: Tap target land.", land).ok).toBe(true);
        expect(
            activatedSlot.run(
                "{T}: Tap target land. It doesn't untap during its controller's next untap step.",
                land
            ).ok
        ).toBe(false);
        expect(
            activatedSlot.run("{T}: Tap target land you don't control.", land)
                .ok
        ).toBe(false);
    });

    it("refuses a cost atom it cannot read, rather than the atoms it can", () => {
        expect(
            activatedSlot.run(
                "{T}, Reveal a Goblin card from your hand: Draw a card.",
                creature
            ).ok
        ).toBe(false);
    });

    it("refuses an activated ability on a non-permanent (CR 602.1a)", () => {
        const sorcery = parseContext(
            oracleCard({
                typeLine: "Sorcery",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(activatedSlot.run("{T}: Draw a card.", sorcery).ok).toBe(false);
    });
});

describe("the activated and mana-ability slots do not overlap (CR 605.1a)", () => {
    const land = parseContext(
        oracleCard({
            typeLine: "Land",
            manaCost: "",
            power: undefined,
            toughness: undefined,
        })
    );

    // The router requires EXACTLY ONE slot per line, so a grammar that read
    // "Add" at both slots would turn every mana ability in the corpus into an
    // ambiguity. Both directions are asserted, because only asserting the
    // router's verdict would still pass if BOTH slots stopped matching.
    it("a mana line is consumed by the mana slot and refused by the activated one", () => {
        expect(manaAbilitySlot.run("{T}: Add {G}.", land).ok).toBe(true);
        expect(activatedSlot.run("{T}: Add {G}.", land).ok).toBe(false);
        const routed = routeLine("{T}: Add {G}.", land);
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("mana-ability");
    });

    it("a non-mana line is consumed by the activated slot and refused by the mana one", () => {
        expect(activatedSlot.run("{1}, {T}: Tap target land.", land).ok).toBe(
            true
        );
        expect(manaAbilitySlot.run("{1}, {T}: Tap target land.", land).ok).toBe(
            false
        );
        const routed = routeLine("{1}, {T}: Tap target land.", land);
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("activated");
    });

    it("a line that adds mana AND does something else is consumed by neither", () => {
        const line = "{T}: Add {C}{C}. Draw a card.";
        expect(manaAbilitySlot.run(line, land).ok).toBe(false);
        expect(activatedSlot.run(line, land).ok).toBe(false);
        expect(routeLine(line, land).ok).toBe(false);
    });
});

describe("stubs fail closed", () => {
    const ctx = parseContext();

    it("the spell slot no longer fails closed (#2699 shipped it)", () => {
        const sorcery = parseContext(
            oracleCard({
                typeLine: "Sorcery",
                power: undefined,
                toughness: undefined,
            })
        );
        const r = spellSlot.run("Destroy target creature.", sorcery);
        expect(r.ok).toBe(true);
    });

    it("the spell slot still refuses spell text on a PERMANENT (CR 113.3a)", () => {
        // The guard that keeps the shipped slot from becoming the catch-all
        // the router forbids: `ctx` here is a creature, whose text box holds
        // abilities (CR 113.3b-d), never a resolve-once instruction.
        const r = spellSlot.run("Destroy target creature.", ctx);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/CR 113\.3a/);
    });

    it("the static slot no longer fails closed (#2700 shipped it)", () => {
        const r = staticSlot.run("Creatures you control get +1/+1.", ctx);
        expect(r.ok).toBe(true);
    });

    it("the triggered slot no longer fails closed (#2698 shipped it)", () => {
        const r = triggeredSlot.run(
            "When this creature enters, draw a card.",
            ctx
        );
        expect(r.ok).toBe(true);
    });

    it("the CONDITION sub-grammar reads a controls clause (CR 603.4)", () => {
        const r = conditionRule.run("if you control a creature", ctx);
        expect(r.ok).toBe(true);
        if (r.ok)
            expect(r.value).toEqual({
                kind: "controls",
                filter: { types: ["Creature"] },
                atLeast: 1,
            });
    });
});

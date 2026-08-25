// Range tests for the SHARED sub-grammars (#2697).
//
// These are deliberately not per-card tests. Each sub-grammar is a phrase the
// Oracle prints at several sites — a descriptor is a target filter on one card
// and a sacrifice cost's filter on the next — and #2698 (triggered), #2699
// (spell) and #2700 (static) consume the same modules unchanged. So the tests
// below exercise each rule's RANGE: what it accepts, what it refuses, and the
// near-misses that must not be read as the shape they resemble.
//
// The refusal cases carry the weight. A permissive descriptor that reads
// "target creature you don't control" as "target creature" is the competitor's
// largest documented misparse bucket (PRD #2693), and it is invisible in an
// accept-only test suite.

import { describe, expect, it } from "vitest";
import { activationCostRule, isSelfPhrase } from "../grammar/shared/cost";
import { durationRule, durationSpec } from "../grammar/shared/duration";
import { playerRefRule } from "../grammar/shared/playerRef";
import { forEachRule, quantityRule } from "../grammar/shared/quantity";
import {
    descriptorRule,
    descriptorRuleWith,
    permanentFilterFromDescriptor,
    targetFilterRule,
} from "../grammar/shared/targetFilter";
import { zoneRefRule } from "../grammar/shared/zoneRef";
import { parseContext } from "./fixtures";

const ctx = parseContext();

function accept<T>(
    rule: { run: (s: string, c: unknown) => unknown },
    span: string
): T {
    const r = rule.run(span, ctx) as
        | { ok: true; value: T }
        | { ok: false; reason: string };
    if (!r.ok) throw new Error(`"${span}" was refused: ${r.reason}`);
    return r.value;
}

function refuses(
    rule: { run: (s: string, c: unknown) => { ok: boolean } },
    span: string
): boolean {
    return !rule.run(span, ctx).ok;
}

describe("descriptor sub-grammar (CR 109.1, CR 115.1)", () => {
    it("reads a bare card-type noun", () => {
        expect(accept(descriptorRule, "creature")).toEqual({
            types: ["Creature"],
        });
    });

    it("reads an or-list of card types, keeping every member", () => {
        expect(accept(descriptorRule, "artifact or enchantment")).toEqual({
            types: ["Artifact", "Enchantment"],
        });
        expect(accept(descriptorRule, "artifact, creature, or land")).toEqual({
            types: ["Artifact", "Creature", "Land"],
        });
    });

    it('expands "permanent" to every permanent card type (CR 300.1)', () => {
        expect(accept(descriptorRule, "permanent")).toEqual({
            types: [
                "Artifact",
                "Battle",
                "Creature",
                "Enchantment",
                "Land",
                "Planeswalker",
            ],
        });
    });

    it("reads colour, supertype and negated adjectives", () => {
        expect(accept(descriptorRule, "black creature")).toEqual({
            types: ["Creature"],
            colors: ["B"],
        });
        expect(accept(descriptorRule, "nonblack creature")).toEqual({
            types: ["Creature"],
            excludeColors: ["B"],
        });
        expect(accept(descriptorRule, "nonbasic land")).toEqual({
            types: ["Land"],
            excludeSupertypes: ["Basic"],
        });
        expect(accept(descriptorRule, "legendary creature")).toEqual({
            types: ["Creature"],
            supertypes: ["Legendary"],
        });
        expect(accept(descriptorRule, "nonartifact creature")).toEqual({
            types: ["Creature"],
            excludeTypes: ["Artifact"],
        });
        expect(accept(descriptorRule, "non-Wall creature")).toEqual({
            types: ["Creature"],
            excludeSubtypes: ["Wall"],
        });
    });

    it("records a bare CR 205.3 subtype noun WITHOUT inventing its card type", () => {
        // The implied type is the consumer's business, not the phrase's — see
        // `readNoun`. `targetFilterRule` infers it (its `type` is mandatory),
        // `permanentFilterFromDescriptor` does not.
        expect(accept(descriptorRule, "Wall")).toEqual({ subtypes: ["Wall"] });
        expect(accept(descriptorRule, "Forest")).toEqual({
            subtypes: ["Forest"],
        });
    });

    it("refuses a capitalised noun that is not a CR 205.3 subtype", () => {
        expect(refuses(descriptorRule, "Zzyzx")).toBe(true);
        // An ENCHANTMENT subtype has no creature reading, and guessing one is
        // exactly what the vendored table exists to prevent.
        expect(refuses(descriptorRule, "Aura")).toBe(true);
    });

    it("reads trailing qualifiers and REFUSES the ones it does not know", () => {
        expect(accept(descriptorRule, "creature you control")).toEqual({
            types: ["Creature"],
            controller: "you",
        });
        expect(accept(descriptorRule, "creature an opponent controls")).toEqual(
            { types: ["Creature"], controller: "opponent" }
        );
        expect(accept(descriptorRule, "creature with flying")).toEqual({
            types: ["Creature"],
            requireAbility: "flying",
        });
        expect(accept(descriptorRule, "creature without flying")).toEqual({
            types: ["Creature"],
            excludeAbility: "flying",
        });
        expect(accept(descriptorRule, "creature with power 2 or less")).toEqual(
            { types: ["Creature"], powerFilter: { max: 2 } }
        );
        expect(
            accept(descriptorRule, "creature with mana value 3 or greater")
        ).toEqual({ types: ["Creature"], mvFilter: { min: 3 } });
        // The whole point of the sub-grammar: a qualifier it cannot read must
        // fail the phrase, never leave the noun it modified standing alone.
        expect(refuses(descriptorRule, "creature you don't control")).toBe(
            true
        );
        expect(
            refuses(descriptorRule, "creature with a +1/+1 counter on it")
        ).toBe(true);
    });

    it("stacks a qualifier with an adjective without losing either", () => {
        expect(
            accept(descriptorRule, "tapped black creature you control")
        ).toEqual({
            types: ["Creature"],
            colors: ["B"],
            controller: "you",
            tapped: "tapped",
        });
    });

    it("reads a card in a graveyard as a card, not as a permanent", () => {
        expect(
            accept(descriptorRule, "creature card from your graveyard")
        ).toEqual({
            types: ["Creature"],
            zone: "graveyard",
            zoneOwner: "you",
            card: true,
        });
    });

    it("reads player nouns and refuses object filters on them", () => {
        expect(accept(descriptorRule, "player")).toEqual({ player: "any" });
        expect(accept(descriptorRule, "opponent")).toEqual({
            player: "opponent",
        });
        expect(refuses(descriptorRule, "black player")).toBe(true);
    });

    it("REFUSES a phrase two splits both read, rather than taking the first", () => {
        // The unique-split guarantee is this sub-grammar's headline claim, and
        // no phrase in the shipped vocabulary reaches its 2+ branch: a token is
        // either an adjective or a noun head, never both in a way that yields
        // two WHOLE readings. So the branch is exercised through injected
        // readers, the seam `routeLineWith` already uses for the router's own
        // ambiguity branch. Deleting `if (hits.length > 1) return fail(...)`
        // turns the unique split into a first-hit split, and without this test
        // nothing in the directory notices.
        const ambiguous = descriptorRuleWith({
            adjective: () => null,
            noun: (_tokens, into) => {
                into.types = ["Creature"];
                return null;
            },
        });
        const r = ambiguous.run("alpha beta", ctx);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/ambiguous descriptor/);
    });

    it("splits through the injected readers, so a single reading still wins", () => {
        // Without this, the test above would also pass on a rule that refused
        // unconditionally.
        const single = descriptorRuleWith({
            adjective: () => "unknown",
            noun: (_tokens, into) => {
                into.types = ["Creature"];
                return null;
            },
        });
        const r = single.run("alpha beta", ctx);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toEqual({ types: ["Creature"] });
    });
});

describe("target filter sub-grammar (CR 115.1)", () => {
    it('requires the word target, or the fixed phrase "any target"', () => {
        expect(accept(targetFilterRule, "any target")).toEqual({
            type: "any",
            count: 1,
        });
        expect(accept(targetFilterRule, "target creature")).toEqual({
            type: "Creature",
            count: 1,
        });
        expect(refuses(targetFilterRule, "creature")).toBe(true);
    });

    it("maps a descriptor onto the engine's requirement fields", () => {
        expect(accept(targetFilterRule, "target nonbasic land")).toEqual({
            type: "Land",
            count: 1,
            excludeSupertypes: ["Basic"],
        });
        expect(accept(targetFilterRule, "target Wall")).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: ["Wall"],
        });
        expect(
            accept(targetFilterRule, "target creature card from your graveyard")
        ).toEqual({
            type: "Creature",
            count: 1,
            zone: "graveyard",
            controller: "you",
        });
        expect(accept(targetFilterRule, "target opponent")).toEqual({
            type: "player",
            count: 1,
            controller: "opponent",
        });
    });

    it("refuses a plural target phrase rather than dropping the count", () => {
        expect(refuses(targetFilterRule, "target creatures")).toBe(true);
        expect(refuses(targetFilterRule, "two target creatures")).toBe(true);
    });

    it("refuses a permanent descriptor that names a graveyard", () => {
        // CR 109.2 — "creature" alone means a creature PERMANENT, so a
        // graveyard clause on it is a phrase we have misread.
        expect(
            refuses(targetFilterRule, "target creature from your graveyard")
        ).toBe(true);
    });
});

describe("descriptor → cost filter (CR 602.1, CR 118.5)", () => {
    it("keeps the type and subtype a sacrifice cost can express", () => {
        const goblin = accept<
            Parameters<typeof permanentFilterFromDescriptor>[0]
        >(descriptorRule, "Goblin");
        const filter = permanentFilterFromDescriptor(goblin);
        expect(filter.ok).toBe(true);
        // No `types`: "Goblin" already implies Creature (CR 205.3m), and a
        // filter that restated it would say more than the phrase does.
        if (filter.ok) expect(filter.value).toEqual({ subtypes: ["Goblin"] });

        const spelledOut = accept<
            Parameters<typeof permanentFilterFromDescriptor>[0]
        >(descriptorRule, "Goblin creature");
        const explicit = permanentFilterFromDescriptor(spelledOut);
        expect(explicit.ok).toBe(true);
        if (explicit.ok)
            expect(explicit.value).toEqual({
                types: ["Creature"],
                subtypes: ["Goblin"],
            });
    });

    it("REFUSES a clause the cost filter has no field for", () => {
        // Dropping it would make an illegal activation legal, which is the
        // asymmetry `cost.ts` is built around.
        const tapped = accept<
            Parameters<typeof permanentFilterFromDescriptor>[0]
        >(descriptorRule, "tapped creature");
        expect(permanentFilterFromDescriptor(tapped).ok).toBe(false);
        const controlled = accept<
            Parameters<typeof permanentFilterFromDescriptor>[0]
        >(descriptorRule, "creature an opponent controls");
        expect(permanentFilterFromDescriptor(controlled).ok).toBe(false);
    });
});

describe("quantity sub-grammar (CR 107.1, CR 107.3)", () => {
    it("reads spelled cardinals and printed digits", () => {
        for (const [span, value] of [
            ["a", 1],
            ["an", 1],
            ["one", 1],
            ["two", 2],
            ["ten", 10],
            ["twenty", 20],
            ["7", 7],
            ["100", 100],
        ] as const) {
            expect(accept(quantityRule, span)).toEqual({
                kind: "fixed",
                value,
            });
        }
    });

    it("reads X as a computed value, never as a number", () => {
        expect(accept(quantityRule, "X")).toEqual({ kind: "x" });
    });

    it("reads a for-each clause as a set, never collapsed to a constant", () => {
        expect(accept(forEachRule, "for each Goblin you control")).toEqual({
            kind: "for-each",
            per: { subtypes: ["Goblin"], controller: "you" },
        });
        expect(accept(quantityRule, "for each Forest you control")).toEqual({
            kind: "for-each",
            per: { subtypes: ["Forest"], controller: "you" },
        });
    });

    it("refuses count phrases whose ARITY is a player choice", () => {
        expect(refuses(quantityRule, "any number of")).toBe(true);
        expect(refuses(quantityRule, "up to two")).toBe(true);
        expect(refuses(quantityRule, "twenty-one")).toBe(true);
    });
});

describe("duration sub-grammar (CR 611.2b)", () => {
    it("reads each printed duration phrase", () => {
        expect(accept(durationRule, "until end of turn")).toEqual({
            kind: "end-of-turn",
        });
        expect(accept(durationRule, "until end of combat")).toEqual({
            kind: "end-of-combat",
        });
        expect(accept(durationRule, "until your next turn")).toEqual({
            kind: "your-next-turn",
        });
    });

    it("lowers each to the engine's DurationSpec", () => {
        expect(durationSpec({ kind: "end-of-turn" })).toEqual({
            phase: "end-of-turn",
        });
        expect(durationSpec({ kind: "your-next-turn" })).toEqual({
            phase: "untap",
            player: "controller",
        });
    });

    it("refuses an open-ended duration rather than defaulting to permanent", () => {
        expect(refuses(durationRule, "for as long as you control it")).toBe(
            true
        );
        expect(refuses(durationRule, "until your next upkeep")).toBe(true);
        expect(refuses(durationRule, "")).toBe(true);
    });
});

describe("player reference sub-grammar (CR 102.1, CR 109.5)", () => {
    it("reads the printed player phrases", () => {
        expect(accept(playerRefRule, "you")).toEqual({ kind: "you" });
        expect(accept(playerRefRule, "each player")).toEqual({
            kind: "each-player",
        });
        expect(accept(playerRefRule, "each opponent")).toEqual({
            kind: "each-opponent",
        });
        expect(accept(playerRefRule, "target player")).toEqual({
            kind: "target",
            opponent: false,
        });
        expect(accept(playerRefRule, "target opponent")).toEqual({
            kind: "target",
            opponent: true,
        });
    });

    it("refuses anaphora rather than resolving it by proximity", () => {
        expect(refuses(playerRefRule, "that player")).toBe(true);
        expect(refuses(playerRefRule, "its controller")).toBe(true);
    });
});

describe("zone reference sub-grammar (CR 400.1)", () => {
    it("reads zone, owner and position as three separate facts", () => {
        expect(accept(zoneRefRule, "your graveyard")).toEqual({
            zone: "graveyard",
            owner: "you",
        });
        expect(accept(zoneRefRule, "its owner's hand")).toEqual({
            zone: "hand",
            owner: "its-owner",
        });
        expect(accept(zoneRefRule, "the top of your library")).toEqual({
            zone: "library",
            owner: "you",
            position: "top",
        });
        expect(accept(zoneRefRule, "the bottom of your library")).toEqual({
            zone: "library",
            owner: "you",
            position: "bottom",
        });
    });

    it('keeps "your hand" and "its owner\'s hand" distinct (CR 400.3)', () => {
        expect(accept(zoneRefRule, "your hand")).not.toEqual(
            accept(zoneRefRule, "its owner's hand")
        );
    });

    it("refuses a library reference with no end named", () => {
        expect(refuses(zoneRefRule, "a library")).toBe(true);
        expect(refuses(zoneRefRule, "their library")).toBe(true);
    });
});

describe("activation cost sub-grammar (CR 602.1a, CR 118.1)", () => {
    it("reads every atom kind the engine has a cost field for", () => {
        const cases: [string, string[]][] = [
            ["{T}", ["tap"]],
            ["{2}{B}", ["mana"]],
            ["{T}, Sacrifice this creature", ["tap", "sacrifice-self"]],
            ["Sacrifice a creature", ["sacrifice-other"]],
            ["{T}, Pay 1 life", ["tap", "pay-life"]],
            ["Discard a card", ["discard"]],
            ["Discard a creature card", ["discard"]],
            ["Discard two cards at random", ["discard-at-random"]],
            ["Remove a charge counter from this artifact", ["remove-counter"]],
            ["Exile two cards from your graveyard", ["exile-from-graveyard"]],
            ["{T}, Exile this artifact", ["tap", "exile-self"]],
        ];
        for (const [span, kinds] of cases) {
            const parsed = accept<{ atoms: { kind: string }[] }>(
                activationCostRule,
                span
            );
            expect(parsed.atoms.map((a) => a.kind)).toEqual(kinds);
        }
    });

    it("keeps the parameters of an atom rather than its kind alone", () => {
        expect(accept(activationCostRule, "Pay 3 life")).toEqual({
            atoms: [{ kind: "pay-life", amount: 3 }],
        });
        expect(
            accept(
                activationCostRule,
                "Remove three spore counters from this creature"
            )
        ).toEqual({
            atoms: [{ kind: "remove-counter", counter: "spore", count: 3 }],
        });
        expect(
            accept(
                activationCostRule,
                "Exile two creature cards from a single graveyard"
            )
        ).toEqual({
            atoms: [
                {
                    kind: "exile-from-graveyard",
                    count: 2,
                    cardType: "Creature",
                },
            ],
        });
    });

    it("refuses an atom kind that has no cost field, and the whole cost with it", () => {
        expect(
            refuses(activationCostRule, "Reveal a Goblin card from your hand")
        ).toBe(true);
        expect(
            refuses(
                activationCostRule,
                "{T}, Reveal a Goblin card from your hand"
            )
        ).toBe(true);
        expect(
            refuses(
                activationCostRule,
                "Return this creature to its owner's hand"
            )
        ).toBe(true);
    });

    it("refuses the same atom kind twice", () => {
        expect(refuses(activationCostRule, "{T}, {T}")).toBe(true);
        expect(refuses(activationCostRule, "{1}, {2}")).toBe(true);
    });

    it("recognises the source under both templatings (CR 109.2)", () => {
        expect(isSelfPhrase("this creature")).toBe(true);
        expect(isSelfPhrase("this artifact")).toBe(true);
        expect(isSelfPhrase("{self}")).toBe(true);
        expect(isSelfPhrase("that creature")).toBe(false);
        expect(isSelfPhrase("enchanted creature")).toBe(false);
    });
});

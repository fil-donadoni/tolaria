// The triggered slot (issue #2698, CR 113.3c / 603.2 / 603.4 / 603.6a).
//
// Three things are measured here and nowhere else:
//
//  1. RANGE — every head the table claims, read end to end through
//     `compileCard`, so a head that parses but does not lower is not mistaken
//     for a working row.
//  2. REFUSALS — the shapes v0 deliberately does not read. These matter more
//     than the accepts: a compiler that accepts a shape it half-understands is
//     the defect ADR 0105 exists to prevent, and a refusal nobody asserts is a
//     refusal that quietly becomes an accept.
//  3. DISJOINTNESS — the self-subject table and the other-subject table are
//     asserted not to overlap, rather than left to the order they are read in.
//
// The engine-side half (does the rebuilt ability actually FIRE?) is
// `convex/gre/__tests__/compiledTriggers.test.ts`; a grammar test cannot see
// it, and the two halves fail for different reasons.

import { describe, it, expect } from "vitest";
import { compileCard } from "../compile";
import { conditionRule } from "../grammar/shared/condition";
import { triggerHeadRule } from "../grammar/shared/triggerHead";
import { triggeredSlot } from "../grammar/slots/triggered";
import { oracleCard, parseContext } from "./fixtures";
import type { CompiledTriggeredAbility } from "../../cards/compiledTriggers";

const ctx = parseContext();

/** Compile a one-line creature and hand back its compiled triggers. */
function triggersOf(
    oracleText: string,
    overrides: Parameters<typeof oracleCard>[0] = {}
): readonly CompiledTriggeredAbility[] {
    const outcome = compileCard(oracleCard({ oracleText, ...overrides }));
    if (outcome.state === "unparsed")
        throw new Error(
            `expected a compile, got unparsed: ${outcome.gaps.map((g) => g.reason).join("; ")}`
        );
    return outcome.definition.compiledTriggeredAbilities ?? [];
}

function refusalReason(oracleText: string): string {
    const outcome = compileCard(oracleCard({ oracleText }));
    if (outcome.state !== "unparsed")
        throw new Error(`expected unparsed, got ${outcome.state}`);
    return outcome.gaps.map((g) => g.reason).join("; ");
}

describe("trigger heads (CR 603.2 / 603.6a)", () => {
    it("reads a self ETB under every self noun the CR templates", () => {
        for (const noun of ["creature", "artifact", "enchantment", "land"]) {
            const heads = triggersOf(`When this ${noun} enters, draw a card.`);
            expect(heads).toHaveLength(1);
            expect(heads[0]!.head).toEqual({ kind: "entered", scope: "self" });
        }
    });

    it("reads the older wording, where the card names itself (CR 201.5)", () => {
        // `normalize.ts` substitutes `{self}` for the card's own name; the
        // head must accept the marker as the same referent the noun is.
        const heads = triggersOf("When Test Card enters, draw a card.");
        expect(heads[0]!.head).toEqual({ kind: "entered", scope: "self" });
    });

    it("reads every non-self head the table claims", () => {
        const cases: [string, unknown][] = [
            [
                "Whenever another creature enters, you gain 1 life.",
                {
                    kind: "entered",
                    scope: "any-other",
                    filter: { types: ["Creature"] },
                },
            ],
            [
                "Whenever a creature you control enters, you gain 1 life.",
                {
                    kind: "entered",
                    scope: "yours",
                    filter: { types: ["Creature"] },
                },
            ],
            [
                "Whenever a creature dies, you gain 1 life.",
                { kind: "died", scope: "any" },
            ],
            [
                "When this creature dies, draw a card.",
                { kind: "died", scope: "self" },
            ],
            [
                "Whenever this creature attacks, draw a card.",
                { kind: "attacks" },
            ],
            [
                "Whenever this creature deals combat damage to a player, draw a card.",
                { kind: "combat-damage-to-player" },
            ],
            [
                "At the beginning of your upkeep, draw a card.",
                { kind: "phase", phase: "UPKEEP", scope: "your" },
            ],
            [
                "At the beginning of each upkeep, you gain 1 life.",
                { kind: "phase", phase: "UPKEEP", scope: "each" },
            ],
            [
                "At the beginning of your end step, draw a card.",
                { kind: "phase", phase: "END_STEP", scope: "your" },
            ],
            [
                "At the beginning of combat on your turn, draw a card.",
                {
                    kind: "phase",
                    phase: "BEGINNING_OF_COMBAT",
                    scope: "your",
                },
            ],
            [
                "Whenever you cast a spell, you gain 1 life.",
                { kind: "spell-cast", scope: "you" },
            ],
            [
                "Whenever an opponent casts a spell, you gain 1 life.",
                { kind: "spell-cast", scope: "opponent" },
            ],
        ];
        for (const [line, head] of cases) {
            const triggers = triggersOf(line);
            expect(`${line} -> ${JSON.stringify(triggers[0]?.head)}`).toBe(
                `${line} -> ${JSON.stringify(head)}`
            );
        }
    });

    it("keeps the two head tables DISJOINT", () => {
        // The self branch is read first. That must not be load-bearing: a
        // phrase both tables accepted would make the answer depend on reading
        // order, which is the property `oneOf` and the router exist to deny.
        const selfPhrases = [
            "When this creature enters",
            "When {self} dies",
            "Whenever this artifact attacks",
        ];
        const otherPhrases = [
            "Whenever another creature enters",
            "Whenever a creature dies",
            "At the beginning of your upkeep",
        ];
        for (const phrase of [...selfPhrases, ...otherPhrases]) {
            expect(triggerHeadRule.run(phrase, ctx).ok).toBe(true);
        }
        // "this creature" and "another creature" differ by one word and by the
        // whole scope; neither table may read the other's subject.
        expect(
            triggerHeadRule.run("When another creature enters", ctx).ok
        ).toBe(false);
    });
});

describe("the intervening-if (CR 603.4)", () => {
    it("compiles the condition alongside the effect", () => {
        const triggers = triggersOf(
            "At the beginning of your upkeep, if you control a Goblin, you gain 1 life."
        );
        expect(triggers[0]!.condition).toEqual({
            kind: "controls",
            filter: { subtypes: ["Goblin"] },
            atLeast: 1,
        });
        expect(triggers[0]!.effects).toEqual([
            { op: "gainLife", player: "controller", amount: 1 },
        ]);
    });

    it("refuses a condition it cannot read rather than DROPPING it", () => {
        // The named competitor misparse: the ability still triggers, so
        // nothing looks broken until the game state diverges. The whole line
        // must fail, not just the clause.
        expect(
            refusalReason(
                "At the beginning of your upkeep, if you gained life this turn, draw a card."
            )
        ).toMatch(/no slot consumed the line/);
    });

    it("refuses a condition whose descriptor restates the controller", () => {
        // "if you control a creature you control" is a phrase we have
        // misread, not a filter to build.
        expect(
            conditionRule.run("if you control a creature you control", ctx).ok
        ).toBe(false);
    });
});

describe("what the triggered slot refuses", () => {
    it('refuses "you may" — CR 603 optionality has no Effect Script construct', () => {
        // `optionChoice`'s modes are validated as NON-EMPTY Op lists, so
        // "decline and do nothing" is not expressible. A missing Op is
        // stop-and-open-an-issue, never a guess.
        expect(
            refusalReason("When this creature enters, you may draw a card.")
        ).toMatch(/no slot consumed the line/);
    });

    it("refuses an activation restriction on a trigger (CR 602.5)", () => {
        const r = triggeredSlot.run(
            "When this creature enters, activate only as a sorcery.",
            ctx
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/activation restriction/);
    });

    it("refuses a head the table does not print", () => {
        expect(
            refusalReason("Whenever this creature becomes tapped, draw a card.")
        ).toMatch(/no slot consumed the line/);
    });

    it("refuses a trigger whose effect half it cannot read whole", () => {
        // The trailing clause changes WHEN the effect happens; matching the
        // prefix and dropping it is the competitor's largest misparse bucket.
        expect(
            refusalReason(
                "When this creature enters, draw a card at the beginning of the next turn's upkeep."
            )
        ).toMatch(/no slot consumed the line/);
    });
});

describe("targets are announced, not invented (CR 603.3d)", () => {
    it("declares the announced target and points the Op at its slot", () => {
        const triggers = triggersOf(
            "When this creature enters, destroy target creature."
        );
        expect(triggers[0]!.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
        expect(triggers[0]!.effects).toEqual([
            { op: "destroy", target: { target: 0 } },
        ]);
    });

    it("refuses a second announced target rather than emitting a dangling ref", () => {
        // The ops already say `{target: 0}` / `{target: 1}` positionally, so
        // dropping a requirement ships a script pointing at nothing.
        expect(
            refusalReason(
                "When this creature enters, destroy target creature. Tap target land."
            )
        ).toMatch(/one target per activated ability|targets were announced/);
    });
});

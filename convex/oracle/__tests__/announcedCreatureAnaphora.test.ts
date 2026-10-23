// "that creature" after ONE announced creature target, and the two sentences
// that read it on Whippoorwill (CR 608.2c, CR 615.12 / 614.9, CR 603.7a).
//
// "Target creature can't be regenerated this turn. Damage that would be dealt
// to that creature …" — the target announced in the first sentence is the
// antecedent of "that creature" in the next ones. The lowering binds the word
// to `{ target: 0 }` only when that target is the sole candidate, and refuses
// the line everywhere else rather than binding a guess.
//
//  1. GOLDEN — Whippoorwill is a `GOLDEN_FIXTURES` row (its delayed body moves
//     a departed card, a zone change the smoke scenario cannot stage), compared
//     whole by `goldenFixtures.test.ts`; here it must reach `ready`.
//  2. REFUSALS — every neighbour: a second announced target, a target an
//     earlier sentence destroyed, a trigger head whose subject is another
//     creature, an "any target" slot, an announced subject
//     and a half lock on the damage line, and another body behind the dies
//     head.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

const LOCK =
    "Damage that would be dealt to that creature this turn can't be prevented or dealt instead to another permanent or player.";

function ability(text: string) {
    return oracleCard({
        name: "Test Bird",
        manaCost: "{G}",
        typeLine: "Creature — Bird",
        oracleText: `{G}{G}, {T}: ${text}`,
    });
}

function state(text: string) {
    return compileCard(ability(text)).state;
}

describe("announced-creature anaphora — golden (CR 608.2c)", () => {
    it("Whippoorwill reaches ready — its fixture clears its smoke form", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Whippoorwill"
        )!;
        expect(fixture.rule).toBe("effect clause");
        expect(compileCard(fixture.card).state).toBe("ready");
    });

    it("binds the lock to the one creature target", () => {
        const outcome = compileCard(
            ability(`Target creature can't be regenerated this turn. ${LOCK}`)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.activatedAbilities?.[0]?.effects).toEqual([
            { op: "preventRegeneration", target: { target: 0 } },
            { op: "lockDamage", target: { target: 0 } },
        ]);
    });

    it("Savage Surge: any verb reading 'that creature' reaches the target", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "0acbc9a6-0de0-4096-b35c-1a586a1312ea",
                name: "Savage Surge",
                manaCost: "{1}{G}",
                typeLine: "Instant",
                oracleText:
                    "Target creature gets +2/+2 until end of turn. Untap that creature.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Savage Surge",
                types: ["Instant"],
                manaCost: { X: 1, G: 1 },
                oracleText:
                    "Target creature gets +2/+2 until end of turn. Untap that creature.",
                effects: [
                    {
                        op: "pump",
                        target: { target: 0 },
                        power: 2,
                        toughness: 2,
                        duration: { phase: "end-of-turn" },
                    },
                    {
                        op: "tapUntap",
                        action: "untap",
                        target: { target: 0 },
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });
});

describe("announced-creature anaphora — refusals (CR 608.2c)", () => {
    it("refuses 'that creature' after two announced targets", () => {
        expect(
            state(
                `Target creature can't be regenerated this turn. Target creature can't be regenerated this turn. ${LOCK}`
            )
        ).toBe("unparsed");
    });

    it("refuses 'that creature' after the target was destroyed", () => {
        expect(state(`Destroy target creature. ${LOCK}`)).toBe("unparsed");
    });

    it("refuses 'that creature' after an 'any target' slot", () => {
        expect(
            state(`This creature deals 1 damage to any target. ${LOCK}`)
        ).toBe("unparsed");
    });

    it("refuses 'that creature' behind a head whose subject is another creature", () => {
        expect(
            compileCard(
                oracleCard({
                    name: "Test Bird",
                    oracleText:
                        "Whenever a creature enters, tap target creature. Put a +1/+1 counter on that creature.",
                })
            ).state
        ).toBe("unparsed");
    });

    it("refuses 'that creature' with no announced target at all", () => {
        expect(state(LOCK)).toBe("unparsed");
    });

    it("refuses an announced subject on the damage-lock line", () => {
        expect(
            state(
                "Damage that would be dealt to target creature this turn can't be prevented or dealt instead to another permanent or player."
            )
        ).toBe("unparsed");
    });

    it("refuses either lock clause alone", () => {
        expect(
            state(
                "Target creature can't be regenerated this turn. Damage that would be dealt to that creature this turn can't be prevented."
            )
        ).toBe("unparsed");
    });

    it("refuses another body behind the dies-this-turn head (Burn Away's)", () => {
        expect(
            state(
                "Target creature can't be regenerated this turn. When that creature dies this turn, exile its controller's graveyard."
            )
        ).toBe("unparsed");
    });

    it("refuses the dies-this-turn exile with no announced creature", () => {
        expect(
            state(
                "This creature deals 1 damage to any target. When the creature dies this turn, exile the creature."
            )
        ).toBe("unparsed");
    });
});

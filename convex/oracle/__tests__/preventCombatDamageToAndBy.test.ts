// "Prevent all combat damage that would be dealt to and dealt by this creature
// this turn" — a two-way combat shield on the ability's own source (CR 615.1a,
// issue #5408), lowered to `preventDamage` mode "combat-to-and-by" on `$source`.
//
//  1. GOLDENS — Moonlight Geist (whole card, behind a mana cost) and Deftblade
//     Elite (same clause beside a Provoke line), whole Compiled Definitions.
//  2. REFUSALS — the neighbours the rule must NOT read: a recipient that is not
//     the ability's own source, and a missing duration.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const CLAUSE =
    "Prevent all combat damage that would be dealt to and dealt by this creature this turn.";

const MOONLIGHT_GEIST: OracleCard = {
    oracleId: "12a8c546-d0d1-4c3d-bfca-c1e59cef349a",
    name: "Moonlight Geist",
    manaCost: "{2}{W}",
    typeLine: "Creature — Spirit",
    oracleText: `Flying\n{3}{W}: ${CLAUSE}`,
    power: "2",
    toughness: "1",
    layout: "normal",
};

const DEFTBLADE_ELITE: OracleCard = {
    oracleId: "9a3e3a8f-7c19-4b52-a1b4-08eb09f6127a",
    name: "Deftblade Elite",
    manaCost: "{W}",
    typeLine: "Creature — Human Soldier",
    oracleText: `Provoke (Whenever this creature attacks, you may have target creature defending player controls untap and block it if able.)\n{1}{W}: ${CLAUSE}`,
    power: "1",
    toughness: "1",
    layout: "normal",
};

const SHIELD = {
    op: "preventDamage",
    mode: "combat-to-and-by",
    target: { ref: "$source" },
    duration: { phase: "end-of-turn" },
};

function activatedEffects(card: OracleCard): unknown {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return sortKeys(outcome.definition.activatedAbilities?.[0]?.effects);
}

describe("prevent all combat damage to and by this creature — goldens", () => {
    it("Moonlight Geist: the mana-cost activation shields $source until end of turn", () => {
        expect(activatedEffects(MOONLIGHT_GEIST)).toEqual(sortKeys([SHIELD]));
    });

    it("Deftblade Elite: the same clause beside a Provoke line", () => {
        const outcome = compileCard(DEFTBLADE_ELITE);
        expect(outcome.state).not.toBe("unparsed");
        expect(activatedEffects(DEFTBLADE_ELITE)).toEqual(sortKeys([SHIELD]));
    });
});

describe("prevent all combat damage to and by — refusals stay fail-closed", () => {
    it.each([
        ["an announced target", "target creature"],
        ["another named creature", "enchanted creature"],
    ])("%s is refused, not re-pointed at $source", (_label, recipient) => {
        const card = oracleCard({
            name: "Probe Geist",
            manaCost: "{2}{W}",
            typeLine: "Creature — Spirit",
            oracleText: `{3}{W}: Prevent all combat damage that would be dealt to and dealt by ${recipient} this turn.`,
            power: "2",
            toughness: "1",
        });
        expect(compileCard(card).state).toBe("unparsed");
    });

    it("a clause with no duration is refused", () => {
        const card = oracleCard({
            name: "Probe Geist",
            manaCost: "{2}{W}",
            typeLine: "Creature — Spirit",
            oracleText:
                "{3}{W}: Prevent all combat damage that would be dealt to and dealt by this creature.",
            power: "2",
            toughness: "1",
        });
        expect(compileCard(card).state).toBe("unparsed");
    });
});
